#!/usr/bin/env node
// The sdo-imagery worker, against a stubbed SDO and an in-memory R2.
//
// What matters: a new store fills the week newest first within its per-run
// budget, a filled store only fetches what is new, nothing past retention is
// kept, and /api/frames answers the app's question with URLs into the store,
// falling back to SDO for the part of a window the store does not hold yet.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'sdoimg-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');

// SDO: HMIBC, HMIB and HMII every 6 minutes at 07s past, all three sizes,
// plus AIA noise. Only frames up to "now" exist.
let now = Date.UTC(2026, 8, 29, 10, 3);
const fetched = [];
let jsocDown = false;
// SDO's archive posts nothing after this, as it did in September 2026.
let archiveEnd = Infinity;
// Helioviewer: HMI every 3 minutes at 40 s past, posted 2 minutes late.
let hvUp = false;
const hvFetched = () => fetched.filter((u) => u.includes('helioviewer'));
globalThis.fetch = async (url, opts) => {
  url = String(url);
  fetched.push(url);
  const dir = url.match(/browse\/(\d{4})\/(\d{2})\/(\d{2})\/$/);
  if (dir) {
    const day = Date.UTC(+dir[1], +dir[2] - 1, +dir[3]);
    const lines = [];
    for (let t = day; t < day + DAY && t <= now && t <= archiveEnd; t += 6 * MIN) {
      const d = new Date(t);
      const stem = `${dir[1]}${dir[2]}${dir[3]}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}07`;
      for (const p of ['HMIBC', 'HMIB', 'HMII']) for (const s of ['512', '1024', '2048']) lines.push(`<a href="${stem}_${s}_${p}.jpg">x</a>`);
      lines.push(`<a href="${stem}_1024_0171.jpg">x</a>`);
    }
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/html' } });
  }
  if (/latest/.test(url) && /1024x1024/.test(url)) {
    // JSOC posts a new live image every quarter-hour.
    const posted = new Date(Math.floor(now / (15 * MIN)) * 15 * MIN).toUTCString();
    if (opts?.headers?.['If-Modified-Since'] === posted) return new Response(null, { status: 304 });
    const type = url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    return new Response(new Uint8Array(40_000), { headers: { 'Content-Type': type, 'Last-Modified': posted } });
  }
  if (/latest/.test(url) && /4096/.test(url)) {
    if (jsocDown && url.includes('jsoc1')) return new Response('down', { status: 503 });
    if (opts?.headers?.['If-Modified-Since'] === 'Mon, 29 Sep 2026 10:00:00 GMT') return new Response(null, { status: 304 });
    const type = url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    return new Response(new Uint8Array(300_000), { headers: { 'Content-Type': type, 'Last-Modified': 'Mon, 29 Sep 2026 10:00:00 GMT' } });
  }
  if (url.includes('helioviewer')) {
    if (!hvUp) return new Response('down', { status: 503 });
    const q = new URL(url).searchParams;
    const at = Date.parse(q.get('date'));
    if (url.includes('getClosestImage')) {
      const step = 3 * MIN;
      let t = Math.round((at - 40000) / step) * step + 40000;
      while (t > now - 2 * MIN) t -= step;
      const iso = new Date(t).toISOString().slice(0, 19).replace('T', ' ');
      return new Response(JSON.stringify({ id: String(t), date: iso, sourceId: q.get('sourceId') }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('takeScreenshot')) {
      const ok = q.get('imageScale') === '2.016' && q.get('width') === '1024' && q.get('display') === 'true';
      return ok ? new Response(new Uint8Array(30_000), { headers: { 'Content-Type': 'image/png' } }) : new Response('bad', { status: 400 });
    }
  }
  if (/_HMI[A-Z]+\.jpg$/.test(url)) return new Response(new Uint8Array([0xff, 0xd8, 1, 2]), { headers: { 'Content-Type': 'image/jpeg' } });
  return new Response('nope', { status: 404 });
};

const store = new Map();
const meta = new Map();
const env = {
  SDO_BUCKET: {
    async get(k) {
      return store.has(k) ? { body: new Response(store.get(k)).body, httpEtag: '"e"', size: 1, httpMetadata: meta.get(k) } : null;
    },
    async put(k, v, o) { store.set(k, typeof v === 'string' ? v : new Uint8Array(v)); meta.set(k, o?.httpMetadata); },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
  },
};
const imageKeys = () => [...store.keys()].filter((k) => k.startsWith('hmi/'));
const live = new Set(['HMILBC', 'HMILB', 'HMILIF']);
const manifest = () => JSON.parse(store.get('manifest.json'));

try {
  execFileSync('npx', ['esbuild', join(root, 'worker/sdo-imagery-worker.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'w.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const w = await import(pathToFileURL(join(out, 'w.mjs')).href);

  console.log('\nParsing a listing');
  {
    const html = '<a href="20260929_000007_1024_HMIB.jpg">20260929_000007_1024_HMIB.jpg</a>'
      + '<a href="20260929_000007_512_HMIB.jpg"></a><a href="20260929_000007_1024_HMIBC.jpg"></a>'
      + '<a href="20260929_000007_1024_0171.jpg"></a>';
    const p = w.parseListing(html);
    check(p.get('HMIB')?.[0].sizes.sort().join() === '1024,512', 'HMIB holds its two sizes, once each');
    check(p.get('HMIBC')?.length === 1 && !p.has('0171'), 'HMIBC is separate and AIA is ignored');
    check(w.productsToStore(p).sort().join() === 'HMIB,HMIBC', 'colorised, magnetogram: HMIBC and HMIB; no intensity product here');
  }

  console.log('\nQuarter-hour slots do not move when a new frame lands');
  {
    const mk = (mins) => mins.map((m) => ({ t: m * MIN, stem: String(m), sizes: [1024] }));
    const a = w.wantedMoments(mk([0, 6, 12, 18, 24, 30])).map((m) => m.stem).join();
    const b = w.wantedMoments(mk([0, 6, 12, 18, 24, 30, 36])).map((m) => m.stem).join();
    check(b.startsWith(a), `same picks plus the new one (${a} / ${b})`);
  }

  console.log('\nA new store fills newest first, within budget');
  {
    fetched.length = 0;
    const r = await w.runOnce(env, now);
    const images = fetched.filter((u) => u.endsWith('.jpg') && !u.includes('latest'));
    check(images.length <= w.DOWNLOADS_PER_RUN, `downloads at most ${w.DOWNLOADS_PER_RUN} (${images.length})`);
    check(r.listings === 1, `reads only today's listing while it has work (${r.listings})`);
    const m = manifest();
    const newest = Math.max(...Object.values(m.products).flat().map((e) => e.t));
    check(now - newest < 15 * MIN, 'the newest frame is stored first');
    check(Object.keys(m.products).filter((p) => !live.has(p)).sort().join() === 'HMIB,HMIBC,HMII', 'one archive product per view');
    check(Object.keys(m.products).filter((p) => live.has(p)).length === 3, 'and the live image of each view is saved');
  }

  console.log('\nKeep running until the week is full');
  {
    let runs = 1;
    for (; runs < 2000; runs++) {
      now += 5 * MIN;
      const r = await w.runOnce(env, now);
      if (r.downloaded === 0 && runs > 5) break;
    }
    const m = manifest();
    const oldest = Math.min(...m.products.HMII.map((e) => e.t));
    check(now - oldest >= 7 * DAY, `holds more than seven days (${((now - oldest) / DAY).toFixed(2)})`);
    check(now - oldest <= w.RETENTION_MS + 15 * MIN, 'and nothing past retention');
    check(runs < 300, `filled in ${runs} runs of 5 min (${(runs * 5 / 60).toFixed(1)} h)`);
    const perProduct = m.products.HMII.length;
    const liveSpan = (now - m.products.HMILB[0].t) / (15 * MIN);
    check(m.products.HMILB.length >= liveSpan * 0.95, `a live image saved every quarter-hour since the store began (${m.products.HMILB.length} of ${Math.round(liveSpan)})`);
    check(m.products.HMILB.every((e) => e.ext === 'gif'), 'the live magnetogram kept as the GIF it is');
    check(perProduct >= 7 * 96 && perProduct <= 8 * 96 + 2, `one frame per quarter-hour (${perProduct})`);

    fetched.length = 0;
    now += 15 * MIN;
    const r = await w.runOnce(env, now);
    check(r.listings <= 2, `a full store reads only today's listing, and yesterday's until it settles (${r.listings})`);
    check(r.downloaded === 9, `and fetches just the new quarter-hour: 3 views x 3 sizes (${r.downloaded})`);
    check(r.liveSaved === 3, `plus the three new live images (${r.liveSaved})`);
    check(imageKeys().length === Object.values(manifest().products).flat().reduce((n, e) => n + e.sizes.length, 0),
      'R2 holds exactly what the manifest lists');
  }

  console.log('\nThe newest 4K image of each view');
  {
    const m = manifest();
    check(Object.keys(m.latest ?? {}).sort().join() === 'colorized,intensity,magnetogram', 'all three views are stored');
    check(m.latest.magnetogram.contentType === 'image/gif' && m.latest.colorized.source.includes('jsoc1'),
      'from JSOC, keeping the magnetogram as the GIF it is');
    fetched.length = 0;
    now += 20 * MIN;
    const r = await w.runOnce(env, now);
    check(r.latestDownloaded === 0 && fetched.filter((u) => u.includes('4096')).length === 3,
      'an unchanged image costs a 304, not a download');
    fetched.length = 0;
    now += 1 * MIN;
    await w.runOnce(env, now);
    check(fetched.filter((u) => u.includes('4096')).length === 0, 'and is not checked again for ten minutes');
    jsocDown = true;
    store.delete('latest/intensity_4096');
    const mm = manifest(); delete mm.latest.intensity; store.set('manifest.json', JSON.stringify(mm));
    now += 11 * MIN;
    await w.runOnce(env, now);
    check(manifest().latest.intensity.source.includes('sdo.gsfc'), 'JSOC down: SDO\'s own latest is used instead');
    jsocDown = false;
    const img = await w.default.fetch(new Request('https://s.dev/latest/magnetogram_4096'), env);
    check(img.status === 200 && img.headers.get('content-type') === manifest().latest.magnetogram.contentType
      && img.headers.get('access-control-allow-origin') === '*', 'served with its own type and CORS');
    check((await w.default.fetch(new Request('https://s.dev/latest/dopplergram_4096'), env)).status === 404, 'only the three views');
  }

  console.log('\nThe app\'s frame list');
  {
    const call = async (qs) => w.default.fetch(new Request(`https://sdo-imagery.example.dev/api/frames?${qs}`), env);
    const RealNow = Date.now;
    Date.now = () => now;
    const res = await call(`mode=colorized&from=${now - 7 * DAY}&to=${now}`);
    const body = await res.json();
    check(res.status === 200 && body.product === 'HMIBC', `colorised is HMIBC (${body.product})`);
    check(body.frames.length > 80 && body.frames.length <= 97, `about a hundred frames for a week (${body.frames.length})`);
    check(body.frames.every((f) => f.url.startsWith('https://sdo-imagery.example.dev/img/HMIBC/') && f.preview && f.detail),
      'with the archive up to date, every frame is an archive frame, with its small and large copies');
    const img = await w.default.fetch(new Request(body.frames[0].url), env);
    check(img.status === 200 && img.headers.get('access-control-allow-origin') === '*', 'and the image itself answers, with CORS');
    check((await call(`mode=colorized&from=0&to=${now}`)).status === 400, 'a window of years is refused');
    check((await w.default.fetch(new Request('https://x.dev/img/../manifest.json'), env)).status === 404, 'only frame paths are served');
    Date.now = RealNow;
  }

  console.log('\nSDO\'s archive four days behind');
  {
    store.clear(); meta.clear();
    archiveEnd = now - 4.5 * DAY;
    const RealNow = Date.now;
    for (let i = 0; i < 400; i++) { now += 5 * MIN; await w.runOnce(env, now); }
    const m = manifest();
    const lagDay = new Date(now - 2 * DAY).toISOString().slice(0, 10).replace(/-/g, '');
    check(!m.completeDays.includes(lagDay), `a day SDO has not posted is not written off (${lagDay})`);
    check(m.waitingOnSdo === undefined && Object.keys(m.dayChecks).includes(lagDay), 'it is kept to be checked again');
    Date.now = () => now;
    const res = await w.default.fetch(new Request(`https://s.dev/api/frames?mode=magnetogram&from=${now - 12 * HOUR}&to=${now}`), env);
    const body = await res.json();
    check(body.frames.length >= 40, `the last 12 hours come from saved live images (${body.frames.length} frames)`);
    check(body.frames.every((f) => f.product === 'HMILB' && f.url.endsWith('.gif')), 'tagged as the live product, so the app measures them separately');
    const img = await w.default.fetch(new Request(body.frames[0].url), env);
    check(img.status === 200 && img.headers.get('content-type') === 'image/gif', 'and a saved GIF is served as one');
    const week = await (await w.default.fetch(new Request(`https://s.dev/api/frames?mode=magnetogram&from=${now - 7 * DAY}&to=${now}`), env)).json();
    const kinds = new Set(week.frames.map((f) => f.product));
    check(kinds.has('HMIB') && kinds.has('HMILB'), 'a week mixes archive frames and live ones after them');
    const lastArchive = Math.max(...week.frames.filter((f) => f.product === 'HMIB').map((f) => f.atMs));
    const firstLive = Math.min(...week.frames.filter((f) => f.product === 'HMILB').map((f) => f.atMs));
    check(firstLive > lastArchive, 'live frames only where the archive stops');
    check(manifest().lastRun.hvSaved === 0 && manifest().lastRun.errors.some((e) => e.startsWith('helioviewer')),
      'Helioviewer down: nothing saved, the error recorded, the rest unaffected');

    console.log('\nHelioviewer fills the quarter-hours the archive lacks');
    hvUp = true;
    fetched.length = 0;
    now += 5 * MIN;
    const first = await w.runOnce(env, now);
    check(hvFetched().length <= 2 * w.HV_FRAMES_PER_RUN, `at most ${w.HV_FRAMES_PER_RUN} frames a run, two requests each (${hvFetched().length})`);
    check(first.hvSaved > 0 && manifest().products.HMIHVB?.length > 0 && manifest().products.HMIHVI?.length > 0,
      `magnetogram and intensity both start filling (${first.hvSaved})`);
    check(!hvFetched().some((u) => /sourceId=(?!1[89])/.test(u)), 'and nothing is asked for colorized, which Helioviewer lacks');
    for (let i = 0; i < 120; i++) { now += 5 * MIN; await w.runOnce(env, now); }
    const hm = manifest();
    const hvSlots = new Set(hm.products.HMIHVB.map((e) => Math.floor(e.t / (15 * MIN))));
    const archSlots = new Set(hm.products.HMIB.map((e) => Math.floor(e.t / (15 * MIN))));
    check([...hvSlots].every((n) => !archSlots.has(n)), 'never a quarter-hour the archive already holds');
    const lagSpan = (now - 10 * MIN - Math.max(...hm.products.HMIB.map((e) => e.t))) / (15 * MIN);
    check(hvSlots.size >= lagSpan - 2, `every quarter-hour since the archive stops (${hvSlots.size} of ${Math.floor(lagSpan)})`);
    check(hm.products.HMIHVB.every((e) => e.ext === 'png'), 'kept as the PNG Helioviewer sends');
    const rec = await (await w.default.fetch(new Request(`https://s.dev/api/frames?mode=magnetogram&from=${now - 12 * HOUR}&to=${now}`), env)).json();
    const gaps = rec.frames.slice(1).map((f, i) => f.atMs - rec.frames[i].atMs);
    check(rec.frames.length >= 46 && Math.max(...gaps) <= 20 * MIN, `the last 12 hours: a frame every quarter-hour (${rec.frames.length}, largest gap ${Math.round(Math.max(...gaps) / MIN)} min)`);
    check(rec.frames.every((f) => f.product === 'HMIHVB'), 'from Helioviewer, tagged so the app measures its disk separately');
    check(now - rec.frames[rec.frames.length - 1].atMs < 25 * MIN, 'up to the latest quarter-hour Helioviewer has');
    const png = await w.default.fetch(new Request(rec.frames[0].url), env);
    check(png.status === 200 && png.headers.get('content-type') === 'image/png', 'and served as a PNG');
    const col = await (await w.default.fetch(new Request(`https://s.dev/api/frames?mode=colorized&from=${now - 12 * HOUR}&to=${now}`), env)).json();
    check(col.frames.every((f) => f.product === 'HMILBC'), 'colorized still comes from the live images');
    const wk = await (await w.default.fetch(new Request(`https://s.dev/api/frames?mode=intensity&from=${now - 7 * DAY}&to=${now}`), env)).json();
    const wkKinds = new Set(wk.frames.map((f) => f.product));
    check(wkKinds.has('HMII') && wkKinds.has('HMIHVI'), 'a week of intensity: the archive, then Helioviewer');
    fetched.length = 0;
    now += 5 * MIN;
    const steady = await w.runOnce(env, now);
    check(hvFetched().length <= 6, `once filled, a run asks Helioviewer only for what is new (${hvFetched().length} requests)`);
    check(imageKeys().length === Object.values(manifest().products).flat().reduce((n, e) => n + e.sizes.length, 0),
      'R2 holds exactly what the manifest lists');
    void steady;

    // A store written before the fix had days like this marked complete.
    const bad = manifest(); bad.completeDays.push(lagDay); store.set('manifest.json', JSON.stringify(bad));
    now += 5 * MIN; await w.runOnce(env, now);
    check(!manifest().completeDays.includes(lagDay), 'a day wrongly closed by the old rule is reopened');

    console.log('\nSDO catches up');
    archiveEnd = Infinity;
    hvUp = false;
    for (let i = 0; i < 400; i++) { now += 5 * MIN; await w.runOnce(env, now); }
    const after = manifest();
    const caughtUp = after.products.HMIB.filter((e) => e.stem.startsWith(lagDay)).length;
    check(caughtUp >= 90 && after.completeDays.includes(lagDay), `the day it skipped is filled and then closed (${caughtUp} frames)`);
    Date.now = RealNow;
  }

  console.log('\nA half-filled store borrows the older part from SDO');
  {
    store.clear(); meta.clear();
    now += DAY;
    await w.runOnce(env, now);
    const RealNow = Date.now;
    Date.now = () => now;
    const res = await w.default.fetch(new Request(`https://s.dev/api/frames?mode=intensity&from=${now - 3 * DAY}&to=${now}`), env);
    const body = await res.json();
    const fromStore = body.frames.filter((f) => f.url.startsWith('https://s.dev/img/')).length;
    const fromSdo = body.frames.filter((f) => f.url.includes('sdo.gsfc.nasa.gov')).length;
    check(fromStore > 0 && fromSdo > 0, `both sources (${fromStore} stored, ${fromSdo} from SDO)`);
    const span = body.frames[body.frames.length - 1].atMs - body.frames[0].atMs;
    check(span > 2.9 * DAY, 'and the window is covered end to end');
    Date.now = RealNow;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
