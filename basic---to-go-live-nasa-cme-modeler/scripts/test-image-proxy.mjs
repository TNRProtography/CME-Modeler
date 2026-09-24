// The image proxy, both ways round.
//
// Two things serve these routes - a Worker on the custom domain and a Pages
// Function on the site origin - and the whole point of proxy-routes.ts is that
// they cannot disagree. So every case runs against both, and a difference
// between them is a failed test rather than a bug that only appears on
// whichever URL nobody tried.
//
// The upstream is stubbed. The observatories are not always reachable from a
// build machine, and "did NASA answer" was never the question here.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'proxy-test-'));

const bundle = (entry, name) => {
  const file = join(out, name);
  execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--format=esm', `--outfile=${file}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  return pathToFileURL(file).href;
};

const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req) { const r = cacheStore.get(req.url); return r ? r.clone() : undefined; },
  async put(req, res) { cacheStore.set(req.url, res.clone()); },
}};

const upstreamHits = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  upstreamHits.push({ url, method: init.method ?? 'GET' });
  if (url.endsWith('.jpg')) {
    return new Response(init.method === 'HEAD' ? null : new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: { 'Content-Type': 'image/jpeg', etag: '"abc"', 'last-modified': 'Mon, 22 Sep 2026 00:00:00 GMT' },
    });
  }
  return new Response('[{"kp":3}]', { headers: { 'Content-Type': 'application/json' } });
};

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

try {
  const worker = (await import(bundle('worker/index.ts', 'worker.mjs'))).default;
  const fn = await import(bundle('functions/api/proxy/[[route]].ts', 'fn.mjs'));

  const IMG = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIB.jpg';
  const KP = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
  const q = (u) => `url=${encodeURIComponent(u)}`;

  const viaWorker = (path) => worker.fetch(new Request(`https://p.workers.dev${path}`), {});
  const viaFn = (path) => {
    const u = new URL(`https://site.dev${path}`);
    return fn.onRequestGet({
      request: new Request(u.toString()),
      params: { route: u.pathname.replace(/^\/api\/proxy\/?/, '') },
      waitUntil: () => {},
    });
  };

  // The bare form is what the workers.dev hostname gets typed at; the prefixed
  // form is what the custom-domain route matches. Both must work.
  const entryPoints = [
    ['worker, prefixed', viaWorker, '/api/proxy'],
    ['worker, bare', viaWorker, ''],
    ['pages function', viaFn, '/api/proxy'],
  ];

  // Archive frames never change, so they may be cached for a week; the live
  // "latest" images must stay capped at five minutes.
  const ARCHIVE = 'https://sdo.gsfc.nasa.gov/assets/img/browse/2026/09/22/20260922_001038_1024_HMIIF.jpg';
  for (const [label, call, prefix] of entryPoints) {
    const a = await call(`${prefix}/image?${q(ARCHIVE)}&ttl=604800`);
    const cc = a.headers.get('cache-control') || '';
    check(`${label}: an archive frame is cached for a week`, /max-age=604800/.test(cc) && /immutable/.test(cc), cc);
    const l = await call(`${prefix}/image?${q(IMG)}&ttl=604800`);
    const lc = l.headers.get('cache-control') || '';
    check(`${label}: a live image is still capped at five minutes`, /max-age=300\b/.test(lc) && !/immutable/.test(lc), lc);
  }

  for (const [label, call, prefix] of entryPoints) {
    let r = await call(`${prefix}/image?${q(IMG)}`);
    check(`${label}: image is an image`, r.status === 200 && (r.headers.get('content-type') || '').startsWith('image/'),
      `${r.status} ${r.headers.get('content-type')}`);
    // Without this header the blob is cross-origin and the canvas it is drawn
    // on cannot be read back, which is the entire reason the proxy exists.
    check(`${label}: image allows any origin`, r.headers.get('access-control-allow-origin') === '*');

    r = await call(`${prefix}/meta?${q(IMG)}`);
    check(`${label}: meta is json`, r.status === 200 && (r.headers.get('content-type') || '').includes('json'), String(r.status));

    r = await call(`${prefix}/data?${q(KP)}`);
    check(`${label}: data passes through`, r.status === 200, String(r.status));

    r = await call(`${prefix}/image?${q('https://evil.example.com/x.jpg')}`);
    check(`${label}: off-list host refused`, r.status === 400, String(r.status));

    r = await call(`${prefix}/image?${q('http://127.0.0.1/x.jpg')}`);
    check(`${label}: loopback refused`, r.status === 400, String(r.status));

    // The two allow-lists are separate on purpose: an image host is not
    // automatically a text host, and vice versa. jsoc1 serves only images;
    // SDO is on both lists now, because its archive listings are text.
    r = await call(`${prefix}/data?${q('https://jsoc1.stanford.edu/data/hmi/images/latest/HMI_latest_Mag_1024x1024.gif')}`);
    check(`${label}: image host not allowed on data proxy`, r.status === 400, String(r.status));

    r = await call(`${prefix}/image`);
    check(`${label}: missing url refused`, r.status === 400, String(r.status));

    r = await call(`${prefix}/nonsense`);
    check(`${label}: unknown route is 404`, r.status === 404, String(r.status));
  }

  // The root used to answer with an empty 404, which is indistinguishable from
  // a worker that is down - and that ambiguity cost a long afternoon.
  const r = await worker.fetch(new Request('https://p.workers.dev/'), {});
  const body = await r.clone().json();
  check('root answers ok', r.status === 200 && body.ok === true, String(r.status));
  check('root lists its routes', Array.isArray(body.routes) && body.routes.length === 3);
  check('root lists both allow-lists',
    body.allowedImageHosts.includes('jsoc1.stanford.edu') && body.allowedDataHosts.includes('www.nmdb.eu'));
  check('root body is not empty', (await r.text()).length > 50);

  check('no upstream fetch ever left the allow-lists',
    upstreamHits.every((h) => /sdo\.gsfc\.nasa\.gov|services\.swpc\.noaa\.gov/.test(h.url)),
    JSON.stringify(upstreamHits.filter((h) => !/sdo|swpc/.test(h.url))));
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
