#!/usr/bin/env node
/**
 * Build each island as a standalone IIFE bundle by invoking `vite build`
 * once per island with the ISLAND env var set. Vite/Rollup do not allow
 * a multi-input IIFE build with `inlineDynamicImports: true`, so we
 * fan out sequentially and let Vite handle code-splitting within each
 * island independently.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ISLANDS = [
  'CoursesCatalog',
  'CommunitiesCatalog',
  'ExpertsDirectory',
  'ArticlesHub',
  'StyleGuide',
  'BookingWidget',
  'AdminConsole',
];

const outDir = path.resolve('assets/islands/dist');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const name of ISLANDS) {
  process.stdout.write(`\n▶ Building island: ${name}\n`);
  const r = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, ISLAND: name },
  });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ Failed: ${name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} island build(s) failed`);
  process.exit(1);
}
console.log('\n✓ All islands built into', outDir);
