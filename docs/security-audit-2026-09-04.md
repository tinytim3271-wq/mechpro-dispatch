# MechPro Dispatch — Full Security Audit

**Date:** 2026-09-04  
**Scope:** Frontend PWA (`src/`, `index.html`, `service-worker.js`, `diagnostics-ui.js`), Electron desktop (`desktop/`), AWS CDK + Lambda (`infra/`), dependency advisories (`npm audit`).  
**Method:** Manual code review of auth, multi-tenant isolation, payments, webhooks, XSS sinks, Electron IPC, and IAM; plus root/infra `npm audit`.  
**Aikido MCP:** Unavailable during this run (live tool discovery failed). Findings below are from direct review.

---

## Executive summary

The cloud API is generally well structured: Cognito JWT authorizer on business routes, `shopId`/`role` taken from claims (not request bodies), Stripe webhook HMAC verification, and tenant-prefixed DynamoDB keys. The highest residual risks were **client-side privilege signals**, **XSS in core dispatch templates**, **CORS `*`**, **Stripe payment rows forgeable via entity CRUD**, and an **admin password-reset gap** for platform owners.

This branch remediates the critical/high items listed under **Remediated in this PR**. Remaining medium/low items are tracked under **Open follow-ups**.

| Severity | Reviewed | Fixed here | Open |
|----------|----------|------------|------|
| Critical | 2 | 2 | 0 |
| High | 8 | 6 | 2 |
| Medium | 12 | 3 | 9 |
| Low / Info | 10+ | 1 | rest |

---

## Remediated in this PR

1. **Cognito SPA cannot write `custom:role` / `custom:shopId`** — `writeAttributes` limited to standard profile fields (`infra/lib/auth-stack.ts`).
2. **API role resolution prefers Cognito groups** with an allowlist (`infra/lambda/common/auth.ts` `resolveRole`).
3. **`resetPassword` blocks `super_admin` targets** (aligned with `setPassword`) (`infra/lambda/admin/accounts.ts`).
4. **Client payment writes cannot mint Stripe-completed rows** — `sanitizeClientPaymentWrite` forces Stripe/`cs_`/`pi_` IDs to `pending` (`infra/lambda/entities/handler.ts`).
5. **Presign Lambdas get `TABLE_NAME`** so suspension checks work; diagnostics coverage/auth get DynamoDB `GetItem` (`infra/lib/api-stack.ts`).
6. **Upload MIME allowlist** (PDF + common images only) (`infra/lambda/files/presign.ts`).
7. **API + S3 CORS** restricted to production + local origins (no `*`) (`api-stack.ts`, `data-stack.ts`).
8. **Core dispatch/customer/employee/open-order HTML escaped**; badge/priority classes allowlisted (`src/runtime/legacy.js`).
9. **CSP meta** on `index.html` (connect-src limited to Cognito, API, S3).
10. **Electron `file:` navigation** limited to the app package; `openExternal` HTTPS-only to trusted origins (`desktop/main.js`).
11. **Electron bumped** to `^41.10.3` for GHSA-9f4c-93c8-jc8g.

---

## Open follow-ups (not fixed here)

### High

| ID | Finding | Recommendation |
|----|---------|----------------|
| H-A | AgentPhone webhook tools can book appointments and create Stripe payment links after HMAC verify | Require staff confirmation / disable payment-link tool from voice; sanitize history |
| H-B | Auth tokens (incl. refresh) persist in `localStorage`; UI role still partly driven by local employee records | Prefer memory/`sessionStorage` or BFF cookies; drive UI RBAC from verified JWT claims after `/subscription/entitlement` |

### Medium

| ID | Finding | Recommendation |
|----|---------|----------------|
| M-A | Broad Secrets Manager `mechpro/*` read/write on several roles | Scope per-function secret name patterns |
| M-B | Tax/payroll/settings/AI readable or writable by overly broad roles | Tighten `requireRole` matrices |
| M-C | Assistant trusts client-supplied chat history | Server-side conversation store |
| M-D | Stripe webhook secret-missing can 500; concurrent sessions can overpay | Catch SM errors → 400; conditional invoice versioning |
| M-E | Cognito still allows `USER_PASSWORD_AUTH`; MFA optional | Prefer SRP-only + MFA for admins |
| M-F | Static site stack can serve public HTTP S3 website | Prefer CDN stack (HTTPS + OAC + WAF) |
| M-G | WAF not attached to HTTP API | Front API with CloudFront + WAF |
| M-H | Service worker cache-first for non-shell GETs | Explicit shell allowlist only |
| M-I | Messaging endpoint URL not allowlisted client-side | Proxy via authenticated API |

### Dependency advisories (root `npm audit`)

| Package | Severity | Notes |
|---------|----------|-------|
| `electron` | High | Addressed by bump to `^41.10.3` (re-run `npm install` / lockfile update in CI) |
| `fast-uri` | High | Transitive; `npm audit fix` when lockfile refreshed |
| `@xmldom/xmldom` | Moderate | Transitive via electron-builder tooling |

`infra/` `npm audit`: **0** vulnerabilities.

---

## Positive controls observed

- JWT authorizer on business API routes; webhooks are HMAC-gated.
- Tenant `pk = SHOP#${shopId}` forced server-side for entities.
- `custom:shopId` immutable; self-signup disabled; strong password policy.
- Stripe signature verify uses timestamp skew + `timingSafeEqual`.
- Checkout success/cancel URL origin check (`safeCheckoutUrl`).
- Admin API gated to `super_admin`.
- Files download key prefix check; private S3 bucket with SSL enforced.
- Electron: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`.
- No `eval` / `new Function` in first-party frontend sources reviewed.

---

## Test evidence

- Unit tests added for `sanitizeClientPaymentWrite` and `resolveRole`.
- Run: `npm --prefix infra test -- --runInBand` and `npm run build:web` after changes.
