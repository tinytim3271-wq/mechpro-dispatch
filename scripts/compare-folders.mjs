#!/usr/bin/env node
/**
 * Compare a local MechPro folder (Windows clone, backup, worktree, or zip extract)
 * against this unified repo. Intended to run on Windows or WSL:
 *
 *   node scripts/compare-folders.mjs C:\MechPro-work
 *   node scripts/compare-folders.mjs /mnt/c/mechpro-dispatch --deep
 *   node scripts/compare-folders.mjs C:\MechPro-work --json
 *
 * Exits 0 with a human-readable report; exit 1 if the path is missing.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Default Windows paths the user reported (for merge-windows.ps1 reference). */
export const DEFAULT_WINDOWS_PATHS = [
  'C:\\mechpro-dispatch',
  'C:\\MechPro-work',
  'C:\\MechPro-dcdaf6e',
  'C:\\Users\\secon\\OneDrive\\Documents\\MechPro-Lees_computer',
  'C:\\Users\\secon\\Downloads\\MechPro.worktrees',
];

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
  'cdk.out',
]);

const MERGE_SURFACES = ['src', 'desktop', 'infra', 'scripts', 'docs', 'assets'];

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
  console.log(`Usage: node scripts/compare-folders.mjs <external-folder> [repo-root] [options]

Compare <external-folder> to the unified MechPro repo (default repo root: ${REPO_ROOT}).

Options:
  --deep     Walk merge surfaces (src/, desktop/, infra/, etc.) and list unique/differing files
  --json     Machine-readable JSON report (for merge-windows.ps1)
  -h, --help Show this help

Examples:
  node scripts/compare-folders.mjs C:\\MechPro-work
  node scripts/compare-folders.mjs C:\\mechpro-dispatch --deep
  node scripts/compare-folders.mjs /mnt/c/MechPro-work --deep --json
`);
}

function parseArgs(argv) {
  const positional = [];
  let deep = false;
  let json = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--deep') deep = true;
    else if (arg === '--json') json = true;
    else if (arg === '-h' || arg === '--help') positional.push('--help');
    else positional.push(arg);
  }

  return {
    externalArg: positional[0],
    repoRoot: resolve(positional[1] ?? REPO_ROOT),
    deep,
    json,
    help: positional[0] === '--help',
  };
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
  if (/\.(html|css|js|mjs|ts|tsx|jsx)$/.test(top)) {
    return 'Frontend (likely merge into src/ or root static files)';
  }
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

function fileHash(filePath) {
  try {
    const data = readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function walkMergeFiles(baseDir, surfaces) {
  const files = [];

  function walk(current, relPrefix) {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        files.push(rel.replaceAll('\\', '/'));
      }
    }
  }

  for (const surface of surfaces) {
    walk(join(baseDir, surface), surface);
  }

  // Legacy root PWA (pre-modular): treat app.js as src/runtime/legacy.js equivalent
  if (existsSync(join(baseDir, 'app.js')) && !existsSync(join(baseDir, 'src'))) {
    files.push('app.js');
  }

  return files.sort();
}

function deepCompare(externalDir, repoDir) {
  const externalFiles = walkMergeFiles(externalDir, MERGE_SURFACES);
  const repoFiles = walkMergeFiles(repoDir, MERGE_SURFACES);

  const externalSet = new Set(externalFiles);
  const repoSet = new Set(repoFiles);

  const onlyExternal = externalFiles.filter((f) => !repoSet.has(f));
  const onlyRepo = repoFiles.filter((f) => !externalSet.has(f));

  const shared = externalFiles.filter((f) => repoSet.has(f));
  const differing = [];
  const identical = [];

  for (const rel of shared) {
    const extPath = join(externalDir, rel);
    const repoPath = join(repoDir, rel);
    const extHash = fileHash(extPath);
    const repoHash = fileHash(repoPath);
    if (extHash && repoHash && extHash !== repoHash) {
      const extSize = statSync(extPath).size;
      const repoSize = statSync(repoPath).size;
      differing.push({
        path: rel,
        externalBytes: extSize,
        repoBytes: repoSize,
        surface: suggestSurface(rel),
        newerLikely: extSize > repoSize ? 'external' : extSize < repoSize ? 'repo' : 'compare-content',
      });
    } else if (extHash === repoHash) {
      identical.push(rel);
    }
  }

  // Map legacy app.js differences
  if (existsSync(join(externalDir, 'app.js')) && !existsSync(join(externalDir, 'src'))) {
    const legacyPath = join(externalDir, 'app.js');
    const repoLegacy = join(repoDir, 'src/runtime/legacy.js');
    if (existsSync(repoLegacy)) {
      const extHash = fileHash(legacyPath);
      const repoHash = fileHash(repoLegacy);
      if (extHash !== repoHash) {
        differing.push({
          path: 'app.js → src/runtime/legacy.js',
          externalBytes: statSync(legacyPath).size,
          repoBytes: statSync(repoLegacy).size,
          surface: 'Frontend (src/runtime/legacy.js)',
          newerLikely: statSync(legacyPath).size > statSync(repoLegacy).size ? 'external' : 'repo',
        });
      }
    }
  }

  return { onlyExternal, onlyRepo, differing, identicalCount: identical.length };
}

function buildReport(externalDir, repoRoot, options) {
  const folderName = basename(externalDir);
  const kind = classifyFolder(folderName);
  const git = gitInfo(externalDir);
  const { onlyExternal, onlyRepo, shared } = diffTopLevel(externalDir, repoRoot);

  const hasSrc = existsSync(join(externalDir, 'src'));
  const hasDesktop = existsSync(join(externalDir, 'desktop'));
  const hasInfra = existsSync(join(externalDir, 'infra'));
  const hasLegacyRoot = existsSync(join(externalDir, 'app.js')) && !hasSrc;

  const report = {
    external: externalDir,
    repo: repoRoot,
    folderName,
    kind,
    git,
    topLevel: { onlyExternal, onlyRepo, shared },
    layout: { hasSrc, hasDesktop, hasInfra, hasLegacyRoot },
  };

  if (options.deep) {
    report.deep = deepCompare(externalDir, repoRoot);
  }

  return report;
}

function printReport(report, deep) {
  console.log('MechPro folder comparison report');
  console.log('================================');
  console.log(`External:  ${report.external}`);
  console.log(`Repo:      ${report.repo}`);
  console.log(`Kind:      ${report.kind}`);
  console.log('');

  if (report.git.isRepo) {
    console.log('Git:');
    console.log(`  branch:    ${report.git.branch}`);
    console.log(`  commit:    ${report.git.commit}`);
    console.log(`  origin:    ${report.git.remote}`);
    console.log(`  worktree:  ${report.git.isLinkedWorktree ? 'yes (linked checkout)' : 'primary or standalone'}`);
  } else {
    console.log('Git:       not a git repository (plain folder / export / zip extract)');
  }

  console.log('');
  console.log(`Top-level entries only in external folder (${report.topLevel.onlyExternal.length}):`);
  if (report.topLevel.onlyExternal.length === 0) {
    console.log('  (none — external top-level matches repo or is a subset)');
  } else {
    for (const entry of report.topLevel.onlyExternal) {
      console.log(`  + ${entry}  →  ${suggestSurface(entry)}`);
    }
  }

  console.log('');
  console.log(`Top-level entries only in unified repo (${report.topLevel.onlyRepo.length}):`);
  if (report.topLevel.onlyRepo.length === 0) {
    console.log('  (none)');
  } else {
    for (const entry of report.topLevel.onlyRepo.slice(0, 25)) {
      console.log(`  - ${entry}`);
    }
    if (report.topLevel.onlyRepo.length > 25) {
      console.log(`  ... and ${report.topLevel.onlyRepo.length - 25} more`);
    }
  }

  console.log('');
  console.log(`Shared top-level entries (${report.topLevel.shared.length}): ${report.topLevel.shared.join(', ') || '(none)'}`);

  console.log('');
  console.log('Layout:');
  console.log(`  src/       ${report.layout.hasSrc ? 'present' : 'missing'}`);
  console.log(`  desktop/   ${report.layout.hasDesktop ? 'present' : 'missing'}`);
  console.log(`  infra/     ${report.layout.hasInfra ? 'present' : 'missing'}`);
  console.log(`  legacy PWA ${report.layout.hasLegacyRoot ? 'yes (root app.js, pre-modular)' : 'no'}`);

  if (deep && report.deep) {
    const { onlyExternal, onlyRepo, differing, identicalCount } = report.deep;
    console.log('');
    console.log('Deep merge-surface scan:');
    console.log(`  Identical files:           ${identicalCount}`);
    console.log(`  Only in external (${onlyExternal.length}):`);
    if (onlyExternal.length === 0) {
      console.log('    (none)');
    } else {
      for (const f of onlyExternal.slice(0, 40)) {
        console.log(`    + ${f}  →  ${suggestSurface(f)}`);
      }
      if (onlyExternal.length > 40) console.log(`    ... and ${onlyExternal.length - 40} more`);
    }
    console.log(`  Only in repo (${onlyRepo.length}): ${onlyRepo.length <= 5 ? onlyRepo.join(', ') || '(none)' : `${onlyRepo.length} files (repo is ahead)`}`);
    console.log(`  Content differs (${differing.length}):`);
    if (differing.length === 0) {
      console.log('    (none)');
    } else {
      for (const d of differing.slice(0, 30)) {
        console.log(`    ~ ${d.path}  ext=${d.externalBytes}B repo=${d.repoBytes}B  likely-newer=${d.newerLikely}`);
      }
      if (differing.length > 30) console.log(`    ... and ${differing.length - 30} more`);
    }
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Read docs/MERGE_WINDOWS_FOLDERS.md');
  console.log('  2. Run scripts/merge-windows.ps1 for automated local merge');
  console.log('  3. Run: npm run validate');

  if (report.kind === 'worktrees-parent') {
    console.log('');
    console.log('Note: This looks like a worktrees parent. Run compare-folders.mjs on each child worktree path.');
  }
}

function main() {
  const { externalArg, repoRoot, deep, json, help } = parseArgs(process.argv);

  if (!externalArg || help) {
    usage();
    process.exit(help ? 0 : 1);
  }

  const externalDir = resolve(externalArg);

  if (!existsSync(externalDir)) {
    if (json) {
      console.log(JSON.stringify({ error: 'path_not_found', path: externalDir }, null, 2));
    } else {
      console.error(`ERROR: Path not found: ${externalDir}`);
    }
    process.exit(1);
  }

  if (!existsSync(repoRoot)) {
    if (json) {
      console.log(JSON.stringify({ error: 'repo_not_found', path: repoRoot }, null, 2));
    } else {
      console.error(`ERROR: Repo root not found: ${repoRoot}`);
    }
    process.exit(1);
  }

  const report = buildReport(externalDir, repoRoot, { deep });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, deep);
  }
}

main();
