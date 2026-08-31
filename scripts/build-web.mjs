#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'src/main.js')],
  outfile: join(root, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'info',
};

if (!existsSync(options.entryPoints[0])) {
  console.error('Missing entry:', options.entryPoints[0]);
  process.exit(1);
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching src/ → app.js');
} else {
  await esbuild.build(options);
}
