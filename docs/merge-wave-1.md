# Merge Wave 1: infra and contract alignment

## What was merged

- Added `infra/contracts/wave1-alignment.ts` to capture Wave 1 contract alignment for legacy `MechPro-aws` entities and target `mechpro-dispatch` entities.
- Added `infra/lambda/common/runtime-env.ts` to preserve current Lambda env names while accepting legacy aliases from `MechPro` / `MechPro-aws`.
- Updated `infra/lambda/entities/handler.ts` so legacy `bookings` requests map onto the target `appointments` entity path and payload shape.
- Updated `infra/lambda/admin/accounts.ts`, `infra/lambda/files/presign.ts`, and `infra/lambda/ai/agentphone-webhook.ts` to consume env aliases without changing current defaults.
- Repaired target-repo infra build blockers in `infra/package.json`, `infra/lib/api-stack.ts`, and `infra/test/infra.test.ts` so Wave 1 changes can be validated.

## File-level mapping

### `tinytim3271-wq/MechPro-aws` → `tinytim3271-wq/mechpro-dispatch`

> Direct repository access to `MechPro-aws` was not available in this environment. Mapping below is based on the path inventory documented in `MechPro/ARCHITECTURE.md`.

| Source file or area | Target file or area | Wave 1 decision |
| --- | --- | --- |
| `MechPro-AWS/lambda/functions/customers.ts` | `infra/contracts/wave1-alignment.ts` + `infra/lambda/entities/handler.ts` | Mapped customer payload fields into the target single-table entity model; no separate CRUD Lambda imported. |
| `MechPro-AWS/lambda/functions/bookings.ts` | `infra/contracts/wave1-alignment.ts` + `infra/lambda/entities/handler.ts` | Merged as compatibility mapping from legacy `bookings` to target `appointments`. |
| `MechPro-AWS/lambda/functions/invoices.ts` | `infra/contracts/wave1-alignment.ts` | Added invoice field normalization (`total_amount`, `payment_method`, `booking_id`) without replacing current invoice flows. |
| `MechPro-AWS/lambda/functions/inspections.ts` | `infra/contracts/wave1-alignment.ts` | Added inspection field normalization (`vehicle_vin`, `ai_analysis`) only. |
| `MechPro-AWS/lambda/functions/employees.ts` | `infra/contracts/wave1-alignment.ts` | Added employee field normalization (`salary`, `status`) only. |
| `MechPro-AWS/lambda/functions/auth.ts` | `infra/lambda/common/auth.ts` | Skipped for Wave 1; target JWT authorizer and shop-scoped claims remain authoritative. |
| `MechPro-AWS/lambda/functions/db.ts` | none | Skipped for Wave 1 because source uses Postgres/RDS while target uses DynamoDB single-table storage. |
| `MechPro-AWS/lib/mech_pro-aws-stack.ts` | `infra/lib/*.ts` | Skipped for Wave 1; target multi-stack CDK layout remains in place. |
| `MechPro-AWS/lib/monitoring-stack.ts` | none | Skipped for Wave 1; monitoring parity can be revisited in Wave 2. |

### `tinytim3271-wq/MechPro` → `tinytim3271-wq/mechpro-dispatch`

| Source file or area | Target file or area | Wave 1 decision |
| --- | --- | --- |
| `aws/runtime/env.ts` | `infra/lambda/common/runtime-env.ts` | Merged the env alias/default loading pattern, adapted for current Lambda-specific variables. |
| `aws/runtime/auth.ts` | considered only | Skipped for now; claim model differs because target requires `custom:shopId` and role-based multi-tenancy. |
| `aws/runtime/schema.ts` / `aws/runtime/db.ts` | none | Skipped for Wave 1; schema and database model are fundamentally different. |
| `src/lib/obd/adapter.ts` / `src/lib/keys/adapter.ts` | `diagnostics/shared/contracts.json` (existing reference), docs only | Not imported yet; current repo already has a stronger J2534-oriented diagnostics contract for the Windows flow. |

## Equivalent components and key conflicts

| Capability | Source repos | Target repo | Decision |
| --- | --- | --- | --- |
| Auth | Cognito auth helpers and handler-level verification | API Gateway JWT authorizer + `infra/lambda/common/auth.ts` | Keep target implementation. |
| Storage | Aurora Postgres + CRUD tables | DynamoDB single-table + S3 | Do not merge storage layers in Wave 1. |
| Booking/scheduling | `bookings` REST resource | `appointments` entity collection | Added payload/entity adapter. |
| File uploads | S3 bucket env in source | S3 presign Lambda in target | Added env alias support only. |
| Frontend URL config | `FRONTEND_URL` in source runtime env | `APP_URL` in target AI webhook | Added alias support only. |

## What was skipped and why

- Full `MechPro-aws` Lambda handlers were skipped because target already has active domain handlers and a different persistence model.
- `MechPro` Convex-compatible runtime modules were skipped because they depend on Postgres schema metadata and a central function registry that does not exist in this repo.
- Monitoring, VPC, Aurora, and EventBridge patterns were skipped because they would materially change deploy/runtime behavior and exceed a safe first migration wave.

## Unresolved decisions for Wave 2

- Decide whether legacy import tooling should write source-native records first and transform later, or continue using the new adapter layer at the API boundary.
- Decide whether `employees.salary` from `MechPro-aws` should remain a generic `payRate` compatibility field or map into a stronger payroll contract.
- Evaluate whether the `MechPro` HTTP/error helper patterns should be consolidated into shared Lambda response utilities across this repo.
- Confirm whether `MechPro-aws` repository access should be restored for a direct file diff before deeper infra migration.

## Follow-up items for Wave 2

- Add importer scripts or admin migration endpoints that batch-convert legacy `MechPro-aws` data into the target single-table format.
- Add docs/tests for any future auth-claim bridge between global-source users and shop-scoped target users.
- Revisit monitoring/CDK parity if `MechPro-aws` contains reusable alarms or dashboards worth porting.
- Reassess shared diagnostics TypeScript contracts if `MechPro` OBD/key interfaces will be revived alongside the existing J2534 contract.
