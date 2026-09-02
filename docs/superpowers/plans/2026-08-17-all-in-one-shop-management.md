# All-in-One Shop Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the linked customer-to-reminder repair workflow and expose every requested shop-management capability with honest hardware/provider boundaries.

**Architecture:** Extend the existing generic DynamoDB entity API for inventory, vendors, inspections, templates, reminders, and settings. Add focused frontend modules to the static SPA and a server-side NHTSA VIN decoder/cache endpoint; use the existing S3 presign flow for photos and signatures. Browser diagnostics use Web Serial with ELM327 text commands on supported desktop Chrome/Edge browsers.

**Tech Stack:** Vanilla JavaScript PWA, CSS, AWS CDK v2, API Gateway HTTP API, Cognito, Lambda Node.js 24, DynamoDB, S3, NHTSA vPIC API, Web Serial.

## Global Constraints

- Preserve Cognito JWT authorization and tenant isolation by `custom:shopId`.
- Store passwords and provider secrets only in Cognito or AWS Secrets Manager, never browser state or DynamoDB.
- Keep platform suspension checks on all customer-facing API routes.
- CarFax and commercial plate recognition remain disabled until credentials and contracts are supplied.
- ELM327 support is basic OBD-II only and must not claim OEM programming or bidirectional control.

---

### Task 1: Generic Entity Foundation

**Files:**
- Modify: `infra/lambda/entities/handler.ts`
- Test: `infra/test/infra.test.ts`

**Interfaces:**
- Produces entity types `inventory`, `vendors`, `inspectiontemplates`, `inspections`, `reminders`, `services`, and `shopsettings` through the existing `/entities/{type}` contract.

- [ ] Add prefixes for each entity type.
- [ ] Add tests proving supported entity names are normalized and unknown names are rejected.
- [ ] Run `node .\node_modules\typescript\bin\tsc --noEmit` and Jest.

### Task 2: Linked Customer and Vehicle Workspace

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces `vehicleWorkspace()`, `openCustomerRecord()`, `openVehicleRecord()`, and linked history selectors keyed by stable customer and vehicle IDs.

- [ ] Add customer billing fields and searchable history/detail views.
- [ ] Add owner-linked vehicle records with photos, service history, reminder dates, VIN, plate, mileage, and notes.
- [ ] Add statement printing/export from linked invoices and payments.
- [ ] Validate responsive rendering at desktop and mobile widths.

### Task 3: Estimates, Decisions, and Canned Services

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces estimate discount calculations, `approved`/`declined` decisions, and reusable service/item templates.

- [ ] Add line and estimate discounts to total calculations.
- [ ] Add approve and decline actions with actor, timestamp, and notes.
- [ ] Add canned services/items CRUD and insertion into estimates.
- [ ] Preserve signature capture and digital delivery records.

### Task 4: Digital Inspections

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces 30+ item templates, custom templates, inspection responses, photo keys, damage markers, findings, recommendations, and print/share views.

- [ ] Add a default 36-point inspection template and template editor.
- [ ] Add pass/attention/fail responses and technician notes.
- [ ] Upload inspection photos through the existing S3 presign endpoint.
- [ ] Add click/tap vehicle-diagram damage markers.
- [ ] Add printable/shareable inspection report and approval history.

### Task 5: Inventory, Purchasing, and Vendors

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces inventory records for parts, tires, services, assets, stock adjustments, reorder levels, purchases, and vendors.

- [ ] Add inventory list, filters, low-stock alerts, and adjustment log.
- [ ] Add vendor records and purchase/expense linkage.
- [ ] Link estimate/work-order part lines to inventory SKUs.
- [ ] Decrement committed stock once per completed work order.

### Task 6: Scheduling and Service Reminders

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces editable appointments and reminders linked to customer and vehicle IDs, with delivery history through the existing messaging abstraction.

- [ ] Add appointment create/edit/reschedule actions.
- [ ] Add mileage/date reminders and due/overdue filters.
- [ ] Add reminder send/record action and follow-up marketing queue.

### Task 7: VIN and Provider Integrations

**Files:**
- Create: `infra/lambda/vehicles/decode.ts`
- Modify: `infra/lib/api-stack.ts`
- Modify: `app.js`
- Test: `infra/test/infra.test.ts`

**Interfaces:**
- Produces `GET /vehicles/decode/{vin}` returning normalized NHTSA vPIC data.

- [ ] Validate 17-character VINs server-side.
- [ ] Fetch and normalize NHTSA data with timeout/error handling.
- [ ] Add a Decode VIN action that fills vehicle fields.
- [ ] Add provider settings and disabled states for CarFax and plate recognition until credentials exist.

### Task 8: Basic ELM327 Diagnostics

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Produces a Web Serial connection, basic PID reads, DTC reads, and guarded code clearing for compatible ELM327 adapters.

- [ ] Add connect/disconnect and adapter initialization.
- [ ] Read RPM, speed, coolant temperature, and stored DTCs.
- [ ] Require explicit confirmation before mode 04 clear-codes command.
- [ ] Show browser/device compatibility and OEM-level limitation text.

### Task 9: Branding, Analytics, and Release Validation

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `theme.css`
- Modify: `service-worker.js`
- Modify: `index.html`

**Interfaces:**
- Produces shop branding, invoice print template, operational analytics, and a versioned PWA release.

- [ ] Add persisted shop profile, logo, colors, invoice header, discounts/coupons, and vendor defaults.
- [ ] Add customer value, technician productivity, revenue/service, inventory, and reminder analytics.
- [ ] Run JavaScript syntax, TypeScript, Jest, diagnostics, CDK synth/diff, and browser desktop/mobile checks.
- [ ] Deploy API and Amplify only after additive infrastructure review.
