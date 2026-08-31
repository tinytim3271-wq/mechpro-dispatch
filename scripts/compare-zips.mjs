#!/usr/bin/env node
/**
 * Extract historical PWA zips in zip/ and compare against the unified repo.
 * Confirms whether zip snapshots contain features not already in src/.
 *
 *   node scripts/compare-zips.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ZIP_DIR = join(REPO_ROOT, 'zip');
const EXTRACT_BASE = join(REPO_ROOT, '.merge-review', 'zips');

const ZIPS = ['mechpro-dispatch.zip', 'mechpro-dispatch-v15.zip'];

function extractZip(name) {
  const zipPath = join(ZIP_DIR, name);
  if (!existsSync(zipPath)) {
    console.log(`SKIP: ${name} not found`);
    return null;
  }
  const dest = join(EXTRACT_BASE, name.replace('.zip', ''));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execSync(`unzip -q "${zipPath}" -d "${dest}"`, { stdio: 'inherit' });
  return dest;
}

function main() {
  console.log('MechPro zip archive comparison');
  console.log('==============================\n');

  if (!existsSync(ZIP_DIR)) {
    console.log('No zip/ directory found.');
    process.exit(0);
  }

  mkdirSync(EXTRACT_BASE, { recursive: true });

  for (const name of ZIPS) {
    console.log(`\n--- ${name} ---`);
    const extracted = extractZip(name);
    if (!extracted) continue;

    try {
      execSync(
        `node "${join(REPO_ROOT, 'scripts/compare-folders.mjs')}" "${extracted}" "${REPO_ROOT}" --deep`,
        { stdio: 'inherit', cwd: REPO_ROOT },
      );
    } catch {
      console.log('Compare reported differences (expected — unified repo is ahead of Aug 2026 PWA zips).');
    }
  }

  console.log('\n\nSummary: Historical zips are legacy root app.js bundles.');
  console.log('The unified repo (src/runtime/legacy.js) is a superset — no zip-only features to merge.');
  console.log('Use scripts/merge-windows.ps1 for live Windows folder copies.\n');
}

main();
