#!/usr/bin/env node
// index.html starts the forecast page's core feeds before the app has loaded,
// and the app takes those requests over (utils/sharedFetch). That only works
// while index.html asks for exactly the addresses the app does, and decides
// the landing page the way the app does. This checks both, so a change on
// one side cannot quietly turn the early start into a wasted extra download.
//
//   npm run test:boot-fetch

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const constant = (src, name) => src.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`))?.[1];

const html = read('index.html');
const bootBlock = html.match(/var urls = \[([\s\S]*?)\];/)?.[1] ?? '';
const bootUrls = [...bootBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(bootUrls.length > 0, 'index.html starts some feeds early');

const hook = read('hooks/useForecastData.ts');
const want = ['FORECAST_API_URL', 'SOLAR_WIND_IMF_URL', 'SUBSTORM_RISK_URL'].map((n) => [n, constant(hook, n)]);
for (const [name, url] of want) {
  check(!!url && bootUrls.includes(url), `index.html starts ${name} at the app's address`, `${url}`);
}
for (const url of bootUrls) {
  check(want.some(([, u]) => u === url), `every early feed is one the app asks for: ${url}`);
}
check(constant(read('components/GlobalBanner.tsx'), 'SUBSTORM_URL') === constant(hook, 'SUBSTORM_RISK_URL'),
  'the banner reads the same substorm address, so it shares the download');
check(!/_=/.test(bootBlock), 'the early addresses carry no cache-buster of their own');

// The landing page, decided the same way.
const nav = read('utils/navigation.ts');
const pagePaths = [...(nav.match(/PAGE_PATHS[\s\S]*?\n\};/)?.[0] ?? '').matchAll(/'?([a-z-]+)'?:\s*'(\/[a-z-]+)'/g)];
check(pagePaths.length === 3, 'found the app\'s three page paths');
for (const [, page, path] of pagePaths) {
  check(html.includes(`path.indexOf('${path}') === 0) page = '${page}'`), `index.html maps ${path} to ${page}`);
}
check(html.includes(`getItem('${constant(nav, 'DEFAULT_MAIN_PAGE_KEY')}')`), 'index.html reads the default-page setting the app writes');
check(html.includes(`getItem('${constant(read('App.tsx'), 'DASHBOARD_MODE_KEY')}') === 'true'`), 'index.html reads the dashboard-mode setting the app writes');

// The pages the build preloads code for still exist.
const vite = read('vite.config.ts');
const modules = [...(vite.match(/const PAGES[\s\S]*?\n  \};/)?.[0] ?? '').matchAll(/'(components\/[A-Za-z]+\.tsx)'/g)].map((m) => m[1]);
check(modules.length >= 4, 'the build preloads code for each page');
for (const m of modules) check(existsSync(join(root, m)), `page module exists: ${m}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
