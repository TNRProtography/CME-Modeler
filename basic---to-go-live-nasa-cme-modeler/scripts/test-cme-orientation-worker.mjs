#!/usr/bin/env node
// The cme-orientation worker: uploads need the token, results merge by CME,
// month-old ones are dropped, and the app's read is one key.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'orient-'));
writeFileSync(join(dir, 'w.mjs'), readFileSync(join(HERE, '..', 'worker', 'cme-orientation-worker.js'), 'utf8'));
const W = (await import(pathToFileURL(join(dir, 'w.mjs')).href)).default;

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); } };
const kv = new Map(); let reads = 0;
const env = {
  INGEST_TOKEN: 'secret',
  ORIENTATION_KV: {
    async get(k, o) { reads++; const v = kv.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { kv.set(k, v); },
  },
};
const call = (path, init) => W.fetch(new Request('https://o.dev' + path, init), env);
const ingest = (results, token = 'secret') => call('/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ run: { analysed: results.length }, results }) });
const now = Date.now();
const r = (id, days, status = 'estimated') => ({ id, startTime: new Date(now - days * 86400000).toISOString(), status, tilt: 30, confidence: 50 });

console.log('\nUploads');
check((await ingest([r('a', 1)], 'wrong')).status === 401, 'a wrong token is refused');
check((await call('/api/ingest', { method: 'POST', body: '{}' })).status === 401, 'no token is refused');
const ok = await (await ingest([r('a', 1), r('b', 2, 'confirmed')])).json();
check(ok.ok && ok.stored === 2 && ok.total === 2, 'results are stored');
await ingest([r('a', 1, 'confirmed'), r('old', 40)]);
reads = 0;
const all = await (await call('/api/orientations')).json();
check(all.cmes.a.status === 'confirmed' && all.cmes.b && !all.cmes.old, 'a newer result replaces, others stay, month-old ones go');
check(reads === 1, `the app's read is one KV read (${reads})`);
const one = await call('/api/orientation?id=b');
check(one.status === 200 && (await one.json()).status === 'confirmed', 'one CME by id');
check((await call('/api/orientation?id=zzz')).status === 404, 'an unknown id is a 404');
const st = await (await call('/api/status')).json();
check(st.stored === 2 && st.confirmed === 2 && st.lastRun?.analysed === 2, 'status reports the last run and the counts');
check((await call('/api/orientations')).headers.get('access-control-allow-origin') === '*', 'readable from any site');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
