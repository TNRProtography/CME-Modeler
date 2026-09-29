"""
Where the data comes from. Every fetch is logged into a per-CME trail so a
result always says what was used and why anything was missing.

  DONKI CMEs and flares   nasa-donki-api worker (already cached, keyed)
  Coronagraph frames      coronagraphy-processing worker (7 days: LASCO C2/C3,
                          STEREO-A COR2, CCOR-1, CCOR-2), then Helioviewer for
                          LASCO and COR2 where the store has no coverage
  Spacecraft positions    JPL Horizons (STEREO-A relative to Earth)
  Magnetograms            Helioviewer (HMI, any date), then the sdo-imagery
                          worker's stored frames
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
from PIL import Image

UA = "SpotTheAurora-CME-Orientation/1.0 (+https://www.spottheaurora.co.nz)"
DONKI = "https://nasa-donki-api.thenamesrock.workers.dev"
CORONA = "https://coronagraphy-processing.thenamesrock.workers.dev"
SDO = "https://sdo-imagery.thenamesrock.workers.dev"
HV = "https://api.helioviewer.org/v2"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"

_session = requests.Session()
_session.headers["User-Agent"] = UA


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ms(s: str | None) -> int | None:
    if not s:
        return None
    s = s.strip().replace(" ", "T")
    if re.match(r".*T\d\d:\d\dZ$", s):
        s = s[:-1] + ":00Z"
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return int(d.timestamp() * 1000)


def get(url: str, params: dict | None = None, timeout: float = 40, tries: int = 3):
    last = None
    for k in range(tries):
        try:
            r = _session.get(url, params=params, timeout=timeout)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
            if r.status_code in (400, 401, 403, 404):
                break
        except requests.RequestException as e:
            last = type(e).__name__
        time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"{url.split('?')[0]}: {last}")


def get_json(url: str, params: dict | None = None):
    return get(url, params).json()


def to_gray(data: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(data))
    im = im.convert("L")
    return np.asarray(im, dtype=np.float32) / 255.0


# ── DONKI ───────────────────────────────────────────────────────────────────

NASA_DONKI = "https://api.nasa.gov/DONKI"


def donki_cmes(days: int = 7) -> list[dict]:
    """
    DONKI's CMEs for the last week: from our nasa-donki-api worker, which the
    app reads too, or straight from NASA if the worker's answer is not a list.
    What came back is printed either way, so a run log always shows why.
    """
    try:
        r = get(f"{DONKI}/CME")
        ctype = r.headers.get("content-type", "")
        try:
            data = r.json()
        except ValueError:
            data = None
        shape = f"list of {len(data)}" if isinstance(data, list) else type(data).__name__
        print(f"nasa-donki-api /CME: HTTP {r.status_code}, {ctype}, {len(r.content)} bytes, {shape}")
        if isinstance(data, list) and data:
            return data
        if not isinstance(data, list):
            print(f"  starts: {r.text[:200]!r}")
    except Exception as e:
        print(f"nasa-donki-api /CME failed: {e}")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    try:
        data = get_json(f"{NASA_DONKI}/CME", {
            "startDate": start.strftime("%Y-%m-%d"), "endDate": end.strftime("%Y-%m-%d"),
            "api_key": os.environ.get("NASA_API_KEY") or "DEMO_KEY",
        })
        print(f"NASA DONKI directly: {len(data) if isinstance(data, list) else type(data).__name__}")
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"NASA DONKI directly failed: {e}")
        return []


def donki_flares() -> list[dict]:
    try:
        data = get_json(f"{DONKI}/FLR")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def pick_analysis(cme: dict) -> dict | None:
    """The analysis the app and the push worker use: most accurate, else first."""
    an = cme.get("cmeAnalyses") or []
    if not an:
        return None
    for a in an:
        if a.get("isMostAccurate"):
            return a
    return an[0]


# ── Spacecraft positions ────────────────────────────────────────────────────

_pos_cache: dict = {}


def stereo_a_position(t_ms: int) -> tuple[float, float]:
    """STEREO-A's Stonyhurst-like longitude (west-positive) and latitude,
    relative to Earth, from JPL Horizons heliocentric ecliptic vectors."""
    hour = t_ms // 3600000
    if hour in _pos_cache:
        return _pos_cache[hour]
    a = _horizons_vector("-234", t_ms)
    e = _horizons_vector("399", t_ms)
    lon = math.degrees(math.atan2(a[1], a[0]) - math.atan2(e[1], e[0]))
    lon = (lon + 180) % 360 - 180
    lat = math.degrees(math.atan2(a[2], math.hypot(a[0], a[1])))
    _pos_cache[hour] = (lon, lat)
    return lon, lat


def _horizons_vector(target: str, t_ms: int) -> tuple[float, float, float]:
    start = iso(t_ms)[:16].replace("T", " ")
    stop = iso(t_ms + 3600000)[:16].replace("T", " ")
    params = {
        "format": "json", "COMMAND": f"'{target}'", "EPHEM_TYPE": "'VECTORS'",
        "CENTER": "'500@10'", "REF_PLANE": "'ECLIPTIC'", "VEC_TABLE": "'1'",
        "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": "'1h'",
        "OUT_UNITS": "'AU-D'", "CSV_FORMAT": "'NO'",
    }
    res = get_json(HORIZONS, params).get("result", "")
    block = res.split("$$SOE", 1)[-1].split("$$EOE", 1)[0]
    m = re.search(r"X\s*=\s*([-+.\dE]+)\s+Y\s*=\s*([-+.\dE]+)\s+Z\s*=\s*([-+.\dE]+)", block)
    if not m:
        raise RuntimeError(f"Horizons gave no vector for {target}")
    return float(m.group(1)), float(m.group(2)), float(m.group(3))


# ── Coronagraph frames ──────────────────────────────────────────────────────

# Everything on the Sun-Earth line sees from Earth's longitude; only STEREO-A
# is elsewhere. CCOR-1 is at geostationary orbit, SOHO and SWFO-L1 at L1: all
# within a fraction of a degree of Earth's line, seen from the Sun.
CORONAGRAPHS = {
    "soho_c2": {"label": "SOHO LASCO C2", "earth_line": True, "hv": ["SOHO", "LASCO", "C2", "white-light"], "scale": 23.8},
    "soho_c3": {"label": "SOHO LASCO C3", "earth_line": True, "hv": ["SOHO", "LASCO", "C3", "white-light"], "scale": 112.0},
    "stereo_cor2": {"label": "STEREO-A COR2", "earth_line": False, "hv": ["STEREO_A", "SECCHI", "COR2", "white-light"], "scale": 59.0},
    "ccor1": {"label": "GOES-19 CCOR-1", "earth_line": True, "hv": None, "scale": None},
    "ccor2": {"label": "SWFO-L1 CCOR-2", "earth_line": True, "hv": None, "scale": None},
}

_frames_index: dict = {}


def stored_frames(source: str) -> list[dict]:
    if source not in _frames_index:
        try:
            data = get_json(f"{CORONA}/api/frames", {"source": source})
            _frames_index[source] = [
                {"t": parse_ms(f.get("ts")), "url": CORONA + f["url"]}
                for f in data.get("frames", []) if f.get("url") and parse_ms(f.get("ts"))
            ]
        except Exception as e:
            _frames_index[source] = []
            _frames_index[f"{source}:error"] = str(e)
    return _frames_index[source]


def choose_times(frames: list[dict], t0: int) -> list[dict]:
    """Up to 4 before launch and one per ~25 minutes for 8 hours after."""
    before = [f for f in frames if t0 - 150 * 60000 <= f["t"] <= t0 - 5 * 60000][-4:]
    after, last = [], -math.inf
    for f in sorted((f for f in frames if t0 - 20 * 60000 <= f["t"] <= t0 + 8 * 3600000), key=lambda f: f["t"]):
        if f["t"] - last >= 25 * 60000:
            after.append(f)
            last = f["t"]
    return before + after


def load_frames(chosen: list[dict]) -> list[tuple[int, np.ndarray]]:
    out = []
    for f in chosen:
        try:
            out.append((f["t"], to_gray(get(f["url"]).content)))
        except Exception:
            continue
    return out


# Helioviewer: renders any archived image at a stated scale, centred on the
# Sun, so the geometry is known exactly.

_hv_ids: dict = {}
_hv_tree: dict | None = None

# Known Helioviewer source IDs, used only if the data-source listing cannot be
# read or searched. These have been stable for years.
_HV_KNOWN = {
    ("SOHO", "LASCO", "C2", "white-light"): 4,
    ("SOHO", "LASCO", "C3", "white-light"): 5,
    ("SDO", "HMI", "magnetogram"): 19,
}


def _hv_leaves(node, path=()):
    """Every (path, sourceId) in Helioviewer's nested data-source listing."""
    if isinstance(node, dict):
        if "sourceId" in node:
            yield path, node["sourceId"]
            return
        for k, v in node.items():
            yield from _hv_leaves(v, path + (str(k),))


def hv_source_id(path: list[str]) -> int | None:
    """
    Helioviewer's source ID for an instrument, found by name.

    The listing does not nest the same way for every instrument (HMI has no
    separate detector level; LASCO does), so the names are matched as an
    ordered subsequence of each entry's path, case-insensitively, rather than
    walked level by level.
    """
    global _hv_tree
    key = "/".join(path)
    if key in _hv_ids:
        return _hv_ids[key]
    if _hv_tree is None:
        try:
            _hv_tree = get_json(f"{HV}/getDataSources/", {"verbose": "true"})
        except Exception as e:
            print(f"Helioviewer data sources unavailable: {e}")
            _hv_tree = {}
    want = [p.lower() for i, p in enumerate(path) if i == 0 or p.lower() != path[i - 1].lower()]
    found = None
    for leaf_path, sid in _hv_leaves(_hv_tree):
        names = [n.lower() for n in leaf_path]
        it = iter(names)
        if all(any(w == n for n in it) for w in want):
            found = int(sid)
            break
    if found is None:
        found = _HV_KNOWN.get(tuple(p for i, p in enumerate(path) if i == 0 or p != path[i - 1]))
    print(f"Helioviewer source {key}: {found}")
    _hv_ids[key] = found
    return found


def hv_screenshot(path: list[str], sid: int, params: dict) -> bytes:
    """A Helioviewer screenshot, naming the layer by instrument and, if that
    is refused, by source ID: both forms are documented for the API."""
    last = None
    for layer in ("[" + ",".join(path) + ",1,100]", f"[{sid},1,100]"):
        try:
            r = get(f"{HV}/takeScreenshot/", {**params, "layers": layer, "display": "true", "watermark": "false"},
                    timeout=90, tries=2)
            if r.headers.get("content-type", "").startswith("image/"):
                return r.content
            last = f"not an image ({r.headers.get('content-type')}): {r.text[:120]!r}"
        except Exception as e:
            last = str(e)
    raise RuntimeError(f"Helioviewer screenshot failed: {last}")


def hv_frames(path: list[str], scale: float, t0: int, size: int = 512) -> list[tuple[int, np.ndarray]]:
    sid = hv_source_id(path)
    if sid is None:
        return []
    wanted = [t0 - m * 60000 for m in (90, 60, 30)] + [t0 + m * 60000 for m in range(20, 8 * 60, 40)]
    seen, out = set(), []
    for w in wanted:
        try:
            info = get_json(f"{HV}/getClosestImage/", {"date": iso(w), "sourceId": sid})
        except Exception:
            continue
        t = parse_ms(info.get("date"))
        if not t or info.get("id") in seen or abs(t - w) > 45 * 60000:
            continue
        seen.add(info.get("id"))
        try:
            png = hv_screenshot(path, sid, {"date": iso(t), "imageScale": scale,
                                            "x0": 0, "y0": 0, "width": size, "height": size})
            out.append((t, to_gray(png)))
        except Exception as e:
            if not out:
                print(f"  Helioviewer {'/'.join(path)} at {iso(t)}: {e}")
            continue
    return out


# ── Magnetograms ────────────────────────────────────────────────────────────

def rsun_arcsec(t_ms: int) -> float:
    jd = t_ms / 86400000.0 + 2440587.5
    g = math.radians((357.529 + 0.98560028 * (jd - 2451545.0)) % 360)
    dist = 1.00014 - 0.01671 * math.cos(g) - 0.00014 * math.cos(2 * g)
    return 959.63 / dist


def hv_magnetogram_cutout(t_ms: int, x_arcsec: float, y_arcsec: float, scale: float = 0.6, size: int = 480):
    """HMI magnetogram centred on a point, at a stated scale."""
    sid = hv_source_id(["SDO", "HMI", "magnetogram"])
    if sid is None:
        raise RuntimeError("Helioviewer has no HMI magnetogram source")
    info = get_json(f"{HV}/getClosestImage/", {"date": iso(t_ms), "sourceId": sid})
    t = parse_ms(info.get("date"))
    if not t or abs(t - t_ms) > 3 * 3600000:
        raise RuntimeError("no HMI magnetogram within 3 hours")
    png = hv_screenshot(["SDO", "HMI", "HMI", "magnetogram"], sid, {
        "date": iso(t), "imageScale": scale,
        "x0": round(x_arcsec, 1), "y0": round(y_arcsec, 1), "width": size, "height": size,
    })
    return t, to_gray(png)


def stored_magnetogram(t_ms: int):
    """The sdo-imagery worker's nearest magnetogram before t: full disk."""
    data = get_json(f"{SDO}/api/frames", {"mode": "magnetogram", "from": t_ms - 4 * 3600000, "to": t_ms})
    frames = [f for f in data.get("frames", []) if f.get("atMs")]
    if not frames:
        raise RuntimeError("no stored magnetogram within 4 hours before launch")
    f = max(frames, key=lambda x: x["atMs"])
    url = f.get("detail") or f["url"]
    return f["atMs"], to_gray(get(url).content)


def find_disk(img: np.ndarray) -> tuple[float, float, float] | None:
    """Centre and radius of the solar disk on a full-disk image."""
    on = img > 0.06
    if on.sum() < 1000:
        return None
    ys, xs = np.nonzero(on)
    r = math.sqrt(on.sum() / math.pi)
    return float(xs.mean()), float(ys.mean()), r
