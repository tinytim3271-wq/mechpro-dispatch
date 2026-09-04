# Tekmetric Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a verified, tenant-safe shop-management workflow covering the requested Tekmetric-style operations while clearly gating commercial integrations that require provider contracts.

**Architecture:** Keep Cognito and API Gateway as the identity boundary and DynamoDB partitioned by `SHOP#<shopId>`. Move financial, inventory, approval, and cross-shop behavior out of generic browser-authored documents into purpose-specific Lambda operations with conditional writes and audit records. The existing vanilla SPA remains the client, but new large feature areas should be isolated into focused JavaScript modules when the build pipeline can load them safely.

**Tech Stack:** Vanilla JavaScript PWA, AWS Cognito, API Gateway HTTP API, Lambda Node.js 24, DynamoDB, S3, Stripe Checkout, AWS CDK v2 TypeScript, Jest.

## Global Constraints

- A feature is complete only when its UI is reachable, its controls are bound, records persist across sessions, authorization is server-enforced, and an executable test covers the critical path.
- Every tenant-owned DynamoDB operation derives `shopId` from authenticated claims or verified provider metadata, never from an untrusted request body.
- Financial events and inventory movements use idempotency keys and conditional writes.
- Commercial integrations remain disabled until the shop has valid server-side credentials and the provider contract permits production use.
- Never store payment card data, provider secrets, or Cognito tokens in local storage or DynamoDB entity documents.
- Preserve the current Device, Light, and Dark appearance modes and responsive phone/tablet/desktop behavior.

---

## Coverage Snapshot

| Area | Current state | Remaining release work |
|---|---|---|
| Customers, vehicles, VIN, service history | Working, customer editing partial | Stable customer IDs, merge protection, communication timeline |
| Estimates and canned services | Working | Public tokenized approve/decline experience and immutable decision audit |
| Digital inspections | Working, employee-side approval | Map findings to estimate jobs and add customer-facing report approval |
| Dispatch, technician clocks, payroll | Working core | RO labels, change audit, filtered exports, server-authoritative payroll |
| RO to invoice | Repaired in current change | Integration test and transactional server endpoint |
| Payments | Contract/IAM/balance/replay repaired in current change | Stripe integration test, refunds, voids, disputes, receipts, deposits |
| Inventory, vendors, purchasing | Working core | Matrices/catalogs, cores, returns, tire fields, atomic stock ledger |
| Scheduling and reminders | Working core | Public booking, capacity rules, confirmations, no-show workflow |
| Marketing and reviews | Missing | Segments, consent, campaigns, review requests, delivery metrics |
| Multi-shop | Tenant isolation exists | Shop groups, switcher, consolidated reporting, scoped permissions |
| Reporting/accounting | Basic reporting works | Saved reports, drill-down, accounting export and reconciliation |
| OBD-II | Working basic ELM327 flow | Keep limitations explicit; no OEM/bidirectional claims |
| CarFax, plate, catalogs, accounting sync | Provider-gated | Adapter contracts, secrets, health checks, disabled-until-configured UI |

## File Structure

- `app.js`: retain route composition and existing UI until feature modules can be introduced without changing hosting.
- `infra/lambda/workflow/complete-order.ts`: atomically create an invoice and transition an RO.
- `infra/lambda/approvals/handler.ts`: issue expiring customer tokens and record estimate/inspection decisions.
- `infra/lambda/inventory/movements.ts`: receive, commit, return, core, and adjustment operations.
- `infra/lambda/payments/checkout.ts`: calculate authoritative open balance and create Stripe Checkout sessions.
- `infra/lambda/payments/webhook.ts`: verify and idempotently settle Stripe events.
- `infra/lambda/reporting/handler.ts`: paginated operational and consolidated shop reports.
- `infra/lambda/integrations/`: one adapter per commercial provider.
- `infra/lib/api-stack.ts`: routes, IAM, throttling, and Lambda bindings.
- `infra/test/`: unit, handler, authorization, and synthesized-template tests.

### Task 1: Finish Financial Lifecycle Foundation

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/workflow/complete-order.ts`
- Modify: `infra/lambda/payments/checkout.ts`
- Modify: `infra/lambda/payments/webhook.ts`
- Modify: `infra/lambda/entities/handler.ts`
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: authenticated `shopId`, RO ID, persisted invoice/payment records.
- Produces: `POST /orders/{id}/complete -> { order, invoice }` and idempotent `PAYMENT#<stripeSessionId>` records.

- [x] **Step 1: Add tests for remaining balance, redirect origin, and Stripe signature age**
- [x] **Step 2: Align the SPA with `POST /payments/checkout-session` and send `invoiceNumber`**
- [x] **Step 3: Grant webhook `GetItem`, `Query`, and `PutItem` access and reject invalid settlements**
- [x] **Step 4: Create an invoice before persisting a completed/invoiced RO and prevent duplicate local invoices by RO ID**
- [x] **Step 5: Restrict generic financial writes by role**
- [ ] **Step 6: Replace client orchestration with `complete-order.ts` using `TransactWriteCommand`**

The transaction must conditionally put `INVOICE#<number>`, update `ORDER#<id>` from an allowed pre-completion status, and write `AUDIT#<timestamp>#<id>`. Return the existing invoice when the same RO is retried.

- [ ] **Step 7: Add handler tests for duplicate completion, partial payment, replay, wrong tenant, wrong currency, and overpayment**
- [ ] **Step 8: Run validation**

```powershell
node --check .\app.js
node .\infra\node_modules\typescript\bin\tsc -p .\infra\tsconfig.json --noEmit
node .\infra\node_modules\jest\bin\jest.js --config .\infra\jest.config.js --runInBand
```

Expected: JavaScript exits 0, TypeScript exits 0, and every Jest test passes.

### Task 2: Add Server-Enforced Authorization and Audit

**Files:**
- Modify: `infra/lib/auth-stack.ts`
- Modify: `infra/lambda/common/auth.ts`
- Modify: `infra/lambda/entities/handler.ts`
- Modify: `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: Cognito groups, employee profile, requested entity/action.
- Produces: `authorize(ctx, resource, action)` and append-only audit records.

- [ ] **Step 1: Add a table-driven authorization test for every role/resource/action tuple**
- [ ] **Step 2: Make `custom:role` non-writable by the SPA client and derive effective role from a trusted group/profile mapping**
- [ ] **Step 3: Require `If-Match` on updates to invoices, payments, inventory, purchases, payroll, and approvals**
- [ ] **Step 4: Reject client creation of processor payments and immutable audit records**
- [ ] **Step 5: Add actor, timestamp, before/after status, and reason to every privileged mutation**
- [ ] **Step 6: Run TypeScript and Jest validation commands from Task 1**

### Task 3: Complete Customer Approval and DVI-to-Job Flow

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/approvals/handler.ts`
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/approvals.test.ts`

**Interfaces:**
- Consumes: estimate/inspection ID and customer delivery destination.
- Produces: one-time SHA-256-hashed token records, expiring public decision URLs, immutable approval events, and estimate lines created from inspection findings.

- [ ] **Step 1: Test expired, reused, wrong-record, approve, partial-approve, and decline tokens**
- [ ] **Step 2: Add token issue and decision routes with rate limits and no tenant data leakage**
- [ ] **Step 3: Add “Create estimate job” to failed/advisory inspection items, carrying notes and photos**
- [ ] **Step 4: Add customer report pages for inspection review and estimate decisions**
- [ ] **Step 5: Persist delivery status and decision audit on the related RO timeline**
- [ ] **Step 6: Verify desktop and 390px mobile approval flows with Playwright**

### Task 4: Build Inventory, Purchasing, Tire, Core, and Return Operations

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/inventory/movements.ts`
- Modify: `infra/lambda/entities/handler.ts`
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/inventory.test.ts`

**Interfaces:**
- Consumes: SKU, location, quantity, cost, vendor, PO, RO, reason, idempotency key.
- Produces: append-only stock movements and derived on-hand/committed/available quantities.

- [ ] **Step 1: Test concurrent receive/commit, insufficient stock, duplicate receipt, return, and core credit**
- [ ] **Step 2: Implement atomic receive, commit, release, adjust, return, and core movement commands**
- [ ] **Step 3: Add purchase-order register with ordered, partial, received, cancelled, and returned states**
- [ ] **Step 4: Add tire size, brand, model, season, load/speed rating, DOT, and quantity fields**
- [ ] **Step 5: Add price matrices by part/labor/tire class and apply a versioned matrix snapshot to estimate lines**
- [ ] **Step 6: Add provider-neutral catalog search interface; keep live catalog controls disabled without an adapter**
- [ ] **Step 7: Run unit tests plus a two-client concurrency integration test**

### Task 5: Add Booking, Campaigns, Reviews, and Communication Timeline

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/booking/handler.ts`
- Create: `infra/lambda/campaigns/handler.ts`
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/engagement.test.ts`

**Interfaces:**
- Consumes: shop capacity, service duration, customer consent, segment filters, delivery provider result.
- Produces: public booking requests, confirmed appointments, campaign jobs, review requests, and message events linked to customer/vehicle/RO.

- [ ] **Step 1: Test capacity collisions, duplicate booking, opt-out, quiet hours, and campaign idempotency**
- [ ] **Step 2: Add public booking availability and request endpoints with CAPTCHA/rate-limit hooks**
- [ ] **Step 3: Add confirmation, cancellation, reschedule, wait-list, and no-show states**
- [ ] **Step 4: Add customer segments for declined work, overdue service, inactive customers, and vehicle attributes**
- [ ] **Step 5: Add campaign drafts, approval, scheduling, delivery metrics, and consent suppression**
- [ ] **Step 6: Trigger review requests only after eligible paid invoices and suppress repeat requests**
- [ ] **Step 7: Show all estimate, inspection, invoice, reminder, campaign, and review messages on one timeline**

### Task 6: Add Multi-Shop Administration and Consolidated Reporting

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/reporting/handler.ts`
- Modify: `infra/lambda/common/auth.ts`
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/reporting.test.ts`

**Interfaces:**
- Consumes: permitted shop IDs, date range, report definition, cursor.
- Produces: paginated shop-scoped or consolidated datasets with drill-down references.

- [ ] **Step 1: Test that users cannot request unassigned shops and consolidated totals equal shop totals**
- [ ] **Step 2: Model shop groups and explicit user-to-shop assignments**
- [ ] **Step 3: Add a shop switcher that refreshes all tenant data and clears stale local state**
- [ ] **Step 4: Add saved date/location/technician/service filters and paginated report endpoints**
- [ ] **Step 5: Add sales, gross profit, labor efficiency, average RO, declined work, inventory turns, and customer retention reports**
- [ ] **Step 6: Add CSV accounting export with stable account mapping and reconciliation IDs**
- [ ] **Step 7: Validate every report against fixture-level ledger calculations**

### Task 7: Add Provider Adapters Without False Availability

**Files:**
- Modify: `app.js`
- Create: `infra/lambda/integrations/types.ts`
- Create: `infra/lambda/integrations/health.ts`
- Create provider adapters only after credentials/contracts are supplied.
- Modify: `infra/lib/api-stack.ts`
- Test: `infra/test/integrations.test.ts`

**Interfaces:**
- `IntegrationAdapter.health(): Promise<IntegrationHealth>`
- `VehicleHistoryAdapter.lookup(vin): Promise<VehicleHistory>`
- `PlateAdapter.decode(imageKey, state?): Promise<PlateResult>`
- `CatalogAdapter.search(query, vehicle?): Promise<CatalogItem[]>`
- `AccountingAdapter.export(batch): Promise<ExportReceipt>`

- [ ] **Step 1: Test unavailable, unauthorized, throttled, timeout, malformed, and healthy adapter responses**
- [ ] **Step 2: Store credentials only in Secrets Manager under `mechpro/<shopId>/<provider>`**
- [ ] **Step 3: Add health/status endpoints that reveal no secret material**
- [ ] **Step 4: Keep CarFax, plate recognition, live parts catalogs, two-way messaging, and accounting sync disabled until health is `ready`**
- [ ] **Step 5: Add per-provider request logs with tenant, latency, result code, and redacted correlation ID**
- [ ] **Step 6: Run provider sandbox contract tests before enabling any production toggle**

### Task 8: Release Validation and Deployment

**Files:**
- Modify: `service-worker.js`
- Modify: `index.html`
- Modify: `infra/README.md`
- Test: `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: successful unit/integration/browser checks and reviewed CDK diff.
- Produces: versioned PWA assets and deployed AWS resources.

- [ ] **Step 1: Run syntax, TypeScript, Jest, and CDK synth**

```powershell
node --check .\app.js
node .\infra\node_modules\typescript\bin\tsc -p .\infra\tsconfig.json --noEmit
node .\infra\node_modules\jest\bin\jest.js --config .\infra\jest.config.js --runInBand
node .\infra\node_modules\aws-cdk\bin\cdk.js synth --app "node node_modules/tsx/dist/cli.mjs bin/infra.ts"
```

- [ ] **Step 2: Review synthesized IAM for least privilege and confirm no resource replacement**
- [ ] **Step 3: Run authenticated smoke tests for RO completion, partial checkout, webhook settlement, and duplicate delivery**
- [ ] **Step 4: Run Playwright at 1440x900, 1024x768, and 390x844 with no overlap or console errors**
- [ ] **Step 5: Increment asset query versions and service-worker cache only after all checks pass**
- [ ] **Step 6: Deploy backend stacks, run post-deploy API smoke tests, then publish the frontend**
- [ ] **Step 7: Verify production account recovery, tenant isolation, and provider-disabled states**

## Definition of Done

- Every requested capability is either executable and tested or visibly disabled with a specific provider/configuration reason.
- A technician cannot create financial records or elevate a role.
- Completing the same RO twice creates one invoice.
- Replaying the same Stripe event creates one payment and returns HTTP 200.
- Partial payments can never cause Checkout to charge more than the current server-calculated balance.
- Stock, approvals, payroll, and financial history retain an actor and immutable audit trail.
- Cross-shop reporting includes only explicitly assigned shops.
- All automated checks and post-deploy smoke tests pass before production asset versions change.