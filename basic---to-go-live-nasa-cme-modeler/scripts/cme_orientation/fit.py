"""
From per-view detections to a 3D direction and a tilt.

Direction: every direction on a 2-degree grid is scored against what each view
saw. A view that saw the CME off to one side says which plane it travels in
(the plane through the observer and the CME's position angle); two views from
different places cross those planes and fix the direction. A view that saw a
halo says the CME is coming at or away from it. DONKI's analysed direction is
a weak prior, mainly to decide front from back when only halos were seen.

Tilt: with the direction fixed, the CME is an elliptical cone (wider along its
flux-rope axis than across it) and its rim is projected into every view. The
tilt and widths that best reproduce the arc each view measured win. A cone
that fits as well round as oval says nothing about tilt, and is reported that
way rather than as a number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from geometry import (
    Observer, angle_between, cone_points, direction, lon_lat, pa_diff, span_of_points,
)

LON_GRID = np.arange(-180, 180, 2.0)
LAT_GRID = np.arange(-70, 71, 2.0)


@dataclass
class Measurement:
    observer: Observer
    halo: bool
    pa: float | None
    pa_start: float | None
    width: float | None
    snr: float


def _grid_dirs():
    lo, la = np.meshgrid(np.radians(LON_GRID), np.radians(LAT_GRID))
    d = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
    return lo, la, d


def fit_direction(meas: list[Measurement], prior: np.ndarray | None, prior_sigma: float = 35.0) -> dict:
    lo, la, d = _grid_dirs()
    cost = np.zeros(lo.shape)
    informative = []
    for m in meas:
        o = m.observer.o
        up, east = m.observer.basis()
        if m.halo:
            # Coming at or away from this observer: within ~40 degrees of its line.
            c = np.abs(d @ o)
            ang = np.degrees(np.arccos(np.clip(c, -1, 1)))
            cost += (np.maximum(0, ang - 40) / 10.0) ** 2
            continue
        pa_pred = np.degrees(np.arctan2(d @ east, d @ up)) % 360
        err = (pa_pred - m.pa + 180) % 360 - 180
        sigma = max(4.0, (m.width or 40) / 5.0) * (3.0 / max(3.0, min(m.snr, 12.0))) ** 0.5
        cost += (err / sigma) ** 2
        # Seen off to one side, so not heading straight at or away from it.
        ang = np.degrees(np.arccos(np.clip(np.abs(d @ o), -1, 1)))
        cost += (np.maximum(0, 20 - ang) / 5.0) ** 2
        informative.append(m)
    if prior is not None:
        ang = np.degrees(np.arccos(np.clip(d @ prior, -1, 1)))
        cost += (ang / prior_sigma) ** 2

    i = np.unravel_index(np.argmin(cost), cost.shape)
    best = d[i]
    within = cost <= cost[i] + 2.3           # ~68% region for two parameters
    spread = float(np.degrees(np.arccos(np.clip(d[within] @ best, -1, 1))).max())
    blon, blat = lon_lat(best)

    viewpoints = _distinct_viewpoints([m.observer for m in informative])
    baseline = _max_separation(viewpoints)
    halos = [m for m in meas if m.halo]
    if len(viewpoints) >= 2 and baseline >= 25:
        conf = 95 - 1.2 * spread
        basis = f"triangulated from {len(viewpoints)} viewpoints {baseline:.0f} degrees apart"
    elif len(viewpoints) == 1 and halos and _max_separation(viewpoints + [h.observer for h in halos]) >= 25:
        conf = 78 - 1.2 * spread
        basis = "one side view plus a halo from another viewpoint"
    elif len(viewpoints) >= 1:
        conf = min(40.0, 55 - spread)
        basis = "a single viewpoint: the plane is known, not the depth"
    else:
        conf = 15.0
        basis = "halo only: close to DONKI's direction by assumption"
    return {
        "lon": round(blon, 1), "lat": round(blat, 1),
        "vector": best, "uncertainty": round(spread, 1),
        "confidence": int(max(0, min(95, round(conf)))),
        "basis": basis,
        "viewpoints": len(viewpoints), "baseline": round(baseline, 1),
    }


def _distinct_viewpoints(obs: list[Observer]) -> list[Observer]:
    out: list[Observer] = []
    for o in obs:
        if all(angle_between(o.o, p.o) > 5 for p in out):
            out.append(o)
    return out


def _max_separation(obs: list[Observer]) -> float:
    best = 0.0
    for i in range(len(obs)):
        for j in range(i + 1, len(obs)):
            best = max(best, angle_between(obs[i].o, obs[j].o))
    return best


TILTS = np.arange(0, 180, 5.0)
FACES = np.arange(15, 76, 10.0)
RATIOS = [0.35, 0.5, 0.7, 1.0]
HIDDEN_CHOICES = [25.0, 33.0, 41.0]


def fit_tilt(meas: list[Measurement], d: np.ndarray, prior_half: float | None) -> dict | None:
    """Tilt (0-180, axis) from the arcs each view saw, or None if nothing to fit."""
    usable = [m for m in meas if m.halo or (m.pa_start is not None and m.width is not None)]
    if not usable:
        return None
    side = [m for m in usable if not m.halo]
    best = (math.inf, None)
    per_tilt = {}
    for tilt in TILTS:
        tmin = math.inf
        for face in FACES:
            for ratio in RATIOS:
                edge = max(8.0, face * ratio)
                pts = cone_points(d, tilt, face, edge)
                for hidden in HIDDEN_CHOICES:
                    c = 0.0
                    for m in usable:
                        halo, start, width = span_of_points(m.observer, pts, hidden)
                        if m.halo or halo:
                            c += 0.0 if (m.halo and halo) else 9.0
                            continue
                        e1 = pa_diff(start, m.pa_start)
                        e2 = pa_diff((start + width) % 360, (m.pa_start + m.width) % 360)
                        # 10 degrees per edge: the thresholding, the flank
                        # brightness and the frame timing all move an edge.
                        c += (e1 / 10.0) ** 2 + (e2 / 10.0) ** 2
                    if prior_half:
                        c += ((max(face, edge) - prior_half) / 20.0) ** 2
                    tmin = min(tmin, c)
                    if c < best[0]:
                        best = (c, (tilt, face, edge, ratio, hidden))
        per_tilt[tilt] = tmin
    cost, params = best
    if params is None:
        return None
    tilt, face, edge, ratio, hidden = params
    close = [t for t, c in per_tilt.items() if c <= cost + 1.0]
    # Never tighter than 15 degrees: the grid is 5, and a cone is only an
    # approximation of a flux rope.
    spread = max(15.0, _axial_spread(close, tilt))
    # A round cone fits any tilt, and one side view hardly constrains it.
    constrained = ratio < 0.95 and spread < 60 and len(side) >= 1
    conf = 0
    if constrained:
        conf = int(max(10, min(85, 85 - 1.1 * spread - (20 if len(side) < 2 else 0))))
    return {
        "tilt": float(tilt), "halfFace": float(face), "halfEdge": float(edge),
        "uncertainty": round(spread, 1), "constrained": bool(constrained),
        "confidence": conf, "cost": round(float(cost), 2), "hiddenNearLineOfSight": hidden,
    }


def _axial_spread(angles: list[float], centre: float) -> float:
    if not angles:
        return 90.0
    return max(abs((a - centre + 90) % 180 - 90) for a in angles)


# ── Shape fit ──────────────────────────────────────────────────────────────
#
# Widths alone cannot tell a tilt from its mirror image: seen from Earth, a
# CME off the west limb is as wide leaning one way as the other. Its shape
# can: a tilted rope is skewed in the sky, and the skew flips with the tilt.
# So each candidate rope is projected into every view from that spacecraft's
# own position and compared, as a picture, with the region the CME actually
# brightened (detect._shape_map). Distance is in units of the front on both
# sides, so no image scale is needed. This is the idea behind GCS fitting,
# done automatically over every frame in which the front is in view.

from detect import N_PA, N_RN, PA_STEP, RN_STEP  # noqa: E402
from geometry import local_axes  # noqa: E402

SHAPE_TILTS = np.arange(0, 180, 5.0)
SHAPE_FACES = np.array([25.0, 35.0, 45.0, 55.0, 65.0])
SHAPE_RATIOS = [0.35, 0.55, 1.0]
# Direction and tilt are fitted together: a direction a few degrees off can
# otherwise be made up for by a wrong tilt. +/-12 degrees around the
# triangulated direction, in 4-degree steps.
SHAPE_DIR_STEPS = [(a, b) for a in range(-12, 13, 4) for b in range(-12, 13, 4)]


def _rope_cloud(d: np.ndarray, tilt: float, face: float, edge: float) -> np.ndarray:
    """Points filling the rope, as fractions of the front distance."""
    h, v = local_axes(d)
    t = math.radians(tilt)
    axis = math.cos(t) * h + math.sin(t) * v
    across = np.cross(d, axis)
    phi = np.linspace(0, 2 * math.pi, 40, endpoint=False)
    frac = np.array([0.2, 0.45, 0.7, 0.9, 1.0])
    wf, we = math.radians(face), math.radians(edge)
    rim = 1.0 / np.sqrt((np.cos(phi) / wf) ** 2 + (np.sin(phi) / we) ** 2)
    w = (frac[:, None] * rim[None, :]).ravel()
    ph = np.tile(phi, len(frac))
    a = np.outer(np.cos(ph), axis) + np.outer(np.sin(ph), across)
    dirs = np.cos(w)[:, None] * d + np.sin(w)[:, None] * a
    dirs = np.vstack([dirs, d[None, :]])
    # A flux rope is a shell toward the front, not a solid cone.
    depth = np.array([0.6, 0.75, 0.9, 1.0])
    return (dirs[None, :, :] * depth[:, None, None]).reshape(-1, 3)


def _project(obs: Observer, pts: np.ndarray) -> np.ndarray:
    """
    Predicted shape map ([N_PA, N_RN], 0-1) of a point cloud in a view: how
    much of the rope lies along each line of sight. That is what makes a CME
    bright in white light (more material along the line of sight scatters
    more), and it is where a tilted rope shows its tilt: brightest where the
    view runs along it.
    """
    up, east = obs.basis()
    x, y = pts @ east, pts @ up
    r = np.hypot(x, y)
    front = r.max()
    if front <= 0:
        return np.zeros((N_PA, N_RN))
    pa = (np.degrees(np.arctan2(x, y)) % 360.0)
    i = (pa / PA_STEP).astype(int) % N_PA
    j = np.minimum((r / front / RN_STEP).astype(int), N_RN - 1)
    m = np.zeros((N_PA, N_RN))
    np.add.at(m, (i, j), 1.0)
    # Spread over neighbouring bins, as a real CME is not a point cloud.
    m = 0.5 * m + 0.25 * (np.roll(m, 1, axis=0) + np.roll(m, -1, axis=0))
    m[:, 1:] += 0.25 * m[:, :-1]
    top = np.percentile(m[m > 0], 95) if (m > 0).any() else 1.0
    return np.clip(m / top, 0, 1)


def fit_shape(views: list[tuple[Observer, np.ndarray, float]], d0: np.ndarray, prior_half: float | None) -> dict | None:
    """
    views: (observer, observed shape map, weight). Returns the best tilt with
    its uncertainty and how clearly it beats its mirror image, or None.
    """
    obs_masks = []
    for obs, shape, weight in views:
        if shape is None:
            continue
        valid = np.isfinite(shape)
        if valid.sum() < 50:
            continue
        seen = np.where(valid, shape, 0.0)
        # Occupancy below the frame-to-frame noise floor counts as empty.
        seen = np.clip((seen - 0.15) / 0.85, 0, 1)
        if (seen > 0.3).sum() < 5:
            continue
        obs_masks.append((obs, valid, seen, weight))
    if not obs_masks:
        return None

    # Two scores from the same projections. What a view records is occupancy
    # (bright or not, frame by frame), so the outline carries most of it:
    #   main:  outline of wherever the rope puts any material along the line
    #          of sight, plus a little of the brightness overlap (Ruzicka);
    #   check: the same outline averaged with that of the rope's dense core.
    # Each is fooled on its own by some geometries (in the self-test, the main
    # score by a CME heading away from STEREO-A, the check by a near-upright
    # one), but not the same ones: the tilt counts only where they agree.
    lon0, lat0 = lon_lat(d0)
    best = {"main": (-1.0, None), "check": (-1.0, None)}
    per_tilt: dict = {"main": {}, "check": {}}
    for dlo, dla in SHAPE_DIR_STEPS:
        d = direction(lon0 + dlo, lat0 + dla)
        for tilt in SHAPE_TILTS:
            for face in SHAPE_FACES:
                for ratio in SHAPE_RATIOS:
                    edge = max(8.0, face * ratio)
                    cloud = _rope_cloud(d, tilt, face, edge)
                    main = check = wsum = 0.0
                    for obs, valid, seen, weight in obs_masks:
                        pred = np.where(valid, _project(obs, cloud), 0.0)
                        sb = seen > 0.3
                        wide, core = pred > 0.05, pred > 0.2
                        u = (wide | sb).sum()
                        outline = (wide & sb).sum() / u if u else 0.0
                        u = (core | sb).sum()
                        outline_core = (core & sb).sum() / u if u else 0.0
                        u = np.maximum(pred, seen).sum()
                        bright = np.minimum(pred, seen).sum() / u if u else 0.0
                        main += weight * (0.7 * outline + 0.3 * bright)
                        check += weight * 0.5 * (outline + outline_core)
                        wsum += weight
                    penalty = 0.02 * abs(max(face, edge) - prior_half) / 20.0 if prior_half else 0.0
                    for name, s in (("main", main / wsum - penalty), ("check", check / wsum - penalty)):
                        per_tilt[name][tilt] = max(per_tilt[name].get(tilt, -1.0), s)
                        if s > best[name][0]:
                            best[name] = (s, (tilt, face, edge, ratio, dlo, dla))
    score, params = best["main"]
    if params is None:
        return None
    tilt, face, edge, ratio, dlo, dla = params
    check_tilt = best["check"][1][0]
    disagree = abs(((check_tilt - tilt) + 90) % 180 - 90)
    scores = per_tilt["main"]
    mirror = (180.0 - tilt) % 180.0
    mirror_score = scores.get(min(SHAPE_TILTS, key=lambda x: abs(((x - mirror + 90) % 180) - 90)), score)
    close = [t for t, s in scores.items() if s >= score - 0.012]
    spread = max(15.0, _axial_spread(close, tilt), disagree)
    viewpoints = _distinct_viewpoints([o for o, *_ in obs_masks])
    margin = score - mirror_score
    constrained = ratio < 0.95 and spread < 60 and score > 0.25 and disagree <= 30
    conf = 0
    if constrained:
        conf = 85 - 1.0 * spread - (25 if len(viewpoints) < 2 else 0) + min(10, 200 * margin)
        conf = int(max(10, min(85, conf)))
    return {
        "tilt": float(tilt), "halfFace": float(face), "halfEdge": float(edge),
        "uncertainty": round(spread, 1), "constrained": bool(constrained), "confidence": conf,
        "overlap": round(float(score), 3), "mirrorMargin": round(float(margin), 3),
        "checkTilt": float(check_tilt),
        "viewpoints": len(viewpoints), "direction": lon_lat(direction(lon0 + dlo, lat0 + dla)),
    }
