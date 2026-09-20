#!/usr/bin/env node
// Fails when the app and the worker disagree about notification topics.
//
//   npm run test:topics
//
// The worker is a standalone file pasted into the Cloudflare dashboard, so it
// cannot import the manifest. Instead its ALL_TOPICS block is generated from
// the manifest by `npm run sync:topics`, and this test proves the generated
// block still matches. If it does not, the fix is to run the generator - not
// to edit the worker by hand.
//
// It also catches the states that let shock-imf, flare-event, flare-peak and
// substorm-forecast go wrong in the first place: a topic something sends that
// nothing declares, a preset naming an id that does not exist, and a topic
// with no icon.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, workerTopics, workerSentTopics } from './topic-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const m = await loadManifest();
const declared = new Set(m.categories.map(c => c.id));
const live = new Set(m.categories.filter(c => c.ui !== 'retired').map(c => c.id));

console.log('\nWorker and manifest agree');
{
  const inWorker = new Set(workerTopics(APP));
  const missingFromWorker = [...live].filter(id => !inWorker.has(id));
  const extraInWorker = [...inWorker].filter(id => !live.has(id));
  check(missingFromWorker.length === 0,
        'every live topic is in the worker\'s ALL_TOPICS',
        missingFromWorker.length ? `missing: ${missingFromWorker.join(', ')} - run npm run sync:topics` : '');
  check(extraInWorker.length === 0,
        'the worker declares no topic the manifest has not heard of',
        extraInWorker.length ? `unknown: ${extraInWorker.join(', ')}` : '');
}

console.log('\nNothing sends into a void');
{
  // Every topic the worker actually calls notifyTopic() with, or names in a
  // shock/flare threshold table, has to be a declared category - otherwise
  // the preference is false for everyone and the alert reaches nobody.
  const sent = workerSentTopics(APP);
  const undeclared = sent.filter(id => !declared.has(id));
  check(undeclared.length === 0,
        'every topic the worker sends is declared in the manifest',
        undeclared.length ? `the worker sends but nothing declares: ${undeclared.join(', ')}` : '');

  // The reverse: a category claiming a sender that does not exist in the
  // worker is either a typo or a topic that quietly stopped being sent.
  const src = readFileSync(join(APP, 'worker', 'push-notification-worker.js'), 'utf8');
  const badSender = m.categories
    .filter(c => c.sentBy !== 'nothing' && !src.includes(c.sentBy))
    .map(c => `${c.id} -> ${c.sentBy}`);
  check(badSender.length === 0,
        'every category names a sender that exists in the worker',
        badSender.length ? badSender.join(', ') : '');

  // A retired topic must have no sender left.
  const retiredButSent = m.categories
    .filter(c => c.ui === 'retired' && sent.includes(c.id))
    .map(c => c.id);
  check(retiredButSent.length === 0,
        'nothing retired is still being sent',
        retiredButSent.join(', '));
}

console.log('\nThe manifest is internally sound');
{
  const dupes = m.categories.map(c => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  check(dupes.length === 0, 'no duplicate ids', dupes.join(', '));

  const noIcon = m.categories.filter(c => !c.icon).map(c => c.id);
  check(noIcon.length === 0, 'every category has an icon', noIcon.join(', '));

  const toggleNoLabel = m.categories
    .filter(c => c.ui === 'toggle' && (!c.label || !c.group))
    .map(c => c.id);
  check(toggleNoLabel.length === 0,
        'every visible category has a label and a group',
        toggleNoLabel.join(', '));

  // A live topic with no toggle is on for everyone with no way to opt out.
  // That is allowed, but it has to be a decision somebody wrote down.
  const hiddenNoNote = m.categories
    .filter(c => c.ui === 'hidden' && !c.note)
    .map(c => c.id);
  check(hiddenNoNote.length === 0,
        'every toggle-less topic explains why it has no toggle',
        hiddenNoNote.join(', '));
}

console.log('\nEvery icon exists');
{
  // The icons folder was removed from the build at some point and nothing
  // noticed, so every notification fell back to the platform's default bell
  // for as long as that lasted. A missing icon is now a failing test rather
  // than a mystery on somebody's phone.
  const missing = [];
  const wrongSize = [];
  for (const c of m.categories) {
    for (const [what, rel] of [['icon', c.icon], ['badge', c.badge]]) {
      if (!rel) continue;
      const file = join(APP, 'public', rel.replace(/^\//, ''));
      if (!existsSync(file)) { missing.push(`${c.id} ${what} -> ${rel}`); continue; }
      // A notification icon below 192px looks soft on a modern phone; the
      // badge is deliberately smaller.
      const bytes = statSync(file).size;
      if (bytes < 200) wrongSize.push(`${rel} is only ${bytes} bytes`);
    }
  }
  check(missing.length === 0,
        'every icon the manifest names is in public/icons',
        missing.join('\n        '));
  check(wrongSize.length === 0, 'and none of them is an empty file', wrongSize.join(', '));

  const badgeFile = join(APP, 'public', 'icons', 'icon-badge.png');
  check(existsSync(badgeFile), 'the Android status-bar badge exists');

  // The service worker and the PWA manifest name their own assets, and those
  //404 just as quietly. manifest.json pointed at a maskable icon that had
  // never existed.
  for (const [label, file] of [['the service worker', join(APP, 'public', 'sw.js')],
                               ['the web app manifest', join(APP, 'public', 'manifest.json')]]) {
    if (!existsSync(file)) { check(false, `${label} is in public/`); continue; }
    const text = readFileSync(file, 'utf8');
    const refs = [...new Set([...text.matchAll(/['"](\/icons\/[A-Za-z0-9._-]+)['"]/g)].map(x => x[1]))];
    const gone = refs.filter(r => !existsSync(join(APP, 'public', r.replace(/^\//, ''))));
    check(gone.length === 0,
          `every icon ${label} names exists (${refs.length} referenced)`,
          gone.join(', '));
  }

  // The badge has to be mostly transparent. Android masks it to a silhouette,
  // so a full-colour square renders as a solid blob - which is what the
  // service worker used to pass.
  const badgeBytes = statSync(badgeFile).size;
  check(badgeBytes > 200 && badgeBytes < 40000,
        'the badge is a small silhouette rather than a full-colour image',
        `${badgeBytes} bytes`);
}

console.log('\nPresets only name real topics');
{
  const presetSrc = readFileSync(join(APP, 'utils', 'notificationPresets.ts'), 'utf8');
  const ids = [...presetSrc.matchAll(/prefs:\s*\[([^\]]*)\]/g)]
    .flatMap(mm => [...mm[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  const unknown = [...new Set(ids)].filter(id => !declared.has(id));
  check(unknown.length === 0, 'every preset id is a declared category', unknown.join(', '));

  const retiredInPreset = [...new Set(ids)].filter(
    id => m.categories.find(c => c.id === id)?.ui === 'retired');
  check(retiredInPreset.length === 0, 'no preset turns on a retired topic', retiredInPreset.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
