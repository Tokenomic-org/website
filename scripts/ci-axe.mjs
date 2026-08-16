#!/usr/bin/env node
/**
 * axe-core accessibility gate for CI.
 *
 * Scans the top-level public pages plus every built dashboard page and
 * fails the build on `serious` or `critical` violations under
 * wcag2a / wcag2aa / wcag21a / wcag21aa.
 *
 * Driver note: this used to shell out to `npx @axe-core/cli`, which drives
 * Chrome through Selenium + a separately-versioned `chromedriver`. On the
 * GitHub runner those two drifted apart:
 *
 *     session not created: This version of ChromeDriver only supports
 *     Chrome version 152. Current browser version is 151.0.7922.108
 *
 * Every page then failed to launch a session, wrote no report, and the
 * run was reported as "30 page(s) had serious/critical accessibility
 * violations" — even though nothing had actually been scanned. We now use
 * Playwright, which ships a browser matched to its own version, so there
 * is no driver/browser version to keep in sync.
 *
 * Scan failures are also tracked separately from violations now. A broken
 * scanner must never be reportable as an accessibility result, in either
 * direction: it must not invent violations, and it must not let a page
 * silently go unscanned and be counted as passing.
 *
 * Requires `playwright` and `axe-core` (installed by the workflow) and a
 * server already serving the site at AXE_BASE_URL.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.env.AXE_BASE_URL || 'http://localhost:8080';
const SITE_DIR = process.env.SITE_DIR || '_site';
const FAIL_IMPACTS = new Set(['serious', 'critical']);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const TOP_LEVEL_PAGES = [
  '/courses/',
  '/communities/',
  '/experts/',
  '/articles/',
];

function walkHtml(dir, baseUrlPrefix, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkHtml(full, `${baseUrlPrefix}${entry}/`, out);
      continue;
    }
    if (!entry.endsWith('.html')) continue;
    const route =
      entry === 'index.html'
        ? baseUrlPrefix
        : `${baseUrlPrefix}${entry.slice(0, -'.html'.length)}/`;
    out.add(route);
    if (entry !== 'index.html') {
      // Also include the literal .html URL in case the static server
      // does not perform extensionless rewrites.
      out.add(`${baseUrlPrefix}${entry}`);
    }
  }
}

function discoverDashboardPages() {
  const dashRoot = join(SITE_DIR, 'dashboard');
  const pages = new Set(['/dashboard/']);
  if (!existsSync(dashRoot)) {
    console.warn(
      `WARN: ${dashRoot} not found; only the dashboard index will be scanned.`
    );
    return [...pages];
  }
  walkHtml(dashRoot, '/dashboard/', pages);
  return [...pages].sort();
}

const PAGES = [...TOP_LEVEL_PAGES, ...discoverDashboardPages()];
console.log(`Discovered ${PAGES.length} page(s) to scan:`);
for (const p of PAGES) console.log(`  - ${p}`);

const violationFailures = [];
const scanErrors = [];
const summary = [];

// CI lets Playwright use the browser it installed itself. AXE_CHROMIUM_PATH
// is an escape hatch for environments that pin a preinstalled Chromium and
// cannot download one (sandboxes, air-gapped runners).
const launchOpts = { args: ['--no-sandbox'] };
if (process.env.AXE_CHROMIUM_PATH) {
  launchOpts.executablePath = process.env.AXE_CHROMIUM_PATH;
}
const browser = await chromium.launch(launchOpts);

try {
  for (const path of PAGES) {
    const url = `${BASE}${path}`;
    console.log(`\n::group::axe-core ${url}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const resp = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      if (!resp || !resp.ok()) {
        throw new Error(`HTTP ${resp ? resp.status() : 'no response'}`);
      }
      // Let client-rendered islands mount before scanning.
      await page.waitForTimeout(500);
      await page.addScriptTag({ content: AXE_SOURCE });
      const result = await page.evaluate(
        (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        TAGS
      );

      const violations = result.violations || [];
      const blocking = violations.filter((v) => FAIL_IMPACTS.has(v.impact));
      summary.push({ url, total: violations.length, blocking: blocking.length });

      if (blocking.length > 0) {
        violationFailures.push({ url, blocking });
        console.error(`\n${blocking.length} serious/critical violation(s) on ${url}:`);
        for (const v of blocking) {
          console.error(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
          console.error(`    ${v.helpUrl}`);
          for (const n of v.nodes.slice(0, 5)) {
            console.error(`      ${n.target.join(' ')}`);
          }
        }
      } else {
        console.log(`OK: ${url} — ${violations.length} non-blocking violation(s).`);
      }
    } catch (err) {
      // Could not scan. Deliberately NOT counted as an accessibility
      // result — see the header comment.
      console.error(`SCAN ERROR on ${url}: ${err.message}`);
      scanErrors.push({ url, message: err.message });
    } finally {
      await context.close();
      console.log('::endgroup::');
    }
  }
} finally {
  await browser.close();
}

console.log('\n=== axe-core summary ===');
for (const row of summary) {
  console.log(`${row.url.padEnd(48)} blocking=${row.blocking} total=${row.total}`);
}
console.log(
  `\nscanned=${summary.length}/${PAGES.length}  ` +
  `pages_with_blocking=${violationFailures.length}  scan_errors=${scanErrors.length}`
);

if (scanErrors.length > 0) {
  console.error(`\nFAIL: ${scanErrors.length} page(s) could not be scanned:`);
  for (const e of scanErrors) console.error(`  - ${e.url}: ${e.message}`);
  console.error('These are scanner/serving errors, NOT accessibility findings.');
}
if (violationFailures.length > 0) {
  console.error(
    `\nFAIL: ${violationFailures.length} page(s) had serious/critical accessibility violations.`
  );
}
if (scanErrors.length > 0 || violationFailures.length > 0) process.exit(1);

console.log('\nAll pages scanned and passed (no serious/critical violations).');
