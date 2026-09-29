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
globalThis.fetch = async (url, opts) => {
  url = String(url);
  fetched.push(url);
  const dir = url.match(/browse\/(\d{4})\/(\d{2})\/(\d{2})\/$/);
  if (dir) {
    const day = Date.UTC(+dir[1], +dir[2] - 1, +dir[3]);
    const lines = [];
    for (let t = day; t < day + DAY && t <= now; t += 6 * MIN) {
      const d = new Date(t);
      const stem = `${dir[1]}${dir[2]}${dir[3]}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}07`;
      for (const p of ['HMIBC', 'HMIB', 'HMII']) for (const s of ['512', '1024', '2048']) lines.push(`<a href="${stem}_${s}_${p}.jpg">x</a>`);
      lines.push(`<a href="${stem}_1024_0171.jpg">x</a>`);
    }
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/html' } });
  }
  if (/latest/.test(url) && /4096/.test(url)) {
    if (jsocDown && url.includes('jsoc1')) return new Response('down', { status: 503 });
    if (opts?.headers?.['If-Modified-Since'] === 'Mon, 29 Sep 2026 10:00:00 GMT') return new Response(null, { status: 304 });
    const type = url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    return new Response(new Uint8Array(300_000), { headers: { 'Content-Type': type, 'Last-Modified': 'Mon, 29 Sep 2026 10:00:00 GMT' } });
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
    check(Object.keys(m.products).sort().join() === 'HMIB,HMIBC,HMII', 'one product per view');
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
    check(perProduct >= 7 * 96 && perProduct <= 8 * 96 + 2, `one frame per quarter-hour (${perProduct})`);

    fetched.length = 0;
    now += 15 * MIN;
    const r = await w.runOnce(env, now);
    check(r.listings <= 2, `a full store reads only today's listing, and yesterday's until it settles (${r.listings})`);
    check(r.downloaded === 9, `and fetches just the new quarter-hour: 3 views x 3 sizes (${r.downloaded})`);
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
    check(r.latestDownloaded === 0 && fetched.filter((u) => u.includes('latest')).length === 3,
      'an unchanged image costs a 304, not a download');
    fetched.length = 0;
    now += 1 * MIN;
    await w.runOnce(env, now);
    check(fetched.filter((u) => u.includes('latest')).length === 0, 'and is not checked again for ten minutes');
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
      'every frame is served from the store, with its small and large copies');
    const img = await w.default.fetch(new Request(body.frames[0].url), env);
    check(img.status === 200 && img.headers.get('access-control-allow-origin') === '*', 'and the image itself answers, with CORS');
    check((await call(`mode=colorized&from=0&to=${now}`)).status === 400, 'a window of years is refused');
    check((await w.default.fetch(new Request('https://x.dev/img/../manifest.json'), env)).status === 404, 'only frame paths are served');
    Date.now = RealNow;
  }

  console.log('\nA half-filled store borrows the older part from SDO');
  {
    store.clear();
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
