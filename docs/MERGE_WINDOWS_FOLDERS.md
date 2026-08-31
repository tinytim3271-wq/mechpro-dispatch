# Merging Windows MechPro folders into this repo

This guide consolidates multiple local copies of MechPro on a Windows PC into the unified repository at [tinytim3271-wq/mechpro-dispatch](https://github.com/tinytim3271-wq/mechpro-dispatch).

## One-command merge (Windows)

From PowerShell, in a clone of this repo on branch `cursor/combine-three-folders-ab9b`:

```powershell
cd C:\mechpro-dispatch
git fetch origin
git checkout cursor/combine-three-folders-ab9b
git pull origin cursor/combine-three-folders-ab9b
npm ci

# Preview what would be copied (no changes):
.\scripts\merge-windows.ps1 -DryRun

# Run full merge + validate:
.\scripts\merge-windows.ps1

# Merge, validate, and commit:
.\scripts\merge-windows.ps1 -Commit
```

The script automatically:

1. Inventories all five known Windows paths (skips missing ones)
2. Expands `MechPro.worktrees` subfolders and `git worktree list` checkouts
3. Runs `compare-folders.mjs --deep` on each external folder
4. Copies files that exist **only** in external folders into `src/`, `desktop/`, `infra/`, etc.
5. Reports content differences for manual review (repo is often ahead of old copies)
6. Runs `npm run validate`

**Dry-run first** to see what would change. The unified repo on `cursor/combine-three-folders-ab9b` already includes modular `src/`, Electron `desktop/`, and CDK `infra/` — most Windows copies will show zero unique files.

---

## Cloud Agent status (2026-08-31, second pass)

Re-scanned `/workspace`, `/tmp`, `/home/ubuntu`, uploads, and attachment-like paths. **Still no** `MechPro-work`, `MechPro-dcdaf6e`, `Lees_computer`, or Windows worktree copies on this Linux VM. Available sources:

| Source | Status |
| --- | --- |
| `zip/mechpro-dispatch.zip`, `zip/mechpro-dispatch-v15.zip` | Re-extracted via `npm run compare-zips` — **legacy Aug 2026 PWA bundles; unified `src/runtime/legacy.js` is newer/larger; zero zip-only features** |
| `cursor/combine-three-folders-ab9b` | Canonical unified repo (this branch, PR #4); `src/` → `app.js` is the editable frontend |
| Windows paths (`C:\MechPro-work`, etc.) | **Blocker:** not mounted / not uploaded — run `merge-windows.ps1` on the Windows PC |

**In-repo move completed on this VM:** modular `src/`, Electron `desktop/`, CDK `infra/`, merge scripts, and docs are the single program. Root `app.js` is generated (`npm run build:web`). Live `C:\` folder content still requires a local PowerShell merge.

Run `npm run compare-zips` in the repo to re-verify zip archives anytime.

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

## Manual compare (single folder)

```powershell
node scripts/compare-folders.mjs C:\MechPro-work
node scripts/compare-folders.mjs C:\MechPro-work --deep
node scripts/compare-folders.mjs C:\MechPro-work --deep --json
```

For worktrees, compare each linked checkout:

```powershell
git -C C:\mechpro-dispatch worktree list --porcelain |
  Select-String '^worktree ' |
  ForEach-Object { $_.Line -replace '^worktree ','' } |
  ForEach-Object { node scripts/compare-folders.mjs $_ --deep }
```

The script prints:

- Whether the path looks like a git repo, plain folder, or worktree
- Top-level entries only in the external folder
- With `--deep`: files only in external, only in repo, and content differences under merge surfaces
- Suggested `src/` / `desktop/` / `infra/` placement for unfamiliar files

---

## Decide what to merge

Use this checklist **per unique file or feature**:

- [ ] **Already in unified repo?** Search `src/`, `desktop/`, `infra/` — skip duplicates.
- [ ] **Older snapshot?** Prefer the unified repo version unless the Windows copy has clearly newer logic.
- [ ] **Frontend feature?** Add under `src/modules/<area>/`, register in `src/modules/register.js`, run `npm run build:web`.
- [ ] **Desktop-only?** Put under `desktop/`; wire through `desktop/preload.js` if exposing APIs to the web layer.
- [ ] **Backend / API?** Put under `infra/lambda/` or `infra/lib/`; run `npm run validate:infra`.
- [ ] **Local config / secrets?** Do **not** commit `.env`, credentials, or machine-specific paths.
- [ ] **OneDrive conflict copies?** Ignore `*_conflict_*` and `~$*` files.
- [ ] **Legacy root `app.js`?** Map changes to `src/runtime/legacy.js`, then `npm run build:web`.

---

## After merge

1. Delete or archive redundant Windows folders once `git status` is clean and tests pass.
2. Point OneDrive backup at the single canonical repo path (or exclude `.git` / `node_modules` from sync).
3. Push your branch: `git push -u origin cursor/combine-three-folders-ab9b`

---

## Quick reference — unified repo commands

```bash
npm run build:web      # bundle src/ → app.js
npm run validate       # build:web + infra tests
npm run compare-zips   # diff historical zip/ archives vs repo
npm run desktop        # Electron
npm run build:windows  # NSIS installer
```

On the Cloud Agent VM, use a login shell for npm: `bash -lc 'npm run validate'`.

---

## Related

- PR #4: [Unify src, desktop, and infra into one modular MechPro program](https://github.com/tinytim3271-wq/mechpro-dispatch/pull/4)
- `docs/AUDIT_UNIFIED_MECHPRO.md` — move + full audit report
- `scripts/merge-windows.ps1` — automated Windows merge
- `AGENTS.md` — Cloud Agent environment notes
- `src/README.md` — frontend module layout
