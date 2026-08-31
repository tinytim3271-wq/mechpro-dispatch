# AGENTS.md

## Cursor Cloud specific instructions

This repository is one MechPro program with three surfaces:

- **Frontend PWA** (`src/` → bundled `app.js`, plus `index.html`, `styles.css`, `theme.css`, `service-worker.js`, `manifest.webmanifest`, `assets/`) — a vanilla-JS, local-first Progressive Web App for shop dispatch and work orders. Source lives under `src/`; `npm run build:web` bundles `src/main.js` into root `app.js` (committed so static deploys work without a build step). Shared Cognito/API settings live in `src/shared/config.js` (aligned with `infra/cdk-outputs.json`). Platform detection (`src/modules/platform/`) distinguishes browser vs Electron (`window.mechproDesktop` from `desktop/preload.js`). The current UI implementation is in `src/runtime/legacy.js` and is being split into `src/modules/` over time. In a browser it shows the Cognito sign-in screen by default; after sign-in, shop data is hydrated from `localStorage` (`mechpro-dispatch-v1`) and the API when online. Offline-only local dev without Cognito is not supported on current `main` — use the deployed API or Electron desktop for full auth flows.
- **Windows desktop client** (`package.json`, `desktop/`, `windows-installer.nsi`) — Electron wrapper around the same bundled frontend. Root `package.json` provides `npm run build:web`, `npm run dev:web`, `npm run serve`, `npm run validate`, `npm run desktop`, and `npm run build:windows`. The desktop app sets `window.mechproDesktop` via `desktop/preload.js` and requires an internet connection plus an active subscription (`/subscription/entitlement`) before sign-in succeeds.
- **AWS CDK infra** (`infra/`) — a TypeScript CDK app (DynamoDB, Cognito, API Gateway, Lambda, S3). Standard commands are documented in `infra/README.md` and `infra/package.json` (`npm test`, `npm run build`, `npx cdk synth`). Actual `cdk deploy` requires AWS credentials and is out of scope for local dev. Run `npm run validate` from the repo root to bundle the frontend and run infra tests together.

### Toolchain / non-obvious gotchas

- **Node comes from nvm, not the base image.** The base image's `/exec-daemon/node` is first on `PATH` in a non-login shell and is Node 22 **with no `npm`/`npx`**. Run project commands in a **login shell** (`bash -lc '...'`) or `source ~/.nvm/nvm.sh` first: `~/.bashrc` loads nvm and the default alias is Node 24 (matching CI in `.github/workflows/deploy.yml`), which provides `npm`/`npx`.
- **Two separate `package.json` files.** Root `package.json` installs Electron + esbuild (`npm run build:web`); `infra/package.json` installs CDK/Lambda dependencies. Browser-only work can serve the committed `app.js` without `npm ci`, but editing frontend source requires `npm ci` at the repo root and rebuilding. Infra work needs `npm ci` in `infra/`.
- `npm ci` in `infra/` prints `npm warn allow-scripts` and skips postinstall for `@swc/core`, `esbuild`, and `unrs-resolver`. This is harmless — each ships prebuilt platform packages, so tests, `tsc`, and `cdk synth` all work without the postinstalls.
- `npx cdk synth --all` warns `Unknown option(s): --all` on the pinned CDK version but still synthesizes every stack successfully; the flag is simply ignored.

### Running the frontend (browser)

Serve the repo root over HTTP (service worker registration is gated on a secure context, and `localhost`/`127.0.0.1` counts as secure), e.g.:

```
python3 -m http.server 3000 --bind 127.0.0.1   # then open http://127.0.0.1:3000/
```

Edit files under `src/` (and `styles.css` / `theme.css`), then run `npm run build:web` or `npm run dev:web` and refresh the browser. Do not edit root `app.js` directly — it is generated. The service worker caches aggressively; hard-reload or clear the `mechpro-dispatch-v1` service-worker cache if edits don't appear.

### Running the desktop client

From the repo root (after `npm ci`):

```
npm run desktop                  # launch Electron window
npm run desktop -- --smoke-test  # headless smoke test (exit 0/1)
npm run build:windows            # bundle web app + NSIS installer → dist/windows/
```

Electron loads `index.html` from disk (`file://`); subscription verification still calls the live API.

### Consolidating Windows folder copies

If you have multiple local MechPro folders on a Windows PC (`C:\mechpro-dispatch`, `C:\MechPro-work`, hash-named copies, OneDrive backups, or git worktrees under `MechPro.worktrees`), see **`docs/MERGE_WINDOWS_FOLDERS.md`**. Run `node scripts/compare-folders.mjs <path>` on Windows/WSL to diff an external folder against this repo. Those paths are **not** present in the Cloud Agent VM unless uploaded or pushed as a branch.
