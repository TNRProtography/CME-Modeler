"""
Self-test on synthetic data with a known answer.

A CME of known direction, tilt and widths is rendered as it would appear in
coronagraph frames from Earth's line and from STEREO-A, with a radial
background, an occulter and pylon, static labels and a timestamp that changes
every frame. A magnetogram is rendered with a bipole whose neutral line has a
known angle. The pipeline must recover them.

    python3 scripts/cme_orientation/test_orientation.py
"""

from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from geometry import Observer, angle_between, axial_diff, direction, local_axes  # noqa: E402
from detect import Frame, detect_view, find_occulter  # noqa: E402
from fit import Measurement, fit_direction, fit_tilt  # noqa: E402
from pil import disk_position, measure_pil  # noqa: E402

PASS = FAIL = 0


def check(ok: bool, label: str, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label} {detail}")


RNG = np.random.default_rng(7)
SIZE, CX, CY, R_OCC = 512, 256.0, 256.0, 50.0
PX_PER_RS = R_OCC / 2.2
HOUR = 3600000
T0 = 1_790_000_000_000


def render_frame(obs: Observer, t_ms: int, cme: dict | None) -> np.ndarray:
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    r = np.hypot(xx - CX, yy - CY)
    img = 0.9 * (R_OCC / np.maximum(r, 1)) ** 1.4
    # A streamer that does not change.
    pa = (np.degrees(np.arctan2(-(xx - CX), -(yy - CY))) % 360)
    img += 0.15 * np.exp(-((pa - 300) / 8.0) ** 2) * (R_OCC / np.maximum(r, 1))
    if cme and t_ms > cme["t0"]:
        img += render_cme(obs, (t_ms - cme["t0"]) / HOUR, cme)
    img *= RNG.uniform(0.92, 1.08)               # exposure changes frame to frame
    img += RNG.normal(0, 0.012, img.shape)
    img[r < R_OCC] = 0.03
    # The occulter's support pylon.
    img[(np.abs(pa - 225) < 6) & (r < 150)] = 0.03
    # A thin drawn circle for the solar limb inside the occulter.
    img[np.abs(r - R_OCC / 2.2) < 0.8] = 0.9
    # Static label, and a timestamp that changes every frame.
    img[8:24, 10:120] = 0.9
    img[SIZE - 22:SIZE - 8, 150:360] = RNG.uniform(0, 1, (14, 210))
    return np.clip(img, 0, 1.5)


def render_cme(obs: Observer, hours: float, cme: dict) -> np.ndarray:
    d = direction(cme["lon"], cme["lat"])
    h, v = local_axes(d)
    t = math.radians(cme["tilt"])
    axis = math.cos(t) * h + math.sin(t) * v
    across = np.cross(d, axis)
    front = 2.2 + 1.6 * hours                  # solar radii
    n = 25000
    phi = RNG.uniform(0, 2 * math.pi, n)
    s = np.sqrt(RNG.uniform(0, 1, n))
    wf, we = math.radians(cme["face"]), math.radians(cme["edge"])
    w = s / np.sqrt((np.cos(phi) / wf) ** 2 + (np.sin(phi) / we) ** 2)
    a = np.outer(np.cos(phi), axis) + np.outer(np.sin(phi), across)
    dirs = np.cos(w)[:, None] * d + np.sin(w)[:, None] * a
    dist = front * (0.7 + 0.3 * RNG.uniform(0, 1, n) ** 0.5)
    pts = dirs * dist[:, None]
    up, east = obs.basis()
    px = CX - (pts @ east) * PX_PER_RS
    py = CY - (pts @ up) * PX_PER_RS
    img, _, _ = np.histogram2d(py, px, bins=SIZE, range=[[0, SIZE], [0, SIZE]])
    from scipy import ndimage
    return 0.5 * ndimage.gaussian_filter(img, 2.5) / max(1.0, n / 4000)


def run_case(name: str, cme: dict, observers: list[Observer]) -> None:
    print(f"\n{name}")
    truth = direction(cme["lon"], cme["lat"])
    meas = []
    for obs in observers:
        frames = [Frame(T0 + k * 20 * 60000, render_frame(obs, T0 + k * 20 * 60000, cme)) for k in range(-4, 22)]
        prior = obs.pa_of(truth + RNG.normal(0, 0.15, 3))       # DONKI is roughly right
        v = detect_view(obs.name, frames, cme["t0"], prior, False)
        print(f"        {obs.name}: {v.reason}, pa {v.pa and round(v.pa)}, width {v.width and round(v.width)}, snr {v.snr:.1f}")
        if v.detected:
            meas.append(Measurement(obs, v.halo, v.pa, v.pa_start, v.width, v.snr))
    check(len(meas) == len(observers), f"the CME is found in every view ({len(meas)}/{len(observers)})")
    donki_prior = direction(cme["lon"] + 15, cme["lat"] - 10)   # DONKI 18 degrees off
    dfit = fit_direction(meas, donki_prior)
    err = angle_between(dfit["vector"], truth)
    check(err < 12, f"direction within 12 degrees ({err:.1f}; lon {dfit['lon']} lat {dfit['lat']}, "
                    f"confidence {dfit['confidence']}, {dfit['basis']})")
    tfit = fit_tilt(meas, dfit["vector"], None)
    got = f"true {cme['tilt']}, got {tfit and tfit['tilt']} +/-{tfit and tfit['uncertainty']}, " \
          f"confidence {tfit and tfit['confidence']}, {'constrained' if tfit and tfit['constrained'] else 'unconstrained'}"
    # Never confidently wrong: a tilt reported as constrained must be close.
    # Where the views cannot settle it, it must say so (the source region
    # then supplies the tilt).
    wrong = tfit is not None and tfit["constrained"] and axial_diff(tfit["tilt"], cme["tilt"]) > 30
    check(not wrong, f"no confident wrong tilt ({got})")
    if cme.get("expect_tilt"):
        ok = tfit is not None and tfit["constrained"] and axial_diff(tfit["tilt"], cme["tilt"]) <= 30
        check(ok, f"this geometry pins the tilt down ({got})")


t0 = T0 + 60 * 60000
earth = Observer("Earth line", 0.0)
stereo = Observer("STEREO-A", 68.0)

run_case("A CME off the west limb, steeply tilted",
         {"lon": 55, "lat": -12, "tilt": 70, "face": 45, "edge": 18, "t0": t0, "expect_tilt": True}, [earth, stereo])
run_case("A CME toward the east, low tilt",
         {"lon": -50, "lat": 18, "tilt": 15, "face": 50, "edge": 20, "t0": t0}, [earth, stereo])
run_case("The screenshot's CME: 29 W, 15 N",
         {"lon": 29, "lat": 15, "tilt": 40, "face": 40, "edge": 18, "t0": t0}, [earth, stereo])

print("\nNothing but a streamer and noise")
frames = [Frame(T0 + k * 20 * 60000, render_frame(earth, T0 + k * 20 * 60000, None)) for k in range(-4, 22)]
v = detect_view("Earth line", frames, t0, 90.0, False)
check(not v.detected, f"no CME is reported ({v.reason})")

print("\nOcculter")
g = find_occulter(render_frame(earth, T0, None))
check(abs(g.cx - CX) < 3 and abs(g.cy - CY) < 3 and abs(g.r_in - R_OCC) < 5,
      f"centre and radius found despite the pylon and drawn limb ({g.cx:.1f}, {g.cy:.1f}, r {g.r_in:.1f})")


def render_magnetogram(lat0, lon0, tilt, pos_side_sign=1, b0=3.0):
    """A bipole on a full-disk image; the PIL runs at `tilt` on the surface."""
    n, r_px = 1024, 470.0
    yy, xx = np.mgrid[0:n, 0:n]
    x = (xx - n / 2) / r_px
    y = -(yy - n / 2) / r_px
    on = x ** 2 + y ** 2 < 1
    z = np.sqrt(np.clip(1 - x ** 2 - y ** 2, 0, 1))
    b = math.radians(b0)
    # Undo the B0 tilt to heliographic coordinates.
    sy = y * math.cos(b) + z * math.sin(b)
    lat = np.degrees(np.arcsin(np.clip(sy, -1, 1)))
    lon = np.degrees(np.arctan2(x, z * math.cos(b) - y * math.sin(b)))
    # Local surface offsets (degrees) from the region centre.
    de = (lon - lon0) * np.cos(np.radians(lat0))
    dn = lat - lat0
    t = math.radians(tilt)
    along = de * math.cos(t) + dn * math.sin(t)
    normal = -de * math.sin(t) + dn * math.cos(t)
    field = pos_side_sign * (np.exp(-((normal - 2.0) ** 2 + (along / 3.0) ** 2) / 2)
                             - np.exp(-((normal + 2.0) ** 2 + (along / 3.0) ** 2) / 2))
    g = 0.5 + 0.45 * np.clip(field, -1, 1)
    g[~on] = 0.0
    return g, n / 2, n / 2, r_px


print("\nSource region neutral line")
for lat0, lon0, tilt in [(18, 25, 35), (-15, -40, 120), (8, 55, 80)]:
    img, cx, cy, r_px = render_magnetogram(lat0, lon0, tilt)
    xy = disk_position(lat0, lon0, 3.0, cx, cy, r_px)
    out = measure_pil(img, xy, r_px, lat0, lon0)
    ok = out is not None and axial_diff(out["tilt"], tilt) <= 12
    check(ok, f"{lat0:+} {lon0:+}: tilt {tilt} measured {out and out['tilt']} "
              f"(clarity {out and out['clarity']}, confidence {out and out['confidence']})")
img, cx, cy, r_px = render_magnetogram(18, 25, 0, pos_side_sign=1)
north_pos = measure_pil(img, disk_position(18, 25, 3.0, cx, cy, r_px), r_px, 18, 25)
img, cx, cy, r_px = render_magnetogram(18, 25, 0, pos_side_sign=-1)
south_pos = measure_pil(img, disk_position(18, 25, 3.0, cx, cy, r_px), r_px, 18, 25)
check(north_pos and south_pos and north_pos["leadingField"] == "south" and south_pos["leadingField"] == "north",
      f"leading field follows which side is positive (positive north -> {north_pos and north_pos['leadingField']}, "
      f"{north_pos and north_pos['ropeType']}; positive south -> {south_pos and south_pos['leadingField']}, "
      f"{south_pos and south_pos['ropeType']})")


print("\nEnd to end: a DONKI record, synthetic frames and magnetogram, no network")
import sources as S  # noqa: E402
import run as R  # noqa: E402
truth = {"lon": 55, "lat": -12, "tilt": 70, "face": 45, "edge": 18, "t0": T0 + 60 * 60000}
stereo_lon = 68.0
frame_times = [T0 + k * 20 * 60000 for k in range(-4, 22)]
def fake_stored(source):
    if source in ("soho_c2", "stereo_cor2"):
        return [{"t": t, "url": f"{source}|{t}"} for t in frame_times]
    return []
def fake_load(chosen):
    out = []
    for f in chosen:
        source, t = f["url"].split("|")
        obs = Observer("x", stereo_lon if source == "stereo_cor2" else 0.0)
        out.append((int(t), render_frame(obs, int(t), truth)))
    return out
S.stored_frames = fake_stored
S.load_frames = fake_load
S.hv_frames = lambda *a, **k: []
S.stereo_a_position = lambda t: (stereo_lon, 0.0)
# A source region whose neutral line lies along the true tilt (70 deg).
mag, mcx, mcy, mr = render_magnetogram(-14, 50, 70)
def no_hv(*a, **k):
    raise RuntimeError("offline")
S.hv_magnetogram_cutout = no_hv
S.stored_magnetogram = lambda t: (t, mag)
record = {
    "activityID": "2026-09-28T14:36:00-CME-001", "startTime": S.iso(truth["t0"]),
    "sourceLocation": "S14W50",
    "cmeAnalyses": [{"isMostAccurate": True, "longitude": 70, "latitude": -2, "halfAngle": 35, "speed": 700}],
}
r = R.analyse(record, [record], [], truth["t0"] + 5 * 3600000)
print("        status", r["status"], "tilt", r["tilt"], "confidence", r["confidence"], "|", "; ".join(r["notes"]))
print("        direction", r["direction"])
print("        field", r["field"])
check(r["tilt"] is not None and axial_diff(r["tilt"] % 180, 70) <= 30 and r["confidence"] >= 25,
      f"the tilt comes out near the truth ({r['status']}, {r['tilt']})")
cor = r["estimates"].get("coronagraph")
check(not cor or axial_diff(cor["tilt"] % 180, 70) <= 30, "and no estimate contradicts it")

print("\nCombining estimates")
st, tl, cf, note = R.combine([("coronagraph", {"tilt": 60.0, "confidence": 55}), ("sourceRegion", {"tilt": 75.0, "confidence": 50})])
check(st == "confirmed" and 60 <= tl <= 75 and cf == 70, f"two agreeing: confirmed, between them, more confident ({st} {tl:.0f} {cf}; {note})")
st, tl, cf, note = R.combine([("coronagraph", {"tilt": 170.0, "confidence": 55}), ("sourceRegion", {"tilt": 10.0, "confidence": 50})])
check(st == "confirmed", f"agreement wraps around: 170 and 10 are 20 apart ({st}; {note})")
st, tl, cf, note = R.combine([("coronagraph", {"tilt": 10.0, "confidence": 55}), ("sourceRegion", {"tilt": 80.0, "confidence": 50})])
check(st == "estimated" and tl == 10.0 and cf == 30, f"disagreeing: estimated, the stronger one, 25 points less ({st} {tl} {cf}; {note})")
st, tl, cf, note = R.combine([("sourceRegion", {"tilt": 40.0, "confidence": 50})])
check(st == "estimated" and cf == 50, f"one estimate: estimated at its own confidence ({note})")
st, tl, cf, note = R.combine([("coronagraph", {"tilt": 40.0, "confidence": 20}), ("sourceRegion", {"tilt": 45.0, "confidence": 20})])
check(st != "confirmed", "two weak estimates do not confirm each other")
check(R.combine([])[0] == "unknown", "none: unknown, and the app keeps its default drawing")
check(r["direction"] and angle_between(direction(r["direction"]["lon"], r["direction"]["lat"]), direction(55, -12)) < 12
      and r["direction"]["useInModel"], "our direction is used over DONKI's 18-degree-off one")
check(json.dumps(r) is not None and all(v.get("source") for v in r["views"]), "the result serialises, with every view accounted for")
views = {v["source"]: v for v in r["views"]}
check("no frames" in views["ccor1"]["reason"], f"a view with no frames says so ({views['ccor1']['reason']})")
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
