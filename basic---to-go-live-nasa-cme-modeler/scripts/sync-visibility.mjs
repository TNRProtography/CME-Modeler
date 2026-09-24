#!/usr/bin/env node
// Regenerates the worker's copy of the shared visibility model.
//
//   npm run sync:visibility              rewrite the worker
//   npm run sync:visibility -- --check   exit 1 if it would change anything
//
// The push worker is pasted into the Cloudflare dashboard as a single file,
// so it cannot import utils/auroraVisibility.ts. This bundles what it needs -
// the magnetic latitude table, the oval, the viewline, the sky - into one
// generated block, so a notification and the app's forecast cards are worked
// out by the same code rather than two copies that drift.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(root, 'worker', 'push-notification-worker.js');
const check = process.argv.includes('--check');

const bundle = execFileSync('npx', ['esbuild', join(root, 'scripts', 'visibility-entry.ts'),
  '--bundle', '--format=iife', '--global-name=AuroraVisibility', '--target=es2020',
  '--legal-comments=none', '--minify-whitespace', '--log-level=error'], { cwd: root, encoding: 'utf8' })
  .trim()
  // A directive in the middle of the worker does nothing, and the worker is a
  // module and strict already.
  .replace(/^"use strict";/, '');

const block = `// <generated:visibility>
// Generated from utils/auroraVisibility.ts, ovalPhysics.ts, skyConditions.ts
// and aacgmGrid.ts by \`npm run sync:visibility\`. Do not edit by hand - change
// the app's model and re-run the script. \`npm run test:visibility-sync\`
// fails if this block and the app disagree.
${bundle}
// </generated:visibility>`;

const src = readFileSync(WORKER, 'utf8');
const existing = src.match(/\/\/ <generated:visibility>[\s\S]*?\/\/ <\/generated:visibility>/);
let next;
if (existing) {
  next = src.replace(existing[0], () => block);
} else {
  const anchor = 'function geoToGmag(latDeg, lonDeg) {';
  if (!src.includes(anchor)) { console.error('Could not find where to put the block.'); process.exit(1); }
  next = src.replace(anchor, () => `${block}\n\n${anchor}`);
}

if (check) {
  if (next !== src) {
    console.error('The worker\'s visibility block is out of date. Run: npm run sync:visibility');
    process.exit(1);
  }
  console.log('Worker visibility block matches the app.');
} else {
  writeFileSync(WORKER, next);
  console.log(existing ? 'Updated the worker\'s visibility block.' : 'Added the visibility block to the worker.');
}
