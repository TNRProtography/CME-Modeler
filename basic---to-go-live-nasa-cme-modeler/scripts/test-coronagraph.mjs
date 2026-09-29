#!/usr/bin/env node
// The coronagraph worker: CCOR-2 alongside CCOR-1, from NOAA's directory
// listings, against a fake R2 bucket and fake remote hosts.
//
//   npm run test:coronagraph

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'worker', 'coronagraph-worker.js');
const dir = mkdtempSync(join(tmpdir(), 'corona-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8').replace('export default {', 'const worker = {') + '\nexport default worker;' + '\nexport { refreshAll, buildState, SOURCES, parseListingNameToIso, worker, pruneOld, backfillStereoCor2 };\n');
const W = await import(pathToFileURL(copy).href);

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

// Fake R2.
const objects = new Map();
const bucket = {
  async get(key) { const o = objects.get(key); return o ? { body: o.bytes, httpMetadata: o.httpMetadata, json: async () => JSON.parse(new TextDecoder().decode(o.bytes)) } : null; },
  async head(key) { return objects.has(key) ? {} : null; },
  async put(key, bytes, opts = {}) { objects.set(key, { bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes), ...opts }); },
  async delete(key) { objects.delete(key); },
  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { objects: keys.map((key) => ({ key, customMetadata: objects.get(key).customMetadata, uploaded: new Date() })), truncated: false };
  },
};
const env = { CORONA_BUCKET: bucket };

// Fake NOAA listings, the shape of the real index pages: the last six hours
// every fifteen minutes.
const stamp = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(Math.floor(d.getUTCMinutes() / 15) * 15)}`; };
const listing = (inst) => {
  const rows = [];
  for (let m = 6 * 60; m >= 0; m -= 15) {
    const name = `${stamp(Date.now() - m * 60000)}_${inst}_1024by960.jpg`;
    rows.push(`<a href="${name}">${name}</a> 2026-09-26 00:14  99K`);
  }
  return `<html><body><h1>Index of /x/${inst}</h1><a href="../">Parent Directory</a>\n${rows.join('\n')}</body></html>`;
};
const fetched = [];
globalThis.fetch = async (url) => {
  url = String(url);
  fetched.push(url);
  if (url.endsWith('/images/animations/ccor2/')) return new Response(listing('ccor2'));
  if (url.endsWith('/products/ccor1/jpegs/')) return new Response(listing('ccor1'));
  if (/ccor[12]_1024by960\.jpg$/.test(url)) return new Response(new TextEncoder().encode('jpeg ' + url));
  return new Response(new TextEncoder().encode('jpeg ' + url + Math.random()), { headers: { 'last-modified': new Date().toUTCString() } });
};

console.log('\nCCOR-2 alongside CCOR-1');
check(W.SOURCES.ccor2?.label === 'SWFO-L1 CCOR-2', 'CCOR-2 is a source');
check(W.parseListingNameToIso('20260926_1015_ccor2_1024by960.jpg') === '2026-09-26T10:15:00.000Z', 'its file names give their times');
check(W.parseListingNameToIso('20260926_1015_ccor1_1024by960.jpg') === '2026-09-26T10:15:00.000Z', 'and CCOR-1 still does');

const latest = await W.refreshAll(env, { backfill: false });
check(latest.results.ccor2?.stored === 12, 'a refresh takes the newest twelve CCOR-2 frames it is missing', JSON.stringify(latest.results.ccor2));
check(latest.results.ccor1?.stored === 12, 'and the same for CCOR-1', JSON.stringify(latest.results.ccor1));
check(fetched.some((u) => u.startsWith('https://services.swpc.noaa.gov/images/animations/ccor2/2')), 'fetched from the CCOR-2 directory');

const back = await W.refreshAll(env, { backfill: true });
const r2 = back.results.ccor2;
check(r2?.stored + r2?.skipped === r2?.listed && r2.stillMissing === 0 && r2.stored > 0,
      'a backfill fills in the rest, older than what is already there', JSON.stringify(r2));
const latestMeta = JSON.parse(new TextDecoder().decode(objects.get('meta/ccor2/latest.json').bytes));
const newestKey = [...objects.keys()].filter((k) => k.startsWith('raw/ccor2/')).sort().at(-1);
check(latestMeta.key === newestKey, 'filling in older frames leaves the newest as the latest', `${latestMeta.key} vs ${newestKey}`);
const again = await W.refreshAll(env, { backfill: false });
check(again.results.ccor2.stored === 0 && again.results.ccor2.stillMissing === 0, 'with nothing new, a refresh fetches nothing');
const state = await W.buildState(env);
const n2 = state.sources.ccor2?.frames?.length ?? 0;
check(n2 >= 20 && state.sources.ccor2.label === 'SWFO-L1 CCOR-2', '/api/state lists the CCOR-2 frames for the app', String(n2));
check(state.sources.ccor2.frames.every((f) => f.key.startsWith('raw/ccor2/')), 'each under raw/ccor2/');

console.log('\nA snapshot from before CCOR-2 existed');
{
  const old = { ok: true, updated_utc: new Date().toISOString(), sources: { ccor1: { label: 'GOES-19 CCOR-1', frames: [] } } };
  await bucket.put('meta/state_cache.json', JSON.stringify(old));
  const res = await W.worker.fetch(new Request('https://w.invalid/api/state'), env);
  const body = await res.json();
  check(body.sources?.ccor2?.frames?.length > 0, '/api/state rebuilds it rather than hiding CCOR-2');
  const saved = JSON.parse(new TextDecoder().decode(objects.get('meta/state_cache.json').bytes));
  check(!!saved.sources?.ccor2, 'and saves the rebuilt one');
}


console.log('\nA week of frames');
{
  const iso = (ms) => new Date(ms).toISOString();
  const compact = (ms) => iso(ms).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const put = (src, ms) => bucket.put(`raw/${src}/${compact(ms)}.jpg`, 'x', { customMetadata: { ts: iso(ms), source: src } });
  const DAY = 86400000;
  await put('soho_c2', Date.now() - 3 * DAY);
  await put('soho_c2', Date.now() - 8 * DAY);
  const framesRes = await W.worker.fetch(new Request('https://w.dev/api/frames?source=soho_c2'), env, { waitUntil() {} });
  const frames = (await framesRes.json()).frames.map((f) => Date.now() - Date.parse(f.ts));
  check(frames.some((a) => a > 2.9 * DAY && a < 3.1 * DAY), '/api/frames reaches back three days');
  check(!frames.some((a) => a > 7 * DAY), 'but not past the week');
  const state = await W.buildState(env);
  check(!state.sources.soho_c2.frames.some((f) => Date.now() - Date.parse(f.ts) > DAY), '/api/state still summarises one day');
  await W.pruneOld(env);
  check([...objects.keys()].some((k) => k.startsWith('raw/soho_c2/') && k.includes(compact(Date.now() - 3 * DAY).slice(0, 8))), 'pruning keeps a three-day-old frame');
  check(![...objects.keys()].some((k) => k.includes(compact(Date.now() - 8 * DAY).slice(0, 13))), 'and removes an eight-day-old one');

  // STEREO-A: frames days behind the latest one are filled in, newest first.
  const realFetch = globalThis.fetch;
  const stereoName = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}00_n7c2A.jpg`; };
  globalThis.fetch = async (url) => {
    url = String(url);
    const m = url.match(/browse\/(\d{4})\/(\d{2})\/(\d{2})\/ahead\/cor2\/512\/$/);
    if (m) {
      const day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      const names = [];
      for (let t = day; t < day + DAY && t <= Date.now(); t += 2 * 3600000) names.push(stereoName(t));
      return new Response(names.map((n) => `<a href="${n}">${n}</a>`).join('\n'));
    }
    if (url.endsWith('c2A.jpg')) return new Response(new TextEncoder().encode('jpeg ' + url));
    return realFetch(url);
  };
  let r;
  for (let i = 0; i < 20; i++) r = await W.backfillStereoCor2(env, W.SOURCES.stereo_cor2, { maxNew: 12 });
  const stereo = [...objects.keys()].filter((k) => k.startsWith('raw/stereo_cor2/'));
  const oldest = Math.min(...stereo.map((k) => Date.parse(k.slice(16, 20) + '-' + k.slice(20, 22) + '-' + k.slice(22, 24) + 'T' + k.slice(25, 27) + ':' + k.slice(27, 29) + ':00Z')));
  check(r.stillMissing === 0 && Date.now() - oldest > 6.5 * DAY, `STEREO-A fills its whole week (${stereo.length} frames, ${((Date.now() - oldest) / DAY).toFixed(1)} days)`);
  globalThis.fetch = realFetch;
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
