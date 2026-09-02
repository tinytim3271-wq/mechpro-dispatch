# AGENTS.md

## Cursor Cloud specific instructions

This repository has three independent parts:

- **Frontend PWA** (repo root: `index.html`, `app.js`, `styles.css`, `service-worker.js`, `assets/`) — a vanilla-JS, local-first Progressive Web App for shop dispatch and work orders. It is still served as static files and boots straight into the dispatch board using seed data persisted in `localStorage` (`mechpro-dispatch-v1`) with an admin user already signed in. The Cognito/API integration is optional and fails gracefully offline.
- **Web/packaging source** (`src/`, root `package.json`, `scripts/`) — edit source under `src/`, then run `npm run build:web` to refresh the committed root `app.js`. `npm run sync` also copies the offline shell into `www/` for the Capacitor Android wrapper in `android/`.
- **AWS CDK infra** (`infra/`) — a TypeScript CDK app (DynamoDB, Cognito, API Gateway, Lambda, S3). Standard commands are documented in `infra/README.md` and `infra/package.json` (`npm test`, `npm run build`, `npx cdk synth`). Actual `cdk deploy` requires AWS credentials and is out of scope for local dev.

### Toolchain / non-obvious gotchas

- **Node comes from nvm, not the base image.** The base image's `/exec-daemon/node` is first on `PATH` in a non-login shell and is Node 22 **with no `npm`/`npx`**. Run project commands in a **login shell** (`bash -lc '...'`) or `source ~/.nvm/nvm.sh` first: `~/.bashrc` loads nvm and the default alias is Node 24 (matching CI in `.github/workflows/deploy.yml`), which provides `npm`/`npx`.
- `npm ci` in `infra/` prints `npm warn allow-scripts` and skips postinstall for `@swc/core`, `esbuild`, and `unrs-resolver`. This is harmless — each ships prebuilt platform packages, so tests, `tsc`, and `cdk synth` all work without the postinstalls.
- `npx cdk synth --all` warns `Unknown option(s): --all` on the pinned CDK version but still synthesizes every stack successfully; the flag is simply ignored.

### Running the frontend

Serve the repo root over HTTP (service worker registration is gated on a secure context, and `localhost`/`127.0.0.1` counts as secure), e.g.:

```
python3 -m http.server 3000 --bind 127.0.0.1   # then open http://127.0.0.1:3000/
```

Serving the root still only requires a browser refresh. When editing source under `src/`, run `npm run build:web` first. The service worker caches aggressively; hard-reload or clear the `mechpro-dispatch-v1` service-worker cache if edits don't appear.

### OEM Diagnostics (J2534 / Windows)

- **J2534 native host** lives in `diagnostics/j2534-service/`. Build with .NET 8: `./diagnostics/j2534-service/scripts/publish-win-x64.sh` (or `publish-win-x64.ps1` on Windows). Output: `diagnostics/j2534-service/publish/win-x64/J2534.Host.exe`.
- **Windows installer** bundles that exe via `npm run build:windows` (runs J2534 publish then `electron-builder`). Requires Windows for the final NSIS installer; CI workflow `.github/workflows/windows-desktop.yml` builds on `windows-latest`.
- On Windows with a registered J2534 adapter, Electron prefers `J2534.Host.exe` over the Node simulator (`desktop/diagnostics-bridge.js`).
- **AWS diagnostics API** (`/diagnostics/coverage`, `/diagnostics/audit`, `/diagnostics/authorize`) deploys with `cdk deploy` from `infra/` when merged to `main`.
