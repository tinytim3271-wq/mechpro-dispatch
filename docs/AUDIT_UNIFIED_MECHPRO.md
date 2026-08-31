# MechPro unified program — full audit (2026-08-31)

Branch: `cursor/combine-three-folders-ab9b` · PR: https://github.com/tinytim3271-wq/mechpro-dispatch/pull/4

## Part 1 — Move status

### What was moved (in-repo / already on this branch)

| Surface | Location | Status |
| --- | --- | --- |
| Frontend source of truth | `src/main.js` → `src/runtime/legacy.js` + modules | Unified; `npm run build:web` emits root `app.js` |
| Desktop | `desktop/main.js`, `desktop/preload.js` | Electron shell wired |
| Backend | `infra/` | CDK stacks + Lambda |
| Merge tooling | `scripts/merge-windows.ps1`, `compare-folders.mjs`, `compare-zips.mjs` | Ready for Windows PC |
| Docs | `docs/MERGE_WINDOWS_FOLDERS.md`, `AGENTS.md`, `src/README.md` | Describe single program |

### What could **not** be moved from this Cloud Agent VM

| Source | Blocker |
| --- | --- |
| `C:\MechPro-work` | Not present on Linux VM (no mount / upload) |
| `C:\mechpro-dispatch` (local Windows clone deltas) | Same |
| `C:\MechPro-dcdaf6e` | Same |
| `C:\Users\secon\OneDrive\Documents\MechPro-Lees_computer` | Same |
| `C:\Users\secon\Downloads\MechPro.worktrees` | Same |

**Required next step on Windows:** pull this branch and run `.\scripts\merge-windows.ps1 -DryRun` then `-Commit`.

### Zip archives

`npm run compare-zips` confirmed both `zip/mechpro-dispatch.zip` and `zip/mechpro-dispatch-v15.zip` are legacy root-`app.js` PWA bundles. Repo `src/runtime/legacy.js` is larger/newer; **no zip-only features to import**.

---

## Part 2 — Audit checklist

| Area | Result | Evidence |
| --- | --- | --- |
| Structure (`src/`, `desktop/`, `infra/`, `scripts/`, `docs/`) | PASS | Layout present; entry `src/main.js`; Electron `desktop/main.js`; CDK under `infra/` |
| `npm run build:web` | PASS | Emits `app.js` (~347kb) with GENERATED banner |
| Root `validate:infra` / Jest | PASS | 19/19 tests |
| `infra` `tsc` build | PASS | Exit 0 |
| `npx cdk synth` | PASS | All four stacks synthesized to `infra/cdk.out` |
| Secrets / `.env` in tree | PASS | No `.env` files; Cognito client IDs are public SPA config |
| Config alignment | PASS | `src/shared/config.js` matches `infra/cdk-outputs.json` (pool, client, API URL) |
| Platform detection | PASS | `src/modules/platform` + `desktop/preload.js` → `window.mechproDesktop` |
| AGENTS.md accuracy | PASS | Documents modular `src/`, Cognito login, Electron, toolchain |
| Windows live merge | BLOCKED | Paths unreachable from VM |
| Aikido SAST | SKIPPED | MCP requires user sign-in (`aikido_login`); no `.env`/private keys found by manual scan |
| Electron `--smoke-test` | PASS | `smokeTest: passed`, desktop bridge + login panel |

### Gaps / risks (non-blocking unless noted)

1. **Windows folders not merged here** — only blocker for completing the physical multi-folder consolidate.
2. **Auth required for browser UI** — Cognito sign-in; offline seed-admin bypass is not available on current code (per AGENTS.md).
3. **Monolithic SPA** — most UI still in `src/runtime/legacy.js`; modular split is incomplete by design.
4. **Dead `assets/index-*.js|css`** — old Vite/React bundle not referenced by `index.html` (historical; packaged by electron-builder via `assets/**/*`).
5. **`index.html` contains `data-pplx-inline-edit` Perplexity iframe helper** — present on `main` as well; third-party parent-origin allowlist; consider stripping for production cleanliness.
6. **Root `npm run validate` nesting** — fixed to use `npm --prefix infra` so Cloud Agent / nested shells work without `npm_config_prefix` breakage.

### Recommended next actions

1. On the Windows PC: `git pull` this branch → `.\scripts\merge-windows.ps1 -DryRun` → `-Commit` → push.
2. Optionally remove unused Vite assets and the Perplexity inline script from `index.html`.
3. Continue splitting `src/runtime/legacy.js` into `src/modules/`.
4. Merge PR #4 when Windows merge dry-run shows no unique files (or after importing any that appear).
