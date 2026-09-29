"""
The source region's polarity inversion line (PIL), as a first estimate of the
flux rope's tilt, and the hemispheric helicity rule for its field direction.

A CME's flux rope usually leaves lying along the line that divides the source
region's positive and negative field. Its angle is measured here from an HMI
magnetogram (grey: mid-grey is zero field, white positive, black negative),
corrected for foreshortening at the region's position on the disk.

The twist follows Martin's rule: dextral filaments (negative helicity,
left-handed ropes) dominate in the north, sinistral (positive, right-handed)
in the south. With the tilt and which side is positive, that gives the field
at the front of the rope and along its axis: the Bothmer & Schwenn type
(e.g. SWN: south at the front, west along the axis, north behind).

CMEs can rotate by tens of degrees while leaving the Sun, so this is capped
below full confidence however clear the region is.
"""

from __future__ import annotations

import math
import re

import numpy as np
from scipy import ndimage


def parse_location(loc: str | None) -> tuple[float, float] | None:
    """'N27W50' -> (lat 27, lon 50 west-positive)."""
    if not loc:
        return None
    m = re.match(r"^\s*([NS])(\d{1,2})([EW])(\d{1,3})\s*$", loc.upper())
    if not m:
        return None
    lat = float(m.group(2)) * (1 if m.group(1) == "N" else -1)
    lon = float(m.group(4)) * (1 if m.group(3) == "W" else -1)
    return lat, lon


def measure_pil(
    img: np.ndarray,
    region_xy: tuple[float, float],
    px_per_rsun: float,
    lat: float,
    lon: float,
) -> dict | None:
    """
    img: grey magnetogram, north up, west right. region_xy: the region's pixel
    position. Returns tilt (0-180, counter-clockwise from west toward north on
    the surface), clarity, and the predicted field, or None if no clear line.
    """
    g = img.astype(float)
    if g.max() > 1.5:
        g = g / 255.0
    b = (g - 0.5) / 0.5                                   # -1 .. 1
    rx, ry = region_xy
    box = int(max(20, 0.18 * px_per_rsun))                # ~ 125 arcsec
    y0, y1 = int(max(0, ry - box)), int(min(g.shape[0], ry + box))
    x0, x1 = int(max(0, rx - box)), int(min(g.shape[1], rx + box))
    sub = b[y0:y1, x0:x1]
    if sub.size < 400:
        return None
    sm = ndimage.gaussian_filter(sub, max(1.0, box / 40))
    thr = max(0.18, 0.35 * float(np.percentile(np.abs(sm), 99)))
    pos, neg = sm > thr, sm < -thr
    if pos.sum() < 15 or neg.sum() < 15:
        return None
    # The line is where the field changes sign with strong field of both
    # signs close by on either side: a zero crossing, not a band, so its
    # shape is the line's and not the gap's.
    st = ndimage.generate_binary_structure(2, 1)
    reach = max(3, box // 6)
    sgn = np.sign(sm)
    zc = np.zeros_like(pos)
    zc[:, :-1] |= sgn[:, :-1] * sgn[:, 1:] < 0
    zc[:-1, :] |= sgn[:-1, :] * sgn[1:, :] < 0
    pil = zc & ndimage.binary_dilation(pos, st, reach) & ndimage.binary_dilation(neg, st, reach)
    grow = max(2, reach // 2)
    gy, gx = np.gradient(sm)
    grad = np.hypot(gx, gy)
    ys, xs = np.nonzero(pil)
    if len(xs) < 12:
        return None
    w = grad[ys, xs]
    # Keep the strongest part of the line: the one a rope would erupt from.
    keep = w >= np.percentile(w, 40)
    xs, ys, w = xs[keep], ys[keep], w[keep]
    mx, my = np.average(xs, weights=w), np.average(ys, weights=w)
    dx, dy = xs - mx, ys - my
    cov = np.cov(np.vstack([dx, dy]), aweights=w)
    evals, evecs = np.linalg.eigh(cov)
    major = evecs[:, 1]
    elong = 1.0 - math.sqrt(max(evals[0], 0) / max(evals[1], 1e-9))

    # Image (x right = west, y down) -> surface directions (west, north).
    img_w, img_n = float(major[0]), float(-major[1])
    ew, ns = _deproject(img_w, img_n, lat, lon)
    tilt = math.degrees(math.atan2(ns, ew)) % 180.0

    # Which side is positive: flux-weighted centroids near the line.
    near = ndimage.binary_dilation(pil, st, grow * 3)
    pw = np.where(near & pos, sm, 0).clip(min=0)
    nw = np.where(near & neg, -sm, 0).clip(min=0)
    if pw.sum() <= 0 or nw.sum() <= 0:
        return None
    yy, xx = np.mgrid[0:sm.shape[0], 0:sm.shape[1]]
    p_c = (np.sum(xx * pw) / pw.sum(), np.sum(yy * pw) / pw.sum())
    n_c = (np.sum(xx * nw) / nw.sum(), np.sum(yy * nw) / nw.sum())
    fe, fn = _deproject(n_c[0] - p_c[0], -(n_c[1] - p_c[1]), lat, lon)   # positive -> negative
    fl = math.hypot(fe, fn) or 1.0
    fe, fn = fe / fl, fn / fl

    north = lat >= 0
    # Axial field of the rope: to the right of someone standing on the
    # positive side facing the negative for dextral (north), left for sinistral.
    ae, an = (fn, -fe) if north else (-fn, fe)
    # The top of the rope, which arrives first, runs with the overlying
    # arcade: from positive to negative.
    rope_type = _rope_type(tilt, fe, fn, ae, an)

    mu = _mu(lat, lon)
    strength = float(np.clip((np.abs(sm) > thr).mean() * 6, 0, 1))
    clarity = float(np.clip(elong, 0, 1))
    # Away from disk centre the line is foreshortened (a small error in the
    # image becomes a large one on the surface) and the magnetogram sees the
    # field side-on: full weight only near the centre (mu 0.85, about 30
    # degrees out), falling to none by mu 0.3 (about 70 degrees).
    limb = float(np.clip((mu - 0.3) / 0.55, 0, 1))
    conf = 70 * clarity * limb * (0.6 + 0.4 * strength)
    return {
        "tilt": round(tilt, 1),
        "clarity": round(clarity, 2),
        "mu": round(mu, 2),
        "confidence": int(max(0, min(75, round(conf)))),
        "helicity": "negative (left-handed)" if north else "positive (right-handed)",
        "leadingField": "north" if fn > 0 else "south",
        "axialField": _compass(ae, an),
        "ropeType": rope_type,
        "pilPixels": int(len(xs)),
    }


def _deproject(img_w: float, img_n: float, lat: float, lon: float) -> tuple[float, float]:
    """Undo foreshortening: an image-plane direction at (lat, lon) on the
    surface -> the direction along the surface, as (west, north)."""
    phi, lam = math.radians(lat), math.radians(lon)
    j = np.array([[math.cos(lam), -math.sin(phi) * math.sin(lam)], [0.0, math.cos(phi)]])
    try:
        s = np.linalg.solve(j, np.array([img_w, img_n]))
    except np.linalg.LinAlgError:
        return img_w, img_n
    return float(s[0]), float(s[1])


def _mu(lat: float, lon: float) -> float:
    """Cosine of the angle from disk centre: 1 at centre, 0 at the limb."""
    return max(0.0, math.cos(math.radians(lat)) * math.cos(math.radians(lon)))


def _compass(e: float, n: float) -> str:
    if abs(n) >= abs(e):
        return "north" if n > 0 else "south"
    return "west" if e > 0 else "east"


def _rope_type(tilt: float, fe: float, fn: float, ae: float, an: float) -> str:
    """Bothmer & Schwenn: field at the front, along the axis, at the back."""
    t = tilt if tilt <= 90 else 180 - tilt
    if t <= 45:
        lead = "N" if fn > 0 else "S"
        back = "S" if lead == "N" else "N"
        axis = "W" if ae > 0 else "E"
    else:
        lead = "W" if fe > 0 else "E"
        back = "E" if lead == "W" else "W"
        axis = "N" if an > 0 else "S"
    return lead + axis + back


def disk_position(lat: float, lon: float, b0: float, cx: float, cy: float, r_px: float) -> tuple[float, float] | None:
    """Pixel position of a Stonyhurst point on a north-up full-disk image."""
    phi, lam, b = math.radians(lat), math.radians(lon), math.radians(b0)
    x = math.cos(phi) * math.sin(lam)
    y = math.sin(phi) * math.cos(b) - math.cos(phi) * math.cos(lam) * math.sin(b)
    front = math.sin(phi) * math.sin(b) + math.cos(phi) * math.cos(lam) * math.cos(b)
    if front <= 0.05:
        return None   # on the far side or at the limb
    return cx + x * r_px, cy - y * r_px


def solar_b0(t_ms: int) -> float:
    """Heliographic latitude of disk centre (degrees), low-precision formula."""
    jd = t_ms / 86400000.0 + 2440587.5
    t = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + 36000.76983 * t) % 360
    m = math.radians((357.52911 + 35999.05029 * t) % 360)
    c = (1.914602 - 0.004817 * t) * math.sin(m) + 0.019993 * math.sin(2 * m)
    lam = math.radians(l0 + c)
    k = math.radians(73.6667 + 1.3958333 * (jd - 2396758.0) / 36525.0)
    inc = math.radians(7.25)
    return math.degrees(math.asin(math.sin(lam - k) * math.sin(inc)))
