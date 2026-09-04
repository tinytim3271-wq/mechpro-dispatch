# Windows Desktop Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable Windows edition of MechPro that runs local UI assets and requires an active online subscription.

**Architecture:** Package the existing static app in a hardened Electron renderer. Authenticate with the existing Cognito user pool, then call a JWT-protected entitlement endpoint backed by the tenant platform record before loading shop data and every five minutes while running.

**Tech Stack:** Electron, electron-builder NSIS, vanilla JavaScript, AWS CDK, API Gateway HTTP API, Lambda, DynamoDB, Cognito.

## Global Constraints

- The Windows app requires internet connectivity for subscription verification.
- Subscription decisions are made server-side from the authenticated tenant account.
- Node integration remains disabled in the renderer.
- Existing browser and PWA behavior remains unchanged.

---

### Task 1: Subscription Entitlement

**Files:** `infra/lambda/subscription/entitlement.ts`, `infra/lib/api-stack.ts`, `infra/test/infra.test.ts`

- [x] Add an authenticated, non-cacheable entitlement endpoint.
- [x] Reject suspended, inactive, past-due, canceled, missing, and expired accounts.
- [x] Test active, trial, suspended, inactive, missing, and expired states.

### Task 2: Windows Desktop Client

**Files:** `desktop/main.js`, `desktop/preload.js`, `package.json`, `app.js`

- [x] Load packaged frontend assets in an isolated Electron renderer.
- [x] Verify entitlement before loading tenant data and every five minutes.
- [x] Configure an x64 NSIS installer with desktop and Start Menu shortcuts.

### Task 3: Release Validation

**Files:** `dist/windows/MechPro-Setup-1.0.0.exe`

- [x] Run Lambda tests and TypeScript compilation.
- [x] Build the Windows installer.
- [x] Launch the unpacked desktop executable and verify the online-subscription login screen.
- [x] Deploy the entitlement API and publish the installer through the production Amplify site.

## Release Evidence

- Download: `https://www.yourcarguy806.com/downloads/MechPro-Setup-1.0.0.exe`
- Installer size: `93,735,579` bytes
- SHA-256: `B602D57762339B0CC611AFB94D60921429114CAD700071A433ACDA48C46C3569`
- Packaged desktop smoke test: exit code `0`
- Infrastructure tests: `17 passed`
- TypeScript compilation: passed
- Amplify production deployment:   `14`, `SUCCEED`