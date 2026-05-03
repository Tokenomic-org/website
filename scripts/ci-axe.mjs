#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.AXE_BASE_URL || 'http://localhost:8080';
const SITE_DIR = process.env.SITE_DIR || '_site';
const FAIL_IMPACTS = new Set(['serious', 'critical']);

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

function runAxe(url, outDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '--yes',
      '@axe-core/cli',
      url,
      '--save',
      'results.json',
      '--dir',
      outDir,
      '--exit',
      '--tags',
      'wcag2a,wcag2aa,wcag21a,wcag21aa',
    ];
    const child = spawn('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    // axe-core/cli exits non-zero when *any* violation is found. We want to
    // gate on serious/critical only, so we ignore the exit code and inspect
    // the JSON report ourselves.
    child.on('exit', () => resolve());
    child.on('error', reject);
  });
}

const failures = [];
const summary = [];

for (const path of PAGES) {
  const url = `${BASE}${path}`;
  const outDir = mkdtempSync(join(tmpdir(), 'axe-'));
  console.log(`\n::group::axe-core ${url}`);
  try {
    await runAxe(url, outDir);
    const reportPath = join(outDir, 'results.json');
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (err) {
      console.error(`Could not read axe report for ${url}: ${err.message}`);
      failures.push({ url, reason: 'no-report' });
      console.log('::endgroup::');
      continue;
    }
    // axe-core/cli writes either an array (one entry per URL) or an object.
    const entries = Array.isArray(report) ? report : [report];
    for (const entry of entries) {
      const violations = entry.violations || [];
      const blocking = violations.filter((v) => FAIL_IMPACTS.has(v.impact));
      summary.push({
        url,
        total: violations.length,
        blocking: blocking.length,
      });
      if (blocking.length > 0) {
        failures.push({ url, blocking });
        console.error(
          `\n${blocking.length} serious/critical violation(s) on ${url}:`
        );
        for (const v of blocking) {
          console.error(
            `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`
          );
          console.error(`    ${v.helpUrl}`);
        }
      } else {
        console.log(
          `OK: ${url} — ${violations.length} non-blocking violation(s).`
        );
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    console.log('::endgroup::');
  }
}

console.log('\n=== axe-core summary ===');
for (const row of summary) {
  console.log(
    `${row.url.padEnd(40)} blocking=${row.blocking} total=${row.total}`
  );
}

if (failures.length > 0) {
  console.error(
    `\nFAIL: ${failures.length} page(s) had serious/critical accessibility violations.`
  );
  process.exit(1);
}
console.log('\nAll pages passed (no serious/critical violations).');
