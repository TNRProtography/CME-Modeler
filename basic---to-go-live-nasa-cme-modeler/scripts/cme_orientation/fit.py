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
