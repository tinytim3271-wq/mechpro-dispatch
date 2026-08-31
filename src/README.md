# MechPro frontend source

The browser PWA, Electron desktop client, and AWS backend share one program:

| Surface | Path | Role |
| --- | --- | --- |
| Web PWA | `src/` → bundled `app.js` | Shop dispatch UI served over HTTP |
| Desktop | `desktop/` + root `package.json` | Electron shell; sets `window.mechproDesktop` |
| Backend | `infra/` | Cognito, API Gateway, Lambda, DynamoDB |

`npm run build:web` bundles `src/main.js` into root `app.js` that `index.html`, the service worker, and the Windows installer all load.

## Layout

| Path | Purpose |
| --- | --- |
| `main.js` | Unified entry: platform modules → legacy SPA → bootstrap |
| `shared/config.js` | Cognito + API URLs (matches `infra/cdk-outputs.json`) |
| `modules/platform/` | Web vs desktop detection (`window.mechproDesktop`) |
| `runtime/legacy.js` | Full MechPro SPA (being split into modules over time) |
| `modules/register.js` | Wire new feature modules here |

## Adding a module

1. Create `src/modules/<area>/<feature>.js`.
2. Import it from `src/modules/register.js`.
3. Run `npm run build:web` (or `npm run dev:web` while editing).
4. Refresh the browser; hard-reload if the service worker caches an old `app.js`.

Keep modules side-effect free where possible: export `init(state)` or register view/bind handlers instead of relying on global functions.

## Local commands

```
npm run build:web    # bundle src/ → app.js
npm run dev:web      # watch rebuild
npm run serve        # static server at http://127.0.0.1:3000/
npm run validate     # build:web + infra tests
npm run desktop      # Electron window
```
