#!/usr/bin/env node
/**
 * Compare a local MechPro folder (Windows clone, backup, or worktree)
 * against this unified repo. Intended to run on Windows or WSL:
 *
 *   node scripts/compare-folders.mjs C:\MechPro-work
 *   node scripts/compare-folders.mjs /mnt/c/mechpro-dispatch
 *
 * Exits 0 with a human-readable report; exit 1 if the path is missing.
 */

import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.cursor',
  '.vscode',
  'coverage',
  '.playwright-mcp',
  '.agents',
  '.claude',
]);

const SURFACE_HINTS = [
  { prefix: 'src/', surface: 'Frontend (src/)' },
  { prefix: 'desktop/', surface: 'Desktop (desktop/)' },
  { prefix: 'infra/', surface: 'Backend (infra/)' },
  { prefix: 'scripts/', surface: 'Root scripts' },
  { prefix: 'docs/', surface: 'Documentation' },
  { prefix: 'assets/', surface: 'Static assets' },
  { prefix: 'zip/', surface: 'Historical zips' },
];

function usage() {
  console.log(`Usage: node scripts/compare-folders.mjs <external-folder> [repo-root]

Compare <external-folder> to the unified MechPro repo (default repo root: ${REPO_ROOT}).

Examples:
  node scripts/compare-folders.mjs C:\\MechPro-work
  node scripts/compare-folders.mjs C:\\mechpro-dispatch
  node scripts/compare-folders.mjs /mnt/c/Users/secon/Downloads/MechPro.worktrees/feature-x
`);
}

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function listTopLevel(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !SKIP_DIRS.has(entry.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function classifyFolder(name) {
  const lower = name.toLowerCase();
  if (lower.includes('worktree')) return 'worktrees-parent';
  if (/^[a-f0-9]{7,}$/i.test(name.replace(/^MechPro-/, ''))) return 'hash-snapshot';
  if (lower.includes('onedrive') || lower.includes('lees')) return 'onedrive-backup';
  if (lower.includes('dispatch')) return 'dispatch-clone';
  if (lower.includes('work')) return 'working-copy';
  return 'unknown';
}

function suggestSurface(relPath) {
  const normalized = relPath.replaceAll('\\', '/');
  for (const { prefix, surface } of SURFACE_HINTS) {
    if (normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)) {
      return surface;
    }
  }
  const top = normalized.split('/')[0];
  if (/\.(html|css|js|mjs|ts|tsx|jsx)$/.test(top)) return 'Frontend (likely merge into src/ or root static files)';
  if (top === 'lambda' || top === 'cdk.out') return 'Backend (infra/)';
  if (top === 'electron' || top === 'main.js') return 'Desktop (desktop/)';
  return 'Review manually — map to src/, desktop/, or infra/';
}

function gitInfo(dir) {
  const inside = safeExec('git rev-parse --is-inside-work-tree', dir);
  if (inside !== 'true') return { isRepo: false };

  const branch = safeExec('git rev-parse --abbrev-ref HEAD', dir);
  const commit = safeExec('git rev-parse --short HEAD', dir);
  const remote = safeExec('git remote get-url origin', dir);
  const worktrees = safeExec('git worktree list --porcelain', dir);
  const isLinkedWorktree = worktrees?.split('\n').filter((l) => l.startsWith('worktree ')).length > 1;

  return {
    isRepo: true,
    branch: branch ?? '(detached)',
    commit: commit ?? '?',
    remote: remote ?? '(none)',
    isLinkedWorktree: Boolean(isLinkedWorktree),
  };
}

function diffTopLevel(externalDir, repoDir) {
  const external = new Set(listTopLevel(externalDir));
  const repo = new Set(listTopLevel(repoDir));
  const onlyExternal = [...external].filter((x) => !repo.has(x)).sort();
  const onlyRepo = [...repo].filter((x) => !external.has(x)).sort();
  const shared = [...external].filter((x) => repo.has(x)).sort();
  return { onlyExternal, onlyRepo, shared };
}

function main() {
  const externalArg = process.argv[2];
  const repoRoot = resolve(process.argv[3] ?? REPO_ROOT);

  if (!externalArg || externalArg === '-h' || externalArg === '--help') {
    usage();
    process.exit(externalArg ? 0 : 1);
  }

  const externalDir = resolve(externalArg);

  if (!existsSync(externalDir)) {
    console.error(`ERROR: Path not found: ${externalDir}`);
    process.exit(1);
  }

  if (!existsSync(repoRoot)) {
    console.error(`ERROR: Repo root not found: ${repoRoot}`);
    process.exit(1);
  }

  const folderName = basename(externalDir);
  const kind = classifyFolder(folderName);
  const git = gitInfo(externalDir);
  const { onlyExternal, onlyRepo, shared } = diffTopLevel(externalDir, repoRoot);

  console.log('MechPro folder comparison report');
  console.log('================================');
  console.log(`External:  ${externalDir}`);
  console.log(`Repo:      ${repoRoot}`);
  console.log(`Kind:      ${kind}`);
  console.log('');

  if (git.isRepo) {
    console.log('Git:');
    console.log(`  branch:    ${git.branch}`);
    console.log(`  commit:    ${git.commit}`);
    console.log(`  origin:    ${git.remote}`);
    console.log(`  worktree:  ${git.isLinkedWorktree ? 'yes (linked checkout)' : 'primary or standalone'}`);
  } else {
    console.log('Git:       not a git repository (plain folder / export / zip extract)');
  }

  console.log('');
  console.log(`Top-level entries only in external folder (${onlyExternal.length}):`);
  if (onlyExternal.length === 0) {
    console.log('  (none — external top-level matches repo or is a subset)');
  } else {
    for (const entry of onlyExternal) {
      console.log(`  + ${entry}  →  ${suggestSurface(entry)}`);
    }
  }

  console.log('');
  console.log(`Top-level entries only in unified repo (${onlyRepo.length}):`);
  if (onlyRepo.length === 0) {
    console.log('  (none)');
  } else {
    for (const entry of onlyRepo.slice(0, 25)) {
      console.log(`  - ${entry}`);
    }
    if (onlyRepo.length > 25) {
      console.log(`  ... and ${onlyRepo.length - 25} more`);
    }
  }

  console.log('');
  console.log(`Shared top-level entries (${shared.length}): ${shared.join(', ') || '(none)'}`);

  // Surface detection for modular layout
  const hasSrc = existsSync(join(externalDir, 'src'));
  const hasDesktop = existsSync(join(externalDir, 'desktop'));
  const hasInfra = existsSync(join(externalDir, 'infra'));
  const hasLegacyRoot = existsSync(join(externalDir, 'app.js')) && !hasSrc;

  console.log('');
  console.log('Layout:');
  console.log(`  src/       ${hasSrc ? 'present' : 'missing'}`);
  console.log(`  desktop/   ${hasDesktop ? 'present' : 'missing'}`);
  console.log(`  infra/     ${hasInfra ? 'present' : 'missing'}`);
  console.log(`  legacy PWA ${hasLegacyRoot ? 'yes (root app.js, pre-modular)' : 'no'}`);

  console.log('');
  console.log('Next steps:');
  console.log('  1. Read docs/MERGE_WINDOWS_FOLDERS.md');
  console.log('  2. Merge unique files into src/, desktop/, or infra/');
  console.log('  3. Run: npm run validate');
  console.log('  4. Push a branch or upload a zip for Cloud Agent merge');

  if (kind === 'worktrees-parent') {
    console.log('');
    console.log('Note: This looks like a worktrees parent. Run compare-folders.mjs on each child worktree path.');
  }
}

main();
