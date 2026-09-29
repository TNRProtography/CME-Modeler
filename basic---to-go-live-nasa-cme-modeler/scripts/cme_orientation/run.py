"""
CME orientation: one run over every CME in DONKI's 7-day list.

    python3 scripts/cme_orientation/run.py            # analyse and upload
    python3 scripts/cme_orientation/run.py --dry-run  # analyse, print, no upload
    ORIENTATION_ONLY=<activityID> ... run.py          # one CME, every view's
                                                      # working numbers, no upload

For each CME:
  1. Coronagraphs. Every source with frames around the launch, from the
     coronagraph worker's week of storage or Helioviewer, is searched for the
     CME (detect.py). The views are combined into a direction (triangulated
     where the viewpoints differ) and, from the arcs each view saw, a tilt
     (fit.py).
  2. Source region. The HMI magnetogram from just before launch gives the
     neutral line's angle at DONKI's source location and, by the hemispheric
     rule, the field the rope should carry (pil.py).
  3. NASA's own tilt, when an analyst has entered one in DONKI.
  4. Combined: "confirmed" when two independent estimates agree within 30
     degrees; otherwise "estimated", with a confidence and the reasons.

Results are uploaded to the cme-orientation worker, which the app reads.
Each result records every source it tried and why any were not used.

A CME is re-analysed on every run until 36 hours after launch (later
coronagraph frames and STEREO-A's delayed data keep arriving), then kept.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))

import sources as S  # noqa: E402
from detect import Frame, detect_view  # noqa: E402
from fit import Measurement, fit_direction, fit_shape, fit_tilt  # noqa: E402
from geometry import (  # noqa: E402
    Observer, angle_between, axial_diff, axial_mean, direction, to_signed_tilt,
)
from pil import disk_position, measure_pil, parse_location, solar_b0  # noqa: E402

WORKER = os.environ.get("ORIENTATION_WORKER", "https://cme-orientation.thenamesrock.workers.dev")
TOKEN = os.environ.get("ORIENTATION_TOKEN", "")
FINAL_AFTER_MS = 36 * 3600000
AGREE_DEG = 30.0
DIRECTION_USE_MIN = 70           # confidence at which the app uses our direction
RUN_BUDGET_S = float(os.environ.get("RUN_BUDGET_S", 16 * 60))
ONLY = os.environ.get("ORIENTATION_ONLY", "").strip()
# Raised whenever the analysis changes, so every stored result is redone.
VERSION = 5


def main() -> int:
    dry = "--dry-run" in sys.argv or bool(ONLY)
    started = time.time()
    now = int(time.time() * 1000)
    previous = {}
    try:
        previous = S.get_json(f"{WORKER}/api/orientations").get("cmes", {}) or {}
    except Exception as e:
        print(f"No previous results ({e}); analysing everything.")

    cmes = S.donki_cmes()
    flares = S.donki_flares()
    print(f"{len(cmes)} CMEs from DONKI, {len(previous)} previous results")

    todo = []
    for cme in cmes:
        cid = cme.get("activityID")
        t0 = S.parse_ms(cme.get("startTime"))
        if not cid or not t0 or not S.pick_analysis(cme):
            continue
        if ONLY and cid != ONLY:
            continue
        prev = previous.get(cid)
        if not ONLY and prev and prev.get("final") and prev.get("version") == VERSION:
            continue
        todo.append((t0, cme))
    todo.sort(key=lambda x: -x[0])      # newest first: they change most
    print(f"{len(todo)} to analyse")

    results, errors = [], []
    for t0, cme in todo:
        if time.time() - started > RUN_BUDGET_S:
            print("Time budget reached; the rest wait for the next run.")
            break
        cid = cme["activityID"]
        try:
            r = analyse(cme, cmes, flares, now)
            results.append(r)
            d = r["direction"]
            print("  {}: {} tilt {} conf {} | dir {} | {}".format(
                cid, r["status"], r["tilt"], r["confidence"],
                d and (d["lon"], d["lat"], d["confidence"]), "; ".join(r["notes"][:3])))
            for v in r["views"]:
                print("      {:<12} {:<11} {}".format(v["source"], v.get("origin") or "-", v.get("reason", "")))
        except Exception as e:
            errors.append({"id": cid, "error": str(e)})
            print(f"  {cid}: FAILED {e}")
            traceback.print_exc()

    run = {
        "at": S.iso(now), "analysed": len(results), "failed": len(errors),
        "pending": max(0, len(todo) - len(results) - len(errors)),
        "seconds": round(time.time() - started), "errors": errors[:20], "version": VERSION,
    }
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a") as fh:
            fh.write(f"### CME orientation\n\n{run['analysed']} analysed, {run['failed']} failed, "
                     f"{run['pending']} left for the next run, {run['seconds']} s\n\n")
            fh.write("| CME | Status | Tilt | Confidence | Direction | Notes |\n|---|---|---|---|---|---|\n")
            for r in results:
                d = r["direction"]
                dtxt = "-" if not d else "{}, {} ({})".format(d["lon"], d["lat"], d["confidence"])
                fh.write("| {} | {} | {} | {} | {} | {} |\n".format(
                    r["id"], r["status"], r["tilt"], r["confidence"], dtxt, "; ".join(r["notes"][:2])))
    if dry or not TOKEN:
        if not TOKEN and not dry:
            print("ORIENTATION_TOKEN is not set: nothing uploaded.")
        print(json.dumps({"run": run, "results": results[:3]}, indent=1, default=str)[:4000])
        return 0
    body = json.dumps({"run": run, "results": results}, default=str)
    resp = S._session.post(f"{WORKER}/api/ingest", data=body, timeout=60,
                           headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    print(f"Upload: HTTP {resp.status_code} {resp.text[:300]}")
    return 0 if resp.ok else 1


def analyse(cme: dict, all_cmes: list[dict], flares: list[dict], now: int) -> dict:
    cid = cme["activityID"]
    t0 = S.parse_ms(cme["startTime"])
    an = S.pick_analysis(cme)
    notes: list[str] = []
    prior = direction(float(an["longitude"]), float(an["latitude"])) \
        if an.get("longitude") is not None and an.get("latitude") is not None else None
    half = float(an.get("halfAngle") or 30)

    others = [c for c in all_cmes if c.get("activityID") != cid
              and abs((S.parse_ms(c.get("startTime")) or 0) - t0) < 3 * 3600000]
    if others:
        notes.append(f"{len(others)} other CME(s) within 3 hours may overlap in the coronagraphs")

    # ── 1. Coronagraphs ────────────────────────────────────────────────────
    views, meas, shapes = [], [], []
    stereo = None
    try:
        lon, lat = S.stereo_a_position(t0)
        stereo = Observer("STEREO-A", lon, lat)
    except Exception as e:
        notes.append(f"STEREO-A position unavailable ({e}), its view is not used")
    for key, info in S.CORONAGRAPHS.items():
        obs = Observer(info["label"], 0.0) if info["earth_line"] else stereo
        if obs is None:
            views.append({"source": key, "label": info["label"], "detected": False, "reason": "no position"})
            continue
        # Every set of frames there is: the coronagraph worker's store, and
        # Helioviewer's rendering (known scale and centre, often a better
        # cadence; the store keeps LASCO only hourly). The CME is looked for in
        # each and the clearest detection kept.
        candidates = []
        chosen = S.choose_times(S.stored_frames(key), t0)
        if sum(1 for f in chosen if f["t"] < t0) >= 1 and sum(1 for f in chosen if f["t"] >= t0) >= 3:
            stored = S.load_frames(chosen)
            if len(stored) >= 4:
                candidates.append(("stored", stored, None))
        if info["hv"]:
            hv = S.hv_frames(info["hv"], info["scale"], t0)
            if len(hv) >= 4:
                candidates.append(("helioviewer", hv, (256.0, 256.0)))
        if not candidates:
            views.append({"source": key, "label": info["label"], "detected": False,
                          "reason": "no frames around launch"})
            continue
        prior_pa = obs.pa_of(prior) if prior is not None else None
        # A full halo only when DONKI's cone is close to this line of sight:
        # at 33 degrees off it with a 45-degree half-width, the 14:36 CME of
        # 2026-09-28 was a partial halo off the north-west limb, and treating it
        # as a halo let the search take the other side of the Sun.
        prior_halo = prior is not None and min(angle_between(prior, obs.o), angle_between(prior, -obs.o)) < max(15.0, half - 20)
        tried = []
        for origin, frames, hint in candidates:
            v = detect_view(key, [Frame(t, img) for t, img in frames], t0, prior_pa, prior_halo, half, hint)
            tried.append((origin, v))
            if ONLY:
                print(f"    {key} ({origin}, prior PA {prior_pa and round(prior_pa)}, halo {prior_halo}): {v.reason}; "
                      f"PA {v.pa and round(v.pa)}, width {v.width}, SNR {v.snr:.1f}; {v.debug}")
        origin, v = max(tried, key=lambda ov: (ov[1].detected, ov[1].snr))
        j = v.to_json()
        j.update({"label": info["label"], "origin": origin, "observerLon": round(obs.lon, 1)})
        views.append(j)
        if v.detected:
            meas.append(Measurement(obs, v.halo, v.pa, v.pa_start, v.width, v.snr))
            if v.shape is not None:
                shapes.append((obs, v.shape, float(min(v.shape_frames, 6))))

    direction_fit = None
    cor_tilt = None
    if meas:
        direction_fit = fit_direction(meas, prior)
        # Tilt from the CME's shape in every view, each projected from that
        # spacecraft's own position: widths alone cannot tell a tilt from its
        # mirror image. Direction is refined in the same fit.
        sf = fit_shape(shapes, direction_fit["vector"], half) if shapes else None
        if ONLY:
            print(f"    direction fit: {({k: v for k, v in direction_fit.items() if k != 'vector'})}")
            print(f"    shape fit ({len(shapes)} view(s)): {sf}")
        if sf and sf["constrained"]:
            cor_tilt = {"tilt": sf["tilt"], "uncertainty": sf["uncertainty"], "confidence": sf["confidence"],
                        "halfWidths": [sf["halfFace"], sf["halfEdge"]], "method": "shape",
                        "overlap": sf["overlap"], "mirrorMargin": sf["mirrorMargin"]}
            direction_fit["lon"], direction_fit["lat"] = (round(x, 1) for x in sf["direction"])
            direction_fit["vector"] = direction(*sf["direction"])
        elif sf:
            notes.append("the CME's shape in the coronagraphs fits several tilts about equally: tilt not constrained by them")
        else:
            tf = fit_tilt(meas, direction_fit["vector"], half)
            if tf and tf["constrained"]:
                cor_tilt = {"tilt": tf["tilt"], "uncertainty": tf["uncertainty"],
                            "confidence": min(40, tf["confidence"]), "halfWidths": [tf["halfFace"], tf["halfEdge"]],
                            "method": "widths"}
            elif tf:
                notes.append("coronagraph arcs fit a round cone as well as an oval: tilt not constrained by them")
    else:
        looked = [v for v in views if "no frames" not in v.get("reason", "") and v.get("reason") != "no position"]
        if looked:
            notes.append(f"the CME was not found in {len(looked)} coronagraph view(s) that had frames")
        else:
            notes.append("no coronagraph frames were available around the launch")
    if others and direction_fit:
        direction_fit["confidence"] = max(0, direction_fit["confidence"] - 15)

    # ── 2. Source region ───────────────────────────────────────────────────
    src_tilt = None
    loc = cme.get("sourceLocation") or _flare_location(cme, flares)
    ll = parse_location(loc)
    if not ll:
        notes.append("no source location: not every CME comes from an active region (filament or far side)")
    elif abs(ll[1]) > 70:
        notes.append(f"source {loc} is too close to the limb for a reliable magnetogram")
    else:
        src_tilt, why = _source_region(ll, t0 - 30 * 60000)
        if src_tilt:
            src_tilt["location"] = loc
        else:
            notes.append(f"source region {loc}: {why}")

    # ── 3. NASA's tilt, when entered ───────────────────────────────────────
    nasa_tilt = None
    if an.get("tilt") is not None:
        try:
            nasa_tilt = {"tilt": float(an["tilt"]) % 180, "confidence": 60}
        except (TypeError, ValueError):
            pass

    # ── Combine ────────────────────────────────────────────────────────────
    estimates = [(n, e) for n, e in (("coronagraph", cor_tilt), ("sourceRegion", src_tilt), ("nasa", nasa_tilt)) if e]
    status, tilt, conf, lead = combine(estimates)
    if lead:
        notes.insert(0, lead)

    d = None
    if direction_fit:
        d = {k: direction_fit[k] for k in ("lon", "lat", "uncertainty", "confidence", "basis", "viewpoints", "baseline")}
        d["useInModel"] = d["confidence"] >= DIRECTION_USE_MIN
        if prior is not None:
            d["offFromDonki"] = round(angle_between(direction_fit["vector"], prior), 1)

    return {
        "id": cid,
        "version": VERSION,
        "computedAt": S.iso(now),
        "startTime": S.iso(t0),
        "final": now - t0 > FINAL_AFTER_MS,
        "status": status,
        "tilt": None if tilt is None else round(to_signed_tilt(tilt), 1),
        "confidence": int(conf),
        "estimates": {n: {**e, "tilt": round(to_signed_tilt(e["tilt"]), 1)} for n, e in estimates},
        "field": src_tilt and {k: src_tilt[k] for k in ("leadingField", "axialField", "ropeType", "helicity")},
        "direction": d,
        "donki": {"lon": an.get("longitude"), "lat": an.get("latitude"), "halfAngle": an.get("halfAngle"),
                  "speed": an.get("speed")},
        "views": views,
        "notes": notes,
    }


def combine(estimates: list[tuple[str, dict]]):
    """
    (status, tilt 0-180 or None, confidence, note) from independent estimates.

    Confirmed when the most confident agrees with another within AGREE_DEG
    (both at least 25% confident). One estimate alone, or disagreeing ones,
    are 'estimated'; disagreement costs 25 points of confidence.
    """
    if not estimates:
        return "unknown", None, 0, ""
    by = dict(estimates)
    best_name, best = max(estimates, key=lambda x: x[1]["confidence"])
    agreeing = [n for n, e in estimates
                if n != best_name and axial_diff(e["tilt"], best["tilt"]) <= AGREE_DEG
                and e["confidence"] >= 25 and best["confidence"] >= 25]
    if agreeing:
        group = [best_name] + agreeing
        tilt = axial_mean([by[n]["tilt"] for n in group], [by[n]["confidence"] for n in group])
        return ("confirmed", tilt, min(95, best["confidence"] + 15),
                f"confirmed: {' and '.join(_name(n) for n in group)} agree within {AGREE_DEG:.0f} degrees")
    if len(estimates) > 1:
        return ("estimated", best["tilt"], max(10, best["confidence"] - 25),
                "estimates disagree: " + ", ".join(f"{_name(n)} {to_signed_tilt(e['tilt']):.0f}" for n, e in estimates))
    return "estimated", best["tilt"], best["confidence"], f"from {_name(best_name)} only"


def _name(n: str) -> str:
    return {"coronagraph": "coronagraphs", "sourceRegion": "the source region", "nasa": "NASA's analysis"}[n]


def _flare_location(cme: dict, flares: list[dict]) -> str | None:
    ids = {e.get("activityID") for e in (cme.get("linkedEvents") or [])}
    for f in flares:
        if f.get("flrID") in ids or f.get("activityID") in ids:
            if f.get("sourceLocation"):
                return f["sourceLocation"]
    return None


def _source_region(ll: tuple[float, float], t_ms: int):
    lat, lon = ll
    b0 = solar_b0(t_ms)
    # Helioviewer cutout at a known scale, centred on the region.
    try:
        r_as = S.rsun_arcsec(t_ms)
        x = math.cos(math.radians(lat)) * math.sin(math.radians(lon))
        y = math.sin(math.radians(lat)) * math.cos(math.radians(b0)) \
            - math.cos(math.radians(lat)) * math.cos(math.radians(lon)) * math.sin(math.radians(b0))
        t, img = S.hv_magnetogram_cutout(t_ms, x * r_as, y * r_as)
        h, w = img.shape
        out = measure_pil(img, (w / 2.0, h / 2.0), r_as / 0.6, lat, lon)
        if out:
            out["magnetogram"] = {"origin": "helioviewer", "time": S.iso(t)}
            return out, ""
        why = "no clear neutral line in the HMI magnetogram"
    except Exception as e:
        why = f"Helioviewer magnetogram unavailable ({e})"
    # The sdo-imagery worker's stored full-disk frame.
    try:
        t, img = S.stored_magnetogram(t_ms)
        disk = _disk(img)
        if not disk:
            return None, why + "; stored magnetogram has no clear disk"
        cx, cy, r = disk
        xy = disk_position(lat, lon, b0, cx, cy, r)
        if not xy:
            return None, why + "; region not on the visible disk"
        out = measure_pil(img, xy, r, lat, lon)
        if out:
            out["magnetogram"] = {"origin": "sdo-imagery", "time": S.iso(t)}
            return out, ""
        return None, why + "; no clear neutral line in the stored magnetogram"
    except Exception as e:
        return None, f"{why}; stored magnetogram unavailable ({e})"


def _disk(img: np.ndarray):
    """The solar disk on a full-disk frame: the largest bright blob, not its labels."""
    lab, n = ndimage.label(img > 0.06)
    if n == 0:
        return None
    sizes = ndimage.sum(np.ones_like(img), lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(lab == k)
    if len(xs) < 5000:
        return None
    return float(xs.mean()), float(ys.mean()), math.sqrt(len(xs) / math.pi)


if __name__ == "__main__":
    sys.exit(main())
