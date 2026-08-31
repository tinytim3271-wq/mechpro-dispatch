# AGENTS.md

## Cursor Cloud specific instructions

This repository has three independent parts:

- **Frontend PWA** (repo root: `index.html`, `app.js`, `styles.css`, `theme.css`, `service-worker.js`, `manifest.webmanifest`, `assets/`) — a vanilla-JS, local-first Progressive Web App for shop dispatch and work orders. The PWA itself has **no bundler or compile step**; it is served as static files. In a browser it boots straight into the dispatch board using seed data persisted in `localStorage` (`mechpro-dispatch-v1`) with an admin user already signed in, so no login is required for local web development. The Cognito/API integration (`cognitoConfig` in `app.js`) is optional and fails gracefully offline.
- **Windows desktop client** (`package.json`, `desktop/`, `windows-installer.nsi`) — an Electron wrapper around the same static frontend. Root `package.json` is only for desktop packaging (`electron`, `electron-builder`); it is **not** required to run or edit the PWA in a browser. The desktop app sets `window.mechproDesktop` via `desktop/preload.js` and requires an internet connection plus an active subscription (`/subscription/entitlement`) before sign-in succeeds. Use `npm run desktop` to launch locally and `npm run build:windows` to produce an NSIS installer under `dist/windows/`.
- **AWS CDK infra** (`infra/`) — a TypeScript CDK app (DynamoDB, Cognito, API Gateway, Lambda, S3). Standard commands are documented in `infra/README.md` and `infra/package.json` (`npm test`, `npm run build`, `npx cdk synth`). Actual `cdk deploy` requires AWS credentials and is out of scope for local dev.

### Toolchain / non-obvious gotchas

- **Node comes from nvm, not the base image.** The base image's `/exec-daemon/node` is first on `PATH` in a non-login shell and is Node 22 **with no `npm`/`npx`**. Run project commands in a **login shell** (`bash -lc '...'`) or `source ~/.nvm/nvm.sh` first: `~/.bashrc` loads nvm and the default alias is Node 24 (matching CI in `.github/workflows/deploy.yml`), which provides `npm`/`npx`.
- **Two separate `package.json` files.** Root `package.json` installs Electron desktop tooling; `infra/package.json` installs CDK/Lambda dependencies. Browser-only PWA work needs neither. Desktop work needs `npm ci` at the repo root; infra work needs `npm ci` in `infra/`.
- `npm ci` in `infra/` prints `npm warn allow-scripts` and skips postinstall for `@swc/core`, `esbuild`, and `unrs-resolver`. This is harmless — each ships prebuilt platform packages, so tests, `tsc`, and `cdk synth` all work without the postinstalls.
- `npx cdk synth --all` warns `Unknown option(s): --all` on the pinned CDK version but still synthesizes every stack successfully; the flag is simply ignored.

### Running the frontend (browser)

Serve the repo root over HTTP (service worker registration is gated on a secure context, and `localhost`/`127.0.0.1` counts as secure), e.g.:

```
python3 -m http.server 3000 --bind 127.0.0.1   # then open http://127.0.0.1:3000/
```

Editing `app.js`/`styles.css`/`theme.css` only requires a browser refresh (no bundler/HMR). The service worker caches aggressively; hard-reload or clear the `mechpro-dispatch-v1` service-worker cache if edits don't appear.

### Running the desktop client

From the repo root (after `npm ci`):

```
npm run desktop                  # launch Electron window
npm run desktop -- --smoke-test  # headless smoke test (exit 0/1)
npm run build:windows            # NSIS installer → dist/windows/
```

Electron loads `index.html` from disk (`file://`); subscription verification still calls the live API.
