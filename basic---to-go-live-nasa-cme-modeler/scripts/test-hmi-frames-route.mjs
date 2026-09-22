#!/usr/bin/env node
// The /api/hmi-frames Pages Function, against a stubbed SDO.
//
// It exists because a day's archive listing is close to a megabyte of HTML
// and a week of them should not go to a phone. So what matters is that it
// refuses windows that would fetch the whole archive, and that what comes
// back is the frames and nothing else.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'hmiroute-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const HOUR = 3600000;
const now = Date.now();
const fetched = [];

// A listing per day with an HMII frame every 5 minutes, plus a megabyte-ish
// pile of AIA names the route must not pass on.
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  const m = String(url).match(/browse\/(\d{4})\/(\d{2})\/(\d{2})\/$/);
  if (!m) return new Response('nope', { status: 404 });
  const lines = [];
  for (let min = 0; min < 24 * 60; min += 5) {
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    const stem = `${m[1]}${m[2]}${m[3]}_${hh}${mm}07`;
    for (const size of ['512', '1024', '2048']) lines.push(`<a href="${stem}_${size}_HMII.jpg">x</a>`);
    for (const ch of ['0171', '0193', '0304', '0211']) lines.push(`<a href="${stem}_1024_${ch}.jpg">x</a>`);
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/html' } });
};

try {
  execFileSync('npx', ['esbuild', join(root, 'functions/api/hmi-frames.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'r.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const route = await import(pathToFileURL(join(out, 'r.mjs')).href);
  const call = (qs) => route.onRequestGet({ request: new Request(`https://site.dev/api/hmi-frames?${qs}`) });

  console.log('\nA week of intensity frames');
  {
    fetched.length = 0;
    const res = await call(`mode=intensity&from=${now - 168 * HOUR}&to=${now}`);
    const body = await res.json();
    check(res.status === 200, 'answers 200');
    check(body.product === 'HMII', `falls back to the product the archive has (${body.product})`);
    check(body.frames.length > 80 && body.frames.length <= 97,
          `about a hundred frames, not two thousand (${body.frames.length})`, String(body.frames.length));
    check(fetched.length === 8, `reads the eight daily listings a week touches (${fetched.length})`, String(fetched.length));
    const bytes = JSON.stringify(body).length;
    check(bytes < 60000, `and returns ${(bytes / 1024).toFixed(0)} KB rather than megabytes of listings`, String(bytes));
    check(body.frames.every((f) => f.preview && f.detail), 'every frame carries its small and large copies');
    check(!JSON.stringify(body).includes('_0171'), 'and nothing from the AIA channels');
  }

  console.log('\nWindows that would fetch too much are refused');
  {
    check((await call(`mode=intensity&from=0&to=${now}`)).status === 400,
          'from=0 would read every listing since 2010');
    check((await call(`mode=intensity&from=${now - 9 * 24 * HOUR}&to=${now}`)).status === 400, 'nine days is past the cap');
    check((await call(`mode=dopplergram&from=${now - HOUR}&to=${now}`)).status === 400, 'an unknown view');
    check((await call(`mode=intensity&from=${now}&to=${now - HOUR}`)).status === 400, 'a window that ends before it starts');
    check((await call(`mode=intensity&from=${now}&to=${now + 5 * 24 * HOUR}`)).status === 400, 'a window in the future');
  }

  console.log('\nCaching follows whether the window can still change');
  {
    const past = await call(`mode=intensity&from=${now - 72 * HOUR}&to=${now - 48 * HOUR}`);
    check(/max-age=86400/.test(past.headers.get('cache-control') ?? ''), 'a window wholly in the past is cached for a day');
    const live = await call(`mode=intensity&from=${now - 12 * HOUR}&to=${now}`);
    check(/max-age=300/.test(live.headers.get('cache-control') ?? ''), 'one reaching today for five minutes');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
