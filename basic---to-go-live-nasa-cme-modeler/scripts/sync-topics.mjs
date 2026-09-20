#!/usr/bin/env node
// Regenerates the worker's ALL_TOPICS block from the category manifest.
//
//   npm run sync:topics          rewrite the worker
//   npm run sync:topics -- --check   exit 1 if it would change anything
//
// The worker is pasted into the Cloudflare dashboard as a single file, so it
// cannot import utils/notificationCategories.ts. This closes that gap without
// asking anyone to keep two lists in their head.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadManifest, WORKER } from './topic-manifest.mjs';

const check = process.argv.includes('--check');

const m = await loadManifest();
const src = readFileSync(WORKER, 'utf8');

const match = src.match(/(\/\/ <generated:topics>[\s\S]*?\/\/ <\/generated:topics>|const ALL_TOPICS = \[[\s\S]*?\];)/);
if (!match) {
  console.error('Could not find the ALL_TOPICS block in the worker.');
  process.exit(1);
}

// Group the ids the way a human would read them, but derive the grouping from
// the manifest rather than choosing it here.
const order = ['visibility', 'forecast', 'solar', 'announcements', undefined];
const live = m.categories.filter(c => c.ui !== 'retired');
const lines = [];
for (const group of order) {
  const ids = live.filter(c => c.group === group).map(c => c.id);
  if (!ids.length) continue;
  const heading = group ? group : 'no group - live but not shown in the app';
  lines.push(`  // ${heading}`);
  for (let i = 0; i < ids.length; i += 3) {
    lines.push('  ' + ids.slice(i, i + 3).map(id => `'${id}',`).join(' '));
  }
}

const block = `// <generated:topics>
// Generated from utils/notificationCategories.ts by \`npm run sync:topics\`.
// Do not edit by hand - add the topic to the manifest and re-run the script.
// \`npm run test:topics\` fails if this block and the manifest disagree.
const ALL_TOPICS = [
${lines.join('\n')}
];
// </generated:topics>`;

const next = src.slice(0, match.index) + block + src.slice(match.index + match[0].length);

if (next === src) {
  console.log('ALL_TOPICS is already up to date.');
  process.exit(0);
}
if (check) {
  console.error('ALL_TOPICS is out of date. Run: npm run sync:topics');
  process.exit(1);
}

writeFileSync(WORKER, next);
console.log(`Rewrote ALL_TOPICS with ${live.length} topics.`);
