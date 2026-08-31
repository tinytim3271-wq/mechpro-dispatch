# Merging Windows MechPro folders into this repo

This guide is for consolidating multiple local copies of MechPro on a Windows PC into the unified repository at [tinytim3271-wq/mechpro-dispatch](https://github.com/tinytim3271-wq/mechpro-dispatch).

**Cloud Agent status (2026-08-31):** A full workspace search found **none** of the Windows paths below as uploaded or copied content in the cloud VM. Only the unified repo (plus historical PWA zips in `zip/`) is present. Until you upload or zipsync those folders, agents cannot merge unique code from them automatically.

---

## What each Windows path likely is

| Windows path | Likely role | How it maps to this repo |
| --- | --- | --- |
| `C:\mechpro-dispatch` | Primary git clone of the dispatch repo | Same content as this repo's `main` / PR branches — **canonical target** after merge |
| `C:\MechPro-work` | Scratch / active working copy (may be a second clone or extracted zip) | Compare against repo root; merge only files not already in `src/`, `desktop/`, or `infra/` |
| `C:\MechPro-dcdaf6e` | Folder named after a git commit hash prefix (`dcdaf6e…`) — often a backup, duplicate clone, or Cursor/agent export | Treat as a **point-in-time snapshot**; diff against current `main` before importing anything |
| `C:\Users\secon\OneDrive\Documents\MechPro-Lees_computer` | OneDrive-synced backup of Lee's machine | May be stale; check `.git` presence and last-modified dates before trusting it |
| `C:\Users\secon\Downloads\MechPro.worktrees` | Parent directory for **git worktrees** (linked checkouts sharing one `.git`) | List subfolders with `git worktree list` from the main clone; each child is another branch/checkout |

These are **not** the in-repo surfaces `src/`, `desktop/`, and `infra/` — those are already unified on branch `cursor/combine-three-folders-ab9b` (PR #4).

---

## What is already in the unified repo

| Surface | Path | Notes |
| --- | --- | --- |
| Frontend PWA | `src/` → bundled `app.js` | Modular entry at `src/main.js`; UI in `src/runtime/legacy.js` |
| Windows desktop | `desktop/`, root `package.json` | Electron wrapper; `npm run desktop`, `npm run build:windows` |
| AWS backend | `infra/` | CDK stacks, Lambda, Cognito |
| Historical zips | `zip/mechpro-dispatch.zip`, `zip/mechpro-dispatch-v15.zip` | Old static PWA bundles (Aug 2026); **not** full repo copies |

---

## Step 1 — Inventory your Windows folders

Run in **PowerShell** from any directory:

```powershell
$folders = @(
  'C:\mechpro-dispatch',
  'C:\MechPro-work',
  'C:\MechPro-dcdaf6e',
  'C:\Users\secon\OneDrive\Documents\MechPro-Lees_computer',
  'C:\Users\secon\Downloads\MechPro.worktrees'
)

foreach ($f in $folders) {
  if (-not (Test-Path $f)) { Write-Host "MISSING: $f"; continue }
  $git = Join-Path $f '.git'
  $hasGit = Test-Path $git
  $branch = if ($hasGit) { Push-Location $f; git rev-parse --abbrev-ref HEAD 2>$null; Pop-Location } else { 'n/a' }
  $files = (Get-ChildItem -Path $f -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "`n=== $f ==="
  Write-Host "  .git: $hasGit  branch: $branch  files: $files"
  Get-ChildItem $f -Name | Select-Object -First 15
}
```

If `MechPro.worktrees` exists, also run from your main clone:

```powershell
cd C:\mechpro-dispatch   # or whichever folder has .git
git worktree list
```

---

## Step 2 — Compare each folder to the unified repo

From a fresh clone of this repo on Windows:

```powershell
git clone https://github.com/tinytim3271-wq/mechpro-dispatch.git C:\MechPro-unified
cd C:\MechPro-unified
git checkout cursor/combine-three-folders-ab9b   # or main after PR #4 merges

node scripts/compare-folders.mjs C:\mechpro-dispatch
node scripts/compare-folders.mjs C:\MechPro-work
node scripts/compare-folders.mjs C:\MechPro-dcdaf6e
node scripts/compare-folders.mjs "C:\Users\secon\OneDrive\Documents\MechPro-Lees_computer"
```

For worktrees, compare each linked checkout:

```powershell
git -C C:\mechpro-dispatch worktree list --porcelain |
  Select-String '^worktree ' |
  ForEach-Object { $_.Line -replace '^worktree ','' } |
  ForEach-Object { node scripts/compare-folders.mjs $_ }
```

The script prints:

- Whether the path looks like a git repo, plain folder, or worktree
- Top-level entries only in the external folder
- Suggested `src/` / `desktop/` / `infra/` placement for unfamiliar files

---

## Step 3 — Decide what to merge

Use this checklist **per unique file or feature**:

- [ ] **Already in unified repo?** Search `src/`, `desktop/`, `infra/` — skip duplicates.
- [ ] **Older snapshot?** Prefer the unified repo version unless the Windows copy has clearly newer logic.
- [ ] **Frontend feature?** Add under `src/modules/<area>/`, register in `src/modules/register.js`, run `npm run build:web`.
- [ ] **Desktop-only?** Put under `desktop/`; wire through `desktop/preload.js` if exposing APIs to the web layer.
- [ ] **Backend / API?** Put under `infra/lambda/` or `infra/lib/`; run `npm run validate:infra`.
- [ ] **Local config / secrets?** Do **not** commit `.env`, credentials, or machine-specific paths.
- [ ] **OneDrive conflict copies?** Ignore `*_conflict_*` and `~$*` files.

---

## Step 4 — Consolidate locally (recommended)

1. **Pick one canonical clone:** `C:\mechpro-dispatch` (or rename to `C:\MechPro` after cleanup).
2. **Fetch latest unified branch:**
   ```powershell
   cd C:\mechpro-dispatch
   git fetch origin
   git checkout cursor/combine-three-folders-ab9b
   git pull origin cursor/combine-three-folders-ab9b
   ```
3. **Copy unique files** from other folders into the correct `src/`, `desktop/`, or `infra/` paths (see Step 3).
4. **Remove or archive duplicates:**
   ```powershell
   # Example: move old copies to an archive folder (adjust paths)
   New-Item -ItemType Directory -Force C:\MechPro-archive
   Move-Item C:\MechPro-dcdaf6e C:\MechPro-archive\
   Move-Item C:\MechPro-work C:\MechPro-archive\   # only after verifying nothing unique remains
   ```
5. **Prune worktrees** you no longer need:
   ```powershell
   git worktree remove C:\Users\secon\Downloads\MechPro.worktrees\<name>
   git worktree prune
   ```
6. **Validate:**
   ```powershell
   npm ci
   npm run validate
   npm run desktop -- --smoke-test
   ```
7. **Commit and push** on a feature branch, or open a PR.

---

## Step 5 — Upload to Cloud Agent (if you want the agent to merge)

If you prefer the agent to diff and merge for you:

### Option A — Push a branch (best)

Push your consolidated changes from Windows to GitHub; the Cloud Agent can work from that branch directly.

### Option B — Zip and attach

1. Zip **one folder at a time** (exclude `node_modules`, `.git`, `dist`):
   ```powershell
   Compress-Archive -Path C:\MechPro-work\* -DestinationPath C:\Users\secon\Downloads\MechPro-work-export.zip
   ```
2. Attach the zip to a Cursor Cloud Agent message and ask the agent to extract under `/workspace/_imports/MechPro-work/` and merge.

### Option C — rsync / zipsync (WSL)

From WSL with the repo mounted:

```bash
rsync -av --exclude node_modules --exclude .git --exclude dist \
  /mnt/c/MechPro-work/ /mnt/c/mechpro-dispatch/_merge-review/
```

Then commit `_merge-review/` on a branch and push.

---

## Step 6 — After merge

1. Delete or archive redundant Windows folders once `git status` is clean and tests pass.
2. Point OneDrive backup at the single canonical repo path (or exclude `.git` / `node_modules` from sync).
3. Update this doc with anything you learned (exact worktree names, which folder had the unique feature).

---

## Quick reference — unified repo commands

```bash
npm run build:web      # bundle src/ → app.js
npm run validate       # build:web + infra tests
npm run desktop        # Electron
npm run build:windows  # NSIS installer
```

On the Cloud Agent VM, use a login shell for npm: `bash -lc 'npm run validate'`.

---

## Related

- PR #4: [Unify src, desktop, and infra into one modular MechPro program](https://github.com/tinytim3271-wq/mechpro-dispatch/pull/4)
- `AGENTS.md` — Cloud Agent environment notes
- `src/README.md` — frontend module layout
