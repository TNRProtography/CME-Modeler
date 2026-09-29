"""
Geometry shared by every step: directions, observers, position angles, and
the elliptical cone a CME is modelled as.

Frame (heliocentric, Earth-referenced, close to HEEQ):
  x  from the Sun toward Earth
  z  solar north
  y  completes it: west, as Earth sees it (Stonyhurst longitude is west-positive)

A direction is given by Stonyhurst longitude and latitude, the same numbers
DONKI reports for a CME. Observers far from the Sun (every spacecraft here is
at ~1 AU, the CME at under 30 solar radii) are treated as seeing the Sun along
a fixed line, which is accurate to well under a degree.

Position angle (PA) is the coronagraph convention: degrees counter-clockwise
from solar north on the image, so 90 is east (image left) and 270 is west.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

NORTH = np.array([0.0, 0.0, 1.0])


def unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def direction(lon_deg: float, lat_deg: float) -> np.ndarray:
    """Unit vector for a Stonyhurst longitude (west-positive) and latitude."""
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def lon_lat(d: np.ndarray) -> tuple[float, float]:
    d = unit(d)
    return math.degrees(math.atan2(d[1], d[0])), math.degrees(math.asin(max(-1.0, min(1.0, d[2]))))


def angle_between(a: np.ndarray, b: np.ndarray) -> float:
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(unit(a), unit(b)))))))


@dataclass
class Observer:
    """A spacecraft's viewpoint, as the direction from the Sun to it."""
    name: str
    lon: float  # Stonyhurst, degrees, west-positive
    lat: float = 0.0

    @property
    def o(self) -> np.ndarray:
        return direction(self.lon, self.lat)

    def basis(self) -> tuple[np.ndarray, np.ndarray]:
        """Image 'up' (solar north projected) and image 'east' (left)."""
        o = self.o
        up = unit(NORTH - np.dot(NORTH, o) * o)
        east = np.cross(o, up)
        return up, east

    def pa_of(self, d: np.ndarray) -> float:
        """Position angle at which direction d appears in this observer's image."""
        up, east = self.basis()
        return math.degrees(math.atan2(float(np.dot(d, east)), float(np.dot(d, up)))) % 360.0

    def pa_direction(self, pa_deg: float) -> np.ndarray:
        """The in-sky direction for a position angle, in 3D."""
        up, east = self.basis()
        a = math.radians(pa_deg)
        return math.cos(a) * up + math.sin(a) * east


def pa_diff(a: float, b: float) -> float:
    """Signed smallest difference a - b in degrees, in (-180, 180]."""
    d = (a - b + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def axial_diff(a: float, b: float) -> float:
    """Difference between two axis angles, which repeat every 180 degrees."""
    d = (a - b + 90.0) % 180.0 - 90.0
    return abs(d)


def axial_mean(angles: list[float], weights: list[float]) -> float:
    """Weighted mean of axis angles (mod 180), via doubled angles."""
    c = sum(w * math.cos(math.radians(2 * a)) for a, w in zip(angles, weights))
    s = sum(w * math.sin(math.radians(2 * a)) for a, w in zip(angles, weights))
    return (math.degrees(math.atan2(s, c)) / 2.0) % 180.0


def to_signed_tilt(a: float) -> float:
    """Axis angle mod 180 expressed in (-90, 90]: 0 horizontal, +/-90 vertical."""
    a = a % 180.0
    return a - 180.0 if a > 90.0 else a


# ── The CME as an elliptical cone ──────────────────────────────────────────
#
# A flux-rope CME is wider along its axis than across it. Its outline is
# modelled as a cone about the propagation direction d whose half-angle is
# half_face along the rope axis and half_edge across it. The rope axis lies
# at `tilt` degrees from the local horizontal (parallel to the solar
# equator), counter-clockwise toward north as seen from along d: the same
# convention used for the source region's neutral line, so the two compare.

def local_axes(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Horizontal (west-ish) and vertical (north-ish) unit vectors across d."""
    h = np.cross(NORTH, d)
    if np.linalg.norm(h) < 1e-9:  # d along the pole: any horizontal will do
        h = np.array([0.0, 1.0, 0.0])
    h = unit(h)
    v = np.cross(d, h)
    return h, unit(v)


def cone_outline(d: np.ndarray, tilt: float, half_face: float, half_edge: float, n: int = 72) -> np.ndarray:
    """Directions around the cone's rim."""
    h, v = local_axes(d)
    t = math.radians(tilt)
    axis = math.cos(t) * h + math.sin(t) * v
    across = np.cross(d, axis)
    out = []
    for k in range(n):
        phi = 2 * math.pi * k / n
        wf, we = math.radians(half_face), math.radians(half_edge)
        w = 1.0 / math.sqrt((math.cos(phi) / wf) ** 2 + (math.sin(phi) / we) ** 2)
        a = math.cos(phi) * axis + math.sin(phi) * across
        out.append(math.cos(w) * d + math.sin(w) * a)
    return np.array(out)


def cone_contains(d: np.ndarray, tilt: float, half_face: float, half_edge: float, q: np.ndarray) -> bool:
    """Whether direction q lies inside the cone (used for halos)."""
    ang = math.radians(angle_between(d, q))
    if ang < 1e-9:
        return True
    h, v = local_axes(d)
    t = math.radians(tilt)
    axis = math.cos(t) * h + math.sin(t) * v
    across = np.cross(d, axis)
    perp = unit(q - np.dot(q, d) * d)
    phi = math.atan2(float(np.dot(perp, across)), float(np.dot(perp, axis)))
    wf, we = math.radians(half_face), math.radians(half_edge)
    w = 1.0 / math.sqrt((math.cos(phi) / wf) ** 2 + (math.sin(phi) / we) ** 2)
    return ang <= w


# Parts of a CME close to an observer's line of sight project right next to
# the Sun, behind the occulter or into a sliver beside it, and do not count
# toward the arc a view measures. How close is "close" depends on the
# instrument's field of view and how far out the CME is, so the fit treats it
# as a free parameter shared by every view (fit.HIDDEN_CHOICES); this is the
# default for a single projection.
HIDDEN_NEAR_LOS_DEG = 32.0
SCALES = (0.35, 0.6, 0.8, 1.0)


def cone_points(d: np.ndarray, tilt: float, half_face: float, half_edge: float) -> np.ndarray:
    """Directions filling the cone: rims at several fractions, plus the axis."""
    pts = [cone_outline(d, tilt, half_face * s, max(1.0, half_edge * s)) for s in SCALES]
    return np.vstack(pts + [d[None, :]])


def span_of_points(obs: Observer, pts: np.ndarray, hidden_deg: float = HIDDEN_NEAR_LOS_DEG):
    """(halo, pa_start, pa_width) of the part of a point set clear of the line of sight."""
    o = obs.o
    up, east = obs.basis()
    vis = pts[np.abs(pts @ o) < math.cos(math.radians(hidden_deg))]
    if len(vis) < 3:
        return True, 0.0, 360.0
    pas = np.sort(np.degrees(np.arctan2(vis @ east, vis @ up)) % 360.0)
    gaps = np.diff(np.concatenate([pas, [pas[0] + 360.0]]))
    i = int(np.argmax(gaps))
    width = 360.0 - float(gaps[i])
    if width >= 300.0:
        return True, 0.0, 360.0
    return False, float(pas[(i + 1) % len(pas)]), width


def projected_span(obs: Observer, d: np.ndarray, tilt: float, half_face: float, half_edge: float,
                   hidden_deg: float = HIDDEN_NEAR_LOS_DEG):
    """
    What the observer sees: (halo, pa_start, pa_width), PAs counter-clockwise.

    Only the part of the cone clear of the line of sight counts. Seen along
    the cone that part surrounds the occulter (a halo) or, when the cone is
    off-centre, forms a partial halo: an arc, as measured.
    """
    return span_of_points(obs, cone_points(d, tilt, half_face, half_edge), hidden_deg)
