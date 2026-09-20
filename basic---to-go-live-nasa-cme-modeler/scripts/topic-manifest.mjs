// Shared helpers for reading the notification category manifest from node,
// and for reading back what the worker believes about topics.
//
// The manifest is TypeScript and the worker is a standalone script, so neither
// can import the other. Node's type stripping bridges the first half; the
// second half is read out of the worker source.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const MANIFEST = join(APP_DIR, 'utils', 'notificationCategories.ts');
const WORKER = join(APP_DIR, 'worker', 'push-notification-worker.js');

/**
 * Load the manifest into plain JS.
 *
 * Rather than depend on a TypeScript toolchain for one file, strip the few
 * type constructs the manifest uses and import it as a module. The manifest is
 * deliberately plain data so this stays trivial; if it ever stops being plain
 * data, that is a reason to simplify the manifest, not to grow this.
 */
export async function loadManifest() {
  let src = readFileSync(MANIFEST, 'utf8');

  src = src
    // `export type X = ...;` and `export interface X { ... }`
    .replace(/export type [\s\S]*?;\n/g, '')
    .replace(/export interface [\s\S]*?\n\}\n/g, '')
    // type annotations on exported consts
    .replace(/:\s*Record<[^=]+>\s*=/g, ' =')
    .replace(/:\s*NotificationCategory\[\]\s*=/g, ' =')
    .replace(/:\s*Set<string>\s*=/g, ' =')
    .replace(/:\s*string\[\]\s*=/g, ' =')
    // casts and annotated arrow params
    .replace(/ as CategoryGroup\[\]/g, '')
    .replace(/\(id: string\): NotificationCategory \| undefined =>/g, '(id) =>')
    .replace(/\(\[?'visibility', 'forecast', 'solar', 'announcements'\]?\)/g,
             "(['visibility', 'forecast', 'solar', 'announcements'])");

  const dir = mkdtempSync(join(tmpdir(), 'topics-'));
  const copy = join(dir, 'manifest.mjs');
  writeFileSync(copy, src);
  const mod = await import(pathToFileURL(copy).href);

  return {
    categories: mod.NOTIFICATION_CATEGORIES,
    live: mod.LIVE_TOPIC_IDS,
    toggleable: mod.TOGGLEABLE_IDS,
    defaultOn: [...mod.DEFAULT_ON_IDS],
    comingSoon: [...mod.COMING_SOON_IDS],
    hidden: [...mod.HIDDEN_IDS],
    icons: mod.TOPIC_ICONS,
    groups: mod.GROUPED_FOR_UI,
  };
}

/** The ids listed in the worker's generated ALL_TOPICS block. */
export function workerTopics(appDir = APP_DIR) {
  const src = readFileSync(join(appDir, 'worker', 'push-notification-worker.js'), 'utf8');
  const m = src.match(/const ALL_TOPICS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('could not find ALL_TOPICS in the worker');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/**
 * Every topic the worker can actually emit.
 *
 * Covers the three shapes it uses: a literal notifyTopic('x', ...), a
 * threshold table entry { topic: 'x' }, and the shock types, which are built
 * by concatenating a prefix onto a two-letter code rather than written out.
 */
export function workerSentTopics(appDir = APP_DIR) {
  const src = readFileSync(join(appDir, 'worker', 'push-notification-worker.js'), 'utf8');
  const ids = new Set();

  for (const m of src.matchAll(/notifyTopic\(\s*'([^']+)'/g)) ids.add(m[1]);
  for (const m of src.matchAll(/topic:\s*'([^']+)'/g)) ids.add(m[1]);
  for (const m of src.matchAll(/const topic = '([^']+)'/g)) ids.add(m[1]);
  // shock types: `shockType` is 'ff' | 'sf' | ... and the topic is `shock-${type}`
  for (const m of src.matchAll(/shockType = '(\w+)'/g)) ids.add(`shock-${m[1]}`);

  // 'visibility' is the outbox job's label for the per-subscriber visibility
  // job, not a topic anyone subscribes to - the real topic (visibility-dslr,
  // -phone or -naked) is chosen per subscriber inside the shard. 'test' comes
  // from the self-test helper.
  const NOT_TOPICS = new Set(['visibility', 'test', 'overnight']);
  return [...ids].filter(id => id && !id.startsWith('test-') && !NOT_TOPICS.has(id));
}

export { MANIFEST, WORKER, APP_DIR };
