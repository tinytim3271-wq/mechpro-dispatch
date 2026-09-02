# MechPro Dispatch — Unified Shop Management Platform

> **Production-quality, local-first PWA** for automotive shop dispatch, work orders,
> scheduling, payroll, diagnostics, and more — running entirely in the browser with
> optional AWS/cloud back-ends.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Feature Map](#feature-map)
3. [Architecture](#architecture)
4. [Repository Merge Summary](#repository-merge-summary)
5. [Configuration & Environment](#configuration--environment)
6. [AWS Infrastructure](#aws-infrastructure)
7. [OEM Diagnostics (J2534)](#oem-diagnostics-j2534)
8. [Voice Intake Service](#voice-intake-service)
9. [Desktop App (Windows)](#desktop-app-windows)
10. [Development Notes](#development-notes)
11. [Testing](#testing)
12. [Follow-up Items](#follow-up-items)

---

## Quick Start

Serve the repo root over HTTP:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
# then open http://127.0.0.1:3000/
```

The app boots directly into the dispatch board using seed data persisted in
`localStorage` (`mechpro-dispatch-v1`). An admin user is already signed in —
no login required for local development.

> **Service worker note:** registration is gated on a secure context.
> `localhost` / `127.0.0.1` count as secure so the above command is sufficient.
> Hard-reload or clear the cache in DevTools → Application → Cache Storage if
> edits don't appear after a page refresh.

---

## Feature Map

| Feature | Status | Source repo |
|---|---|---|
| Dispatch board (Kanban + list) | ✅ Production | mechpro-dispatch |
| Work orders / repair orders | ✅ Production | mechpro-dispatch |
| Scheduling & appointments | ✅ Production | mechpro-dispatch |
| Customer & vehicle records | ✅ Production | mechpro-dispatch |
| Invoicing & checkout | ✅ Production | mechpro-dispatch |
| Accounting (expenses, revenue) | ✅ Production | mechpro-dispatch |
| Payroll (W-2/1099, timeclock) | ✅ Production | mechpro-dispatch |
| Inventory & purchase orders | ✅ Production | mechpro-dispatch |
| Tax reporting | ✅ Production | mechpro-dispatch |
| Team chat / messaging | ✅ Production | mechpro-dispatch |
| AI workbench (estimates, diagnostics, guides) | ✅ Production | mechpro-dispatch |
| AI phone / voice intake form | ✅ Production | mechpro-dispatch |
| Reminders & notifications | ✅ Production | mechpro-dispatch |
| Shop settings & multi-tech profiles | ✅ Production | mechpro-dispatch |
| Dark mode | ✅ Production | mechpro-dispatch |
| Progressive Web App (offline-capable) | ✅ Production | mechpro-dispatch |
| AWS CDK infrastructure (DynamoDB, Cognito, API GW, Lambda, S3) | ✅ Production | mechpro-dispatch + MechPro |
| Wave 1 legacy API compatibility | ✅ Production | mechpro-dispatch (docs/merge-wave-1.md) |
| J2534 OEM diagnostics (Windows) | ✅ Production | mechpro-dispatch |
| Desktop installer (Electron / NSIS) | ✅ Production | mechpro-dispatch |
| **Voice intake micro-service** | ✅ New (Wave 2) | **Reliable-Voice-** |

### Deferred / Out of Scope

| Item | Reason |
|---|---|
| React/Vite frontend from MechPro | Different framework (React + Tailwind); would require full build pipeline. Core dispatch functionality already present in vanilla-JS app. Payroll/OBD logic is already reflected in infra contracts. |
| PGlite embedded DB (reliable-shop-standalone) | Target app is local-first via localStorage/DynamoDB single-table. Embedding WASM Postgres would duplicate storage and add complexity without benefit for current users. |
| Drizzle migrations (reliable-shop-standalone) | DynamoDB + CDK handles schema evolution. |
| Electron wrapper from reliable-shop-standalone | Existing `desktop/` Electron + NSIS setup in mechpro-dispatch is more mature. |
| reliable-shop-management CLI / Phase 3 tests | Node CLI test harness targets a different package; not applicable to browser-first PWA. |
| reliable-shop-management1 | Repository returned 404 — does not exist. |
| MechPro-aws | Repository returned 404 — contents previously merged into MechPro/aws/ and incorporated via Wave 1 contracts. |

---

## Architecture

```
mechpro-dispatch/
├── index.html              # Single-page app shell (PWA entry point)
├── app.js                  # Committed browser bundle generated from src/
├── styles.css              # Component styles (minified, ~49 KB)
├── theme.css               # Visual token overrides, dark mode (minified, ~16 KB)
├── diagnostics-ui.js       # OBD / J2534 diagnostics panel UI
├── service-worker.js       # Offline cache + background sync
├── manifest.webmanifest    # PWA manifest
│
├── src/                    # Source tree for the committed app.js bundle
├── android/                # Capacitor Android wrapper project
├── diagnostics/
│   ├── j2534-service/      # .NET 8 J2534 native host (Windows)
│   │   └── publish/win-x64/J2534.Host.exe
│   └── voice-service/      # Python voice intake micro-service (NEW Wave 2)
│       ├── voice_service.py
│       ├── README.md
│       └── tests/
│           └── test_voice_service.py
│
├── desktop/                # Electron main process
│   └── diagnostics-bridge.js
│
├── infra/                  # AWS CDK (TypeScript)
│   ├── lib/                # CDK stacks (API, auth, storage, AI, monitoring)
│   ├── lambda/             # Lambda handlers (entities, admin, AI, payments, files)
│   ├── contracts/          # Wave 1 type contracts (legacy API compat)
│   └── test/               # Jest unit tests
│
├── assets/                 # Static images, icons
├── docs/                   # Integration notes, merge docs, architecture plans
└── scripts/                # Build helpers
```

### Data Flow

```
Browser (PWA)
    │
    ├─ localStorage (mechpro-dispatch-v1)  ← primary offline store
    │
    └─ API (optional, Cognito-authenticated)
         │
         ├─ API Gateway  →  Lambda  →  DynamoDB (single-table)
         ├─ Lambda  →  S3 (file storage)
         ├─ Lambda  →  Bedrock (AI)
         └─ Lambda  →  Cognito (auth)

Voice Intake (optional sidecar)
    PSTN / SIP → call_transcript → POST /intake-call
                                       │
                                       └─ voice_service.py → WO JSON → import into app
```

---

## Repository Merge Summary

### Wave 1 (previous)

Merged infrastructure and API compatibility layers from `MechPro` and `MechPro-aws`
(see `docs/merge-wave-1.md` for the full decision log).

### Wave 2 (this PR)

| Change | Detail |
|---|---|
| **Fix: duplicate `app.js` script tag** | `index.html` was loading `app.js` twice, causing every function and event listener to execute twice. Removed the duplicate `<script>` tag. |
| **Fix: remove injected Perplexity editor script** | A `data-pplx-inline-edit` inline script (screenshot utility for the Perplexity.ai web editor) was accidentally committed into `index.html`. Removed — it has no place in production source code. |
| **New: Voice Intake Service** | Ported `diagnostics/voice-service/voice_service.py` from `tinytim3271-wq/Reliable-Voice-`. Converts call transcripts to structured MechPro work orders via `POST /intake-call`. Extended symptom rules (added check-engine, transmission, A/C/heat pathways). Added `GET /healthz` for liveness probes. Added 20 unit tests (all passing). |
| **Docs: unified README** | This file — feature map, architecture diagram, run instructions, merge notes. |

### Source Repositories Assessed

| Repo | Status | What was used |
|---|---|---|
| `tinytim3271-wq/mechpro-dispatch` | ✅ Base / target | Entire existing codebase |
| `tinytim3271-wq/MechPro` | ✅ Incorporated | Wave 1 infra contracts, env alias patterns, architecture reference |
| `tinytim3271-wq/MechPro-aws` | ❌ 404 | Not accessible; functionality covered by Wave 1 |
| `tinytim3271-wq/reliable-shop-management` | ⚠️ Assessed only | TypeScript CLI package — not applicable to browser PWA |
| `tinytim3271-wq/reliable-shop-management1` | ❌ 404 | Repository does not exist |
| `tinytim3271-wq/reliable-shop-standalone` | ⚠️ Assessed only | Standalone Electron/PGlite; architecture incompatible with DynamoDB target |
| `tinytim3271-wq/Reliable-Voice-` | ✅ Ported | `voice_service.py` → `diagnostics/voice-service/` |

---

## Configuration & Environment

Copy `infra/.env.example` (or `infra/lambda/common/runtime-env.ts`) to configure:

| Variable | Purpose |
|---|---|
| `SHOP_TABLE` | DynamoDB single-table name |
| `COGNITO_USER_POOL_ID` | Cognito user pool for JWT validation |
| `COGNITO_CLIENT_ID` | Cognito app client |
| `S3_BUCKET` | File upload / inspection photo storage |
| `STRIPE_SECRET_KEY` | Stripe payments (optional) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature validation |
| `AGENTPHONE_WEBHOOK_SECRET` | AI phone webhook HMAC secret |
| `BEDROCK_REGION` | AWS region for Bedrock AI calls |

The frontend bundle reads Cognito config from the app runtime and fails
gracefully offline if AWS is not configured.

---

## AWS Infrastructure

```bash
cd infra
npm ci
npm run build          # TypeScript compile
npm test               # Jest unit tests (28 tests)
npx cdk synth --all    # Synthesize CloudFormation templates
npx cdk deploy --all   # Deploy (requires AWS credentials)
```

CDK stacks: `MechProDataStack`, `MechProAuthStack`, `MechProApiStack`,
`MechProStaticSiteStack`, `MechProCdnStack` (when `enableCustomDomain=true`),
`MechProGitHubActionsStack` (when `githubRepository` context is set). Monitoring
alarms live inside `MechProApiStack`.

---

## OEM Diagnostics (J2534)

Windows only. Requires a registered J2534 adapter.

```powershell
# Build the .NET 8 native host
./diagnostics/j2534-service/scripts/publish-win-x64.ps1
# Output: diagnostics/j2534-service/publish/win-x64/J2534.Host.exe
```

On Windows the Electron desktop app auto-detects `J2534.Host.exe` and prefers
it over the Node simulator in `desktop/diagnostics-bridge.js`.

---

## Voice Intake Service

Converts inbound call transcripts into structured work orders. Zero dependencies,
pure Python stdlib.

```bash
python3 diagnostics/voice-service/voice_service.py
# Listening on http://127.0.0.1:8080

# Example call
curl -X POST http://127.0.0.1:8080/intake-call \
  -H 'Content-Type: application/json' \
  -d '{"call_transcript":"car won'\''t start, just clicking","customer_name":"Jane Smith","phone":"806-555-0100","vehicle":"2019 Ford F-150"}'
```

See [`diagnostics/voice-service/README.md`](diagnostics/voice-service/README.md)
for the full API reference.

---

## Desktop App (Windows)

```bash
npm run build:windows
# Runs J2534 publish then electron-builder → NSIS installer
# Output: releases/<version>/MechPro-Setup-<version>.exe
```

Requires Windows for the final NSIS packaging step. CI: `.github/workflows/windows-desktop.yml`.

---

## Android App (Capacitor)

```bash
npm install
npm run sync
npm run open:android
```

`npm run sync` rebuilds `app.js`, copies the offline web shell into `www/`, and
syncs the Android project under `android/`.

See [`BUILD_ANDROID.md`](BUILD_ANDROID.md) for APK build details.

---

## Deployment troubleshooting

### GitHub Actions OIDC (`sts:AssumeRoleWithWebIdentity` denied)

If `deploy` or `publish-download` fails with **Not authorized to perform
sts:AssumeRoleWithWebIdentity**, the IAM role trust policy does not match this
repository. Re-deploy the GitHub Actions stack or widen trust with admin AWS
credentials:

```bash
GITHUB_REPOSITORY=OWNER/REPO ./infra/scripts/bootstrap-github-oidc-trust.sh
```

Or redeploy from `infra/`:

```bash
npx cdk deploy MechProGitHubActionsStack --require-approval never \
  -c githubRepository=OWNER/REPO
```

The role trusts `repo:OWNER/REPO:ref:refs/heads/main` and
`repo:OWNER/REPO:environment:production`. See `infra/README.md` for details.

---

## Development Notes

- **Static runtime, optional source build** — serving the repo root still works
  with no bundler in the browser, but source edits now live under `src/`; run
  `npm run build:web` (or `npm run sync` for Android) after changing `src/`.
- **Node via nvm** — the repo ships a `.nvmrc`. Run `nvm use` before any `npm`
  commands, or prefix with `bash -lc '...'` to source nvm.
- **Service worker caches aggressively** — use DevTools → Application →
  Service Workers → "Bypass for network" during development, or hard-reload
  (`Ctrl+Shift+R`).
- **Seed data** — first boot populates `localStorage` with sample orders, customers,
  and vehicles so all views render immediately. Clear it via **Settings → Reset shop
  data** to start fresh.

---

## Testing

### Infra (TypeScript/Jest)

```bash
bash -lc 'cd infra && npm test'
# 28 tests, ~2 s
```

### Voice service (Python/unittest)

```bash
python3 -m unittest discover -s diagnostics/voice-service/tests -v
# 20 tests, ~0.002 s
```

### CDK synthesis smoke test

```bash
bash -lc 'cd infra && npx cdk synth --all'
```

---

## Follow-up Items

| Item | Priority | Notes |
|---|---|---|
| Hook voice service output into app import flow | Medium | POST to `/api/orders` with `source:"voice-intake"` payload to create WO automatically |
| Customer self-service booking page | Medium | reliable-shop-standalone's `book.html` UI pattern is a good reference; adapt to MechPro styles |
| Payroll module UI from MechPro (React) | Low | Logic is already in infra/lambda; a TS payroll calc utility could be extracted without pulling in the full React app |
| OBD live data viewer | Low | MechPro has a richer OBD bay UI — extracting adapters into `diagnostics/` is feasible |
| Wave 3 migration guide | Low | When/if moving from localStorage to DynamoDB for all users |
