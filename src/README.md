# MechPro frontend source

The browser and Electron desktop clients share this source tree. `npm run build:web` bundles `src/main.js` into the root `app.js` that `index.html` and the Windows installer load.

## Layout

| Path | Purpose |
| --- | --- |
| `main.js` | Application entry; import new modules here |
| `runtime/legacy.js` | Full MechPro SPA (being split into modules over time) |
| `modules/` | New features and extracted domains (dispatch, shop ops, AI, etc.) |

## Adding a module

1. Create `src/modules/<area>/<feature>.js`.
2. Import it from `src/modules/register.js` or `src/main.js`.
3. Run `npm run build:web` (or `npm run dev:web` while editing).
4. Refresh the browser; hard-reload if the service worker caches an old `app.js`.

Keep modules side-effect free where possible: export `init(state)` or register view/bind handlers instead of relying on global functions.
