"""
Finding a CME in a stack of coronagraph frames from one viewpoint.

The frames are display images (JPEG/PNG), not calibrated science data, so
everything here is relative: brightness against a pre-event background, and
position angles around the occulter, never absolute intensities or heights in
solar radii. That is enough for direction and width, which is all the
orientation needs.

For each view:
  1. The occulter is found in the image (its centre and radius), so frames
     from any source can be unwrapped into position angle x radius.
  2. A background is taken as the median of the frames before the CME.
  3. Each later frame is compared with it. Where it is brighter by several
     times the frame's own noise is counted, per position angle.
  4. The CME is the arc of position angles, near where DONKI's direction says
     it should appear, that brightens after launch and whose leading edge
     moves outward from frame to frame. A static streamer, a star or a
     planet does not grow; a CME does.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

PA_STEP = 2.0                     # degrees per position-angle bin
RN_STEP = 0.05                    # shape map: distance as a fraction of the front
N_RN = 24                         # 0 .. 1.2 of the front
N_PA = int(360 / PA_STEP)
N_R = 48                          # radial samples between occulter and edge


@dataclass
class Frame:
    t_ms: int
    img: np.ndarray               # 2D float, any brightness scale


@dataclass
class Geometry:
    cx: float
    cy: float
    r_in: float
    r_out: float
    ok: bool = True
    note: str = ""


@dataclass
class ViewResult:
    source: str
    detected: bool = False
    halo: bool = False
    pa: float | None = None       # central position angle
    pa_start: float | None = None # arc start (counter-clockwise)
    width: float | None = None    # arc width
    snr: float = 0.0
    growing: bool = False
    frames_used: int = 0
    base_frames: int = 0
    heights: list = field(default_factory=list)   # (t_ms, leading edge in r_in units)
    reason: str = ""
    # The CME's shape: [N_PA, N_RN] fraction of frames in which each position
    # angle x (distance / front distance) was bright; NaN behind the occulter.
    shape: np.ndarray | None = None
    shape_frames: int = 0
    # Working numbers, for diagnosing a view from the run's log.
    debug: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "source": self.source, "detected": self.detected, "halo": self.halo,
            "pa": None if self.pa is None else round(self.pa, 1),
            "paStart": None if self.pa_start is None else round(self.pa_start, 1),
            "width": None if self.width is None else round(self.width, 1),
            "snr": round(self.snr, 2), "growing": self.growing,
            "framesUsed": self.frames_used, "baseFrames": self.base_frames,
            "reason": self.reason,
        }


# ── Occulter ────────────────────────────────────────────────────────────────

def find_occulter(img: np.ndarray, hint: tuple[float, float] | None = None) -> Geometry:
    """
    Centre and radius of the dark occulting disk.

    Rays go out from a provisional centre until the brightness rises and stays
    risen for a few pixels (so the thin circle some sources draw for the Sun's
    limb is stepped over). A circle is fitted to those edge points, the worst
    outliers (the ones that ran down the occulter's support pylon) are dropped
    and it is fitted again.
    """
    h, w = img.shape
    sm = ndimage.gaussian_filter(img.astype(float), 1.5)
    cx, cy = hint if hint else (w / 2.0, h / 2.0)
    r_max = min(cx, cy, w - cx, h - cy) * 0.9
    ring = sm[_annulus_mask(h, w, cx, cy, 0.45 * r_max, 0.8 * r_max)]
    core = sm[_annulus_mask(h, w, cx, cy, 0, 0.08 * r_max)]
    if ring.size == 0 or core.size == 0:
        return _fallback_geometry(h, w, "image too small")
    dark, bright = float(np.median(core)), float(np.median(ring))
    if bright - dark < 1e-3:
        return _fallback_geometry(h, w, "no occulter contrast")
    thr = dark + 0.35 * (bright - dark)

    pts = []
    for k in range(120):
        a = 2 * math.pi * k / 120
        # Bright for 12 pixels running: the corona beyond the occulter edge,
        # not a thin drawn circle or a hot pixel.
        run = 0
        for r in np.arange(2, r_max, 0.5):
            x, y = cx + r * math.sin(a), cy - r * math.cos(a)
            if sm[int(round(y)), int(round(x))] > thr:
                run += 1
                if run >= 24:
                    rr = r - 11.5
                    pts.append((cx + rr * math.sin(a), cy - rr * math.cos(a)))
                    break
            else:
                run = 0
    if len(pts) < 30:
        return _fallback_geometry(h, w, "occulter edge not found")
    pts = np.array(pts)
    for _ in range(3):
        fx, fy, fr = _fit_circle(pts)
        res = np.abs(np.hypot(pts[:, 0] - fx, pts[:, 1] - fy) - fr)
        mad = np.median(res) * 1.4826 + 0.5
        keep = res < 2.5 * mad
        if keep.sum() < 20:
            break
        pts = pts[keep]
    fx, fy, fr = _fit_circle(pts)
    if not (0 < fr < r_max) or math.hypot(fx - cx, fy - cy) > 0.25 * r_max:
        return _fallback_geometry(h, w, "occulter fit implausible")
    r_out = min(fx, fy, w - fx, h - fy) * 0.92
    if r_out < fr * 1.6:
        return _fallback_geometry(h, w, "field of view too small")
    return Geometry(fx, fy, fr, r_out)


def _fit_circle(pts: np.ndarray) -> tuple[float, float, float]:
    x, y = pts[:, 0], pts[:, 1]
    a = np.column_stack([x, y, np.ones_like(x)])
    b = x ** 2 + y ** 2
    c, *_ = np.linalg.lstsq(a, b, rcond=None)
    cx, cy = c[0] / 2, c[1] / 2
    return float(cx), float(cy), float(math.sqrt(max(0.0, c[2] + cx ** 2 + cy ** 2)))


def _annulus_mask(h, w, cx, cy, r0, r1):
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx - cx, yy - cy)
    return (rr >= r0) & (rr < r1)


def _fallback_geometry(h, w, note):
    r = min(h, w) / 2.0
    return Geometry(w / 2.0, h / 2.0, 0.2 * r, 0.9 * r, ok=False, note=note)


# ── Unwrapping ──────────────────────────────────────────────────────────────

def unwrap(img: np.ndarray, g: Geometry) -> np.ndarray:
    """Image -> array [N_PA, N_R]; PA counter-clockwise from up (north)."""
    h, w = img.shape
    pas = np.radians(np.arange(N_PA) * PA_STEP)
    rs = np.linspace(g.r_in * 1.15, g.r_out, N_R)
    xx = g.cx - np.outer(np.sin(pas), rs)          # PA 90 = left (east)
    yy = g.cy - np.outer(np.cos(pas), rs)
    out = ndimage.map_coordinates(img.astype(float), [yy.ravel(), xx.ravel()], order=1, mode="nearest")
    out = out.reshape(N_PA, N_R)
    # Timestamps and logos sit along the top and bottom edges and change with
    # every frame; nothing there is trusted.
    band = (yy < 0.07 * h) | (yy > 0.93 * h) | (xx < 0.02 * w) | (xx > 0.98 * w)
    out[band] = np.nan
    return out


def _normalise(p: np.ndarray) -> np.ndarray:
    """Brightness relative to the frame's own median: frames differ in exposure."""
    m = np.nanmedian(p)
    return p / m if m and np.isfinite(m) and m > 0 else p


# ── Detection ───────────────────────────────────────────────────────────────

def detect_view(
    source: str,
    frames: list[Frame],
    t_start_ms: int,
    prior_pa: float | None,
    prior_halo: bool,
    prior_halfwidth: float = 45.0,
    geometry_hint: tuple[float, float] | None = None,
) -> ViewResult:
    res = ViewResult(source)
    frames = sorted(frames, key=lambda f: f.t_ms)
    base = [f for f in frames if t_start_ms - 150 * 60000 <= f.t_ms <= t_start_ms - 5 * 60000]
    after = [f for f in frames if t_start_ms - 20 * 60000 <= f.t_ms <= t_start_ms + 8 * 3600000]
    if not base:
        # No frame before launch: the earliest frame stands in, which works
        # when the CME is still low in it and costs sensitivity otherwise.
        early = [f for f in frames if f.t_ms <= t_start_ms + 40 * 60000]
        if early:
            base = [early[0]]
            after = [f for f in after if f.t_ms > early[0].t_ms]
    res.base_frames = len(base)
    if not base or len(after) < 2:
        res.reason = f"not enough frames ({len(base)} before launch, {len(after)} after)"
        return res

    shape = base[0].img.shape
    base = [f for f in base if f.img.shape == shape]
    after = [f for f in after if f.img.shape == shape]
    if len(after) < 2:
        res.reason = "frames differ in size"
        return res

    base_img = np.median(np.stack([f.img for f in base]), axis=0)
    g = find_occulter(base_img, geometry_hint)
    res.debug.update({
        "size": list(shape), "base": [round((f.t_ms - t_start_ms) / 60000) for f in base],
        "after": [round((f.t_ms - t_start_ms) / 60000) for f in after],
        "occulter": [round(g.cx), round(g.cy), round(g.r_in), round(g.r_out), g.ok, g.note],
    })
    if not g.ok and geometry_hint is None:
        res.reason = f"occulter: {g.note}"
        # Still usable with the centred fallback; the reason is recorded.
    pb = _normalise(unwrap(base_img, g))

    occ, hits, times = [], [], []
    for f in after:
        pf = _normalise(unwrap(f.img, g))
        rel = (pf - pb) / (np.abs(pb) + 0.05)
        rel -= np.nanmedian(rel)
        sigma = 1.4826 * np.nanmedian(np.abs(rel - np.nanmedian(rel))) + 1e-3
        hit = rel > 3.0 * sigma
        valid = np.isfinite(rel)
        o = np.where(valid.sum(1) > 0, (hit & valid).sum(1) / np.maximum(valid.sum(1), 1), 0.0)
        occ.append(o)
        hits.append(hit & valid)
        times.append(f.t_ms)
    occ = np.array(occ)                                  # [frames, PA]
    res.frames_used = len(after)

    # Occupancy that persists: the median of the best few frames, so one
    # noisy frame cannot make a CME.
    k = min(3, len(occ))
    s = np.sort(occ, axis=0)[-k:].mean(axis=0)
    s = _circular_smooth(s, 2)

    allowed = np.ones(N_PA, bool)
    if prior_pa is not None and not prior_halo:
        pa_axis = np.arange(N_PA) * PA_STEP
        d = np.abs((pa_axis - prior_pa + 180) % 360 - 180)
        allowed = d <= prior_halfwidth + 45

    background = s[~allowed] if (~allowed).sum() > 10 else s
    bg_med = float(np.median(background))
    bg_sd = float(1.4826 * np.median(np.abs(background - bg_med))) + 0.01
    thr = max(0.12, bg_med + 4 * bg_sd)
    mask = (s > thr) & allowed
    res.debug.update({"bg": round(bg_med, 3), "bgSd": round(bg_sd, 3), "thr": round(thr, 3),
                      "peak": round(float(s[allowed].max()) if allowed.any() else 0.0, 3),
                      "peakPa": float(np.argmax(np.where(allowed, s, -1)) * PA_STEP)})

    arcs = _circular_runs(mask)
    if not arcs:
        res.reason = "no brightening above the noise near the expected position"
        return res
    # The arc carrying the most signal, preferring the one at the prior. A
    # possible halo still leans that way, more gently: a partial halo is
    # brightest on the side it is heading, and another CME or a streamer
    # elsewhere in the ring must not be taken for it.
    def score(arc):
        i0, n = arc
        idx = [(i0 + j) % N_PA for j in range(n)]
        w = float(s[idx].sum())
        if prior_pa is not None:
            c = _circ_mean_idx(idx, s[idx])
            scale = 120.0 if prior_halo else 60.0
            w *= 1.0 / (1.0 + (abs((c - prior_pa + 180) % 360 - 180) / scale) ** 2)
        return w
    i0, n = max(arcs, key=score)
    i0, n = _refine_arc(s, i0, n, allowed)
    idx = [(i0 + j) % N_PA for j in range(n)]
    width = n * PA_STEP
    res.snr = float((s[idx].mean() - bg_med) / bg_sd)
    res.halo = width >= 300
    res.width = 360.0 if res.halo else width
    res.pa_start = 0.0 if res.halo else i0 * PA_STEP
    res.pa = _circ_mean_idx(idx, s[idx])

    # Growth: the leading edge in the arc's core moves out over time.
    core = idx if res.halo else [(i0 + n // 2 + j) % N_PA for j in range(-max(1, n // 6), max(1, n // 6) + 1)]
    hs = [_leading_edge(hh[core]) for hh in hits]
    res.heights = [(t, round(h / N_R, 3)) for t, h in zip(times, hs)]
    res.growing = _increases(hs)
    res.debug["fronts"] = [round(h / N_R, 2) for h in hs]

    if res.snr < 3:
        res.reason = f"signal too weak (SNR {res.snr:.1f})"
        return res
    if not res.growing and not res.halo:
        res.reason = "brightening does not move outward: not a CME, or already past"
        return res
    res.detected = True
    if not res.reason:
        res.reason = "halo" if res.halo else "detected"
    res.shape, res.shape_frames = _shape_map(hits, hs, g)
    return res


def _shape_map(hits: list[np.ndarray], fronts: list[float], g: Geometry):
    """
    The CME's shape across frames, with distance measured as a fraction of
    its front in each frame. A CME grows roughly self-similarly, so every frame
    with the front well inside the field of view adds to the same picture, and
    the image scale (unknown for display images) drops out.
    """
    r0, r1 = g.r_in * 1.15, g.r_out
    radii = np.linspace(r0, r1, N_R)
    rn_axis = (np.arange(N_RN) + 0.5) * RN_STEP
    maps = []
    for hit, h in zip(hits, fronts):
        if h < 0.25 * N_R or h > 0.95 * N_R:
            continue
        front = r0 + h * (r1 - r0) / (N_R - 1)
        rn = radii / front
        m = np.full((N_PA, N_RN), np.nan)
        for j, q in enumerate(rn_axis):
            if q * front < r0 or q * front > r1:
                continue
            i = int(round((q * front - r0) / (r1 - r0) * (N_R - 1)))
            m[:, j] = hit[:, min(max(i, 0), N_R - 1)]
        maps.append(m)
    if not maps:
        return None, 0
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # columns behind the occulter in every frame
        return np.nanmean(np.stack(maps), axis=0), len(maps)


def _leading_edge(hit_core: np.ndarray) -> float:
    """
    Outer end of the bright region that starts near the occulter, across the
    arc's core: -1 if there is none. The outermost bright pixel anywhere would
    be set by noise before the CME even arrives; a CME fills in from the
    inside, noise does not.
    """
    frac = hit_core.mean(axis=0)
    on = frac >= 0.5
    first = int(np.argmax(on)) if on.any() else -1
    if first < 0 or first > 0.3 * N_R:
        return -1.0
    end = first
    while end + 1 < N_R and (on[end + 1] or (end + 2 < N_R and on[end + 2])):
        end += 1
    return float(end)


def _refine_arc(s: np.ndarray, i0: int, n: int, allowed: np.ndarray, frac: float = 0.2) -> tuple[int, int]:
    """
    Edges where the signal falls below a fraction of this arc's own peak.

    A fixed threshold takes in less of a wide, faint CME than of a narrow,
    dense one, which biases the ratio of widths between views: the very thing
    the tilt is read from. Measured against each view's own peak, both are cut
    at the same place on their flanks.
    """
    idx = [(i0 + j) % N_PA for j in range(n)]
    peak_i = idx[int(np.argmax(s[idx]))]
    level = frac * float(s[peak_i])
    lo = hi = peak_i
    for _ in range(N_PA):
        j = (lo - 1) % N_PA
        if s[j] < level or not allowed[j] or j == hi:
            break
        lo = j
    for _ in range(N_PA):
        j = (hi + 1) % N_PA
        if s[j] < level or not allowed[j] or j == lo:
            break
        hi = j
    width = (hi - lo) % N_PA + 1
    return lo, width


def _circular_smooth(s: np.ndarray, k: int) -> np.ndarray:
    return np.array([np.mean([s[(i + j) % len(s)] for j in range(-k, k + 1)]) for i in range(len(s))])


def _circular_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    n = len(mask)
    if mask.all():
        return [(0, n)]
    if not mask.any():
        return []
    start = int(np.argmin(mask))       # begin at a gap so runs do not wrap
    runs, i = [], 0
    while i < n:
        j = (start + i) % n
        if mask[j]:
            k = 0
            while k < n and mask[(j + k) % n]:
                k += 1
            if k >= 3:                  # at least 6 degrees
                runs.append((j, k))
            i += k
        else:
            i += 1
    return runs


def _circ_mean_idx(idx: list[int], w: np.ndarray) -> float:
    a = np.radians(np.array(idx) * PA_STEP)
    w = np.maximum(np.asarray(w, float), 1e-6)
    return float(math.degrees(math.atan2((w * np.sin(a)).sum(), (w * np.cos(a)).sum())) % 360)


def _increases(hs: list[float]) -> bool:
    """
    Whether the leading edge moves outward. Only the frames up to when it
    reaches the edge of the field of view count: after that it sits at the
    edge, and a fast CME would otherwise look stalled.
    """
    hs = [h for h in hs if h >= 0]
    if len(hs) < 2:
        return False
    top = max(hs)
    end = next(i for i, h in enumerate(hs) if h >= 0.95 * top)
    rise = hs[: end + 1]
    if len(rise) < 2 or top - rise[0] < 0.15 * N_R:
        return False
    steps = np.diff(rise)
    return bool((steps >= -0.05 * N_R).mean() >= 0.7)
