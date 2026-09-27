#!/usr/bin/env python3
"""PUNCH quicklooks into the coronagraph worker.

PUNCH's near-real-time NFI+WFI mosaic (QuickPUNCH "CTM") is published by
NASA's Solar Data Analysis Center as JPEG2000 only, about a day and a half
after it is taken:

    https://umbra.nascom.nasa.gov/punch/L/Q/CTM/YYYY/MM/DD/PUNCH_LQ_CTM_<YYYYMMDDhhmmss>_v<version>.jp2

Browsers other than Safari cannot show JPEG2000, and a Cloudflare Worker cannot
decode it, so this script does the conversion. It runs on a schedule in GitHub
Actions (.github/workflows/punch-quicklook.yml):

  1. ask the coronagraph worker which PUNCH frames it already has,
  2. read the last few days' SDAC listings,
  3. pick a frame about every 15 minutes across the newest day of data,
  4. decode each missing one at about 1024 px (JPEG2000 can decode straight
     to a lower resolution, so the full 4k image is never built),
  5. POST it to the worker's /api/ingest as a JPG.

Environment:
  PUNCH_INGEST_TOKEN      required, the same value as the worker's secret
  CORONAGRAPH_WORKER_URL  optional, defaults to the production worker
  PUNCH_MAX_PER_RUN       optional, frames to upload per run (default 40)

Needs Pillow built with OpenJPEG (the PyPI wheels are).
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from PIL import Image

SDAC_BASE = os.environ.get("PUNCH_SDAC_BASE", "https://umbra.nascom.nasa.gov/punch/L/Q/CTM/")
DEFAULT_WORKER = "https://coronagraphy-processing.thenamesrock.workers.dev"
SOURCE = "punch"
TARGET_PX = 1024
MIN_GAP = timedelta(minutes=15)
WINDOW = timedelta(hours=24)
DAYS_BACK = 4
JPEG_QUALITY = 85
USER_AGENT = "SpotTheAurora-PUNCH-quicklook/1.0 (+https://www.spottheaurora.co.nz)"

NAME_RE = re.compile(r'href="(PUNCH_LQ_CTM_(\d{14})_v([0-9A-Za-z]+)\.jp2)"')

# JPEG2000 mosaics are about 4k square; allow that without Pillow's warning.
Image.MAX_IMAGE_PIXELS = 8192 * 8192


def http(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})},
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def parse_listing(html: str) -> dict[datetime, str]:
    """Frame time to file name; the highest version when a time is listed twice."""
    best: dict[datetime, tuple[str, str]] = {}
    for name, stamp, version in NAME_RE.findall(html):
        when = datetime.strptime(stamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        if when not in best or version > best[when][1]:
            best[when] = (name, version)
    return {when: name for when, (name, _) in best.items()}


def day_url(day: datetime) -> str:
    return f"{SDAC_BASE}{day:%Y/%m/%d}/"


def choose(available: dict[datetime, str], have: set[datetime]) -> list[datetime]:
    """Frames to fetch: one about every MIN_GAP across the newest WINDOW, newest first."""
    everything = set(available) | have
    if not everything:
        return []
    start = max(everything) - WINDOW
    last: datetime | None = None
    picked = []
    for when in sorted(t for t in everything if t >= start):
        if when in have:
            last = when
        elif last is None or when - last >= MIN_GAP:
            picked.append(when)
            last = when
    return sorted(picked, reverse=True)


def to_jpeg(jp2: bytes) -> bytes:
    """Decode at the smallest JPEG2000 resolution level still at least TARGET_PX wide."""
    im = Image.open(io.BytesIO(jp2))
    width = im.size[0]
    reduce = 0
    while (width >> (reduce + 1)) >= TARGET_PX:
        reduce += 1
    im.reduce = reduce  # Pillow's JPEG2000 plugin decodes at 1/2**reduce
    im.load()
    im = im.convert("L")
    if im.size[0] > TARGET_PX:
        im = im.resize((TARGET_PX, round(im.size[1] * TARGET_PX / im.size[0])), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def main() -> int:
    token = os.environ.get("PUNCH_INGEST_TOKEN", "").strip()
    if not token:
        print("PUNCH_INGEST_TOKEN is not set", file=sys.stderr)
        return 2
    worker = os.environ.get("CORONAGRAPH_WORKER_URL", "").strip().rstrip("/") or DEFAULT_WORKER
    max_per_run = int(os.environ.get("PUNCH_MAX_PER_RUN", "40"))
    auth = {"Authorization": f"Bearer {token}"}

    have: set[datetime] = set()
    frames = json.loads(http(f"{worker}/api/frames?source={SOURCE}")).get("frames") or []
    for frame in frames:
        have.add(datetime.fromisoformat(frame["ts"].replace("Z", "+00:00")))
    print(f"worker has {len(have)} PUNCH frame(s)")

    available: dict[datetime, str] = {}
    urls: dict[datetime, str] = {}
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    listed_days = 0
    for back in range(DAYS_BACK):
        url = day_url(today - timedelta(days=back))
        try:
            found = parse_listing(http(url).decode("utf-8", "replace"))
        except urllib.error.HTTPError as err:
            if err.code == 404:
                continue  # that day has nothing yet
            print(f"listing {url}: HTTP {err.code}", file=sys.stderr)
            continue
        except Exception as err:  # noqa: BLE001 - one bad day must not stop the rest
            print(f"listing {url}: {err}", file=sys.stderr)
            continue
        listed_days += 1
        for when, name in found.items():
            available[when] = name
            urls[when] = url + name
    print(f"SDAC lists {len(available)} CTM frame(s) over {listed_days} day(s)")
    if not available and not listed_days:
        print("could not read any SDAC listing", file=sys.stderr)
        return 1

    todo = choose(available, have)
    print(f"{len(todo)} frame(s) to add, taking up to {max_per_run}")

    stored = failed = 0
    for when in todo[:max_per_run]:
        try:
            jpeg = to_jpeg(http(urls[when], timeout=120))
            query = urllib.parse.urlencode({"source": SOURCE, "ts": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                            "name": available[when]})
            result = json.loads(http(f"{worker}/api/ingest?{query}", data=jpeg,
                                     headers={**auth, "Content-Type": "image/jpeg"}))
            stored += 1 if result.get("stored") else 0
            print(f"  {when:%Y-%m-%d %H:%M:%S}  {len(jpeg) // 1024} KB  {'stored' if result.get('stored') else result.get('reason')}")
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")[:200]
            print(f"  {when:%Y-%m-%d %H:%M:%S}  HTTP {err.code} {body}", file=sys.stderr)
            if err.code in (401, 503):
                return 1  # the token is wrong or missing on one side; nothing else will work
            failed += 1
        except Exception as err:  # noqa: BLE001
            print(f"  {when:%Y-%m-%d %H:%M:%S}  {err}", file=sys.stderr)
            failed += 1

    if stored:
        http(f"{worker}/api/ingest/commit", data=b"", headers=auth)
    print(f"stored {stored}, failed {failed}")
    return 1 if failed and not stored else 0


if __name__ == "__main__":
    sys.exit(main())
