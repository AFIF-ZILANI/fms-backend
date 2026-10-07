# Findings 03 — Security
- Date: 2026-10-06
- Commit: server@df7bc95
- Files analyzed: index.ts, src/App.ts, src/routes/*.ts (all 50), src/controllers/{device,employee,employee-payout-account,payroll-payout,payment,performance-score-entry,upload}.controller.ts, src/validators/*.ts (grep sweep + full read of device, employee, employee-payout-account, payroll-payout, payment, payment-instrument, performance-score-entry, ingest, item, audit-log, admin), src/services/{device,ingest,employee,employee-payout-account,payroll-payout,payment,payment-instrument,performance-score-entry,audit-log,item,house,warehouse,stock-unit,asset}.service.ts, src/middlewares/require-device.ts, src/lib/{current-actor,db,validator,valid,helper,app-error,response,prisma-errors,pagination,cloudinary-signature}.ts, src/config/env.ts, prisma/schema.prisma, prisma/migrations/*/migration.sql (grep for CASCADE / TRIGGER / RULE / REVOKE / POLICY), docs/PROGRESS.md

## Auth & tenancy model

**Authentication: none for the dashboard/API, device tokens for one route.**

- No login, session, JWT or role middleware exists. `src/App.ts:75-79` mounts every route under `/api` with no auth middleware. `src/routes/index.ts:53-107` registers all 50 routers with none either. `docs/PROGRESS.md:24` confirms this: "No login or role middleware."
- `requireDevice` (`src/middlewares/require-device.ts:8-15`) is the only authentication in the codebase. It runs on exactly one route: `POST /api/ingest/v1/sales` (`src/routes/ingest.routes.ts:26-31`). It looks up a bearer token by sha256 hash in `Device.token_hash`.
- The "who did this" identity comes from `getActorId()` (`src/lib/current-actor.ts:16-21`). It uses the device's profile when `requireDevice` ran, which happens only on that one route. Otherwise it falls back to the oldest `Admins` row's profile (`:29-37`). So nearly every `recorded_by_id`, `given_by_id`, `verified_by_id`, `paid_by_id` and `changed_by_id` is set to the same admin, whoever actually sent the request.
- CSRF and CORS are on outside development (`src/App.ts:42-57`). They are not authentication: any non-browser client (curl, a script on the farm LAN) is unaffected.

**Tenancy: single-tenant.** The schema has no tenant, farm or owner column. `Organization` (`prisma/schema.prisma:1143-1150`) is an item maker/brand lookup linked through `ItemOrganization` (`:1152-1161`). It is not a tenant and does not scope any query. This report therefore does not raise cross-tenant IDOR. The ownership problem is more basic: with no caller identity, every record is readable and writable by anyone who can reach the port. Severities below assume the server can be reached by more than the owner's own browser. At minimum that means anyone on the farm LAN, since phones talk to it (`src/routes/ingest.routes.ts:33-34` calls this a "trusted LAN surface").

**What is clean:**
- No raw SQL: no `$queryRaw`, `$queryRawUnsafe`, `$executeRaw*`, `Prisma.raw`, `Prisma.sql` or `Prisma.join` anywhere in `src/` or `index.ts`.
- Request bodies always go through `zValidatorRfc7807` and `getValid`. `c.req.json()` is never read directly, and no schema uses `.passthrough()`, `.catchall()` or `z.any()`. Zod's default object strips unknown keys, so `id`, `created_at` and `*_by_id` cannot be smuggled into create/update calls. The one exception is `approved_by_id` (S-5).
- Actor columns are stamped server-side via `getActorId` (for example `src/controllers/employee-payout-account.controller.ts:30-33` and `src/controllers/payroll-payout.controller.ts:41-44`).
- Device tokens are stored as sha256 hashes (`src/services/device.service.ts:17-19`, `prisma/schema.prisma:1484`).
- Hard deletes are limited to lookups and master data, and each checks for history first.
- Audit log has GET routes only (`src/routes/audit-log.routes.ts:8-13`).

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Medium | 5 |
| Low | 6 |
| **Total** | **15** |

---

### S-1: The entire API is unauthenticated (except one ingest route)
- Severity: critical
- Location: src/App.ts:75-79; src/routes/index.ts:53-107; src/lib/current-actor.ts:12-21
- Evidence: `app.route("/api", appRoutes);` has no middleware ahead of it, and `appRoutes.route("/payroll-payouts", payrollPayoutRoutes);` and the other routers are registered without any guard. `current-actor.ts:12-14`: "ponytail: there is no login yet, so the fallback is the oldest Admin's profile." `requireDevice` appears only at `src/routes/ingest.routes.ts:28`.
- Scenario: Anyone who can reach the server, such as a laborer's phone on the farm Wi-Fi or anyone on the internet if the port is forwarded or tunnelled, can:
  - create admins (`POST /api/admins`, `src/routes/admin.routes.ts:14`);
  - add a new payout account for any employee (`POST /api/employee-payout-accounts`, `src/routes/employee-payout-account.routes.ts:19-23`), which auto-closes the real one, and then confirm payouts;
  - change salaries (`PATCH /api/employees/:id`);
  - void score entries, read every financial record, and delete master data.
  Every one of these writes is attributed to the oldest admin.
- Direction: Add an authentication middleware in front of `/api` (excluding `/ingest/v1/pair` and `/health`) and resolve the actor from the session in `getActorId`; this is acknowledged as pending in docs/PROGRESS.md:24.

### S-2: Anyone can mint a long-lived device token bound to any profile, including an admin
- Severity: high
- Location: src/routes/device.routes.ts:8-14; src/validators/device.validator.ts:3-5; src/services/device.service.ts:22-35; src/lib/current-actor.ts:17-19
- Evidence: `deviceRoutes.post("/pairing-codes", zValidatorRfc7807("json", createPairingCodeSchema), DeviceController.createPairingCode)` has no guard. The schema accepts any `profile_id: z.string().uuid()`, and the service writes it unchanged. Redeeming (`POST /api/ingest/v1/pair`) returns a token that never expires (`prisma/schema.prisma:1474-1477`). `getActorId` then trusts it: "A paired device already proved an identity (requireDevice); trust it."
- Scenario:
  1. An attacker calls `GET /api/admins` to get an admin's `profile_id`, then `POST /api/devices/pairing-codes {profile_id}`, then `POST /api/ingest/v1/pair`.
  2. The result is a permanent bearer token that impersonates the admin. Today it can only post staged sales, recorded as that admin.
  3. Once auth lands, it will still be a valid device credential. `getActorId` already prefers the device identity over everything else, so the token becomes an admin identity.
  4. The same unauthenticated surface lets anyone revoke any genuine device (`POST /api/devices/:id/revoke`, `device.routes.ts:14`), which strands phones holding unsynced sales.
- Direction: Pairing-code creation and revocation must require an authenticated admin, and the profile a code binds to should be restricted (e.g., not ADMIN, or only the caller's own scope).

### S-3: Bulk PII and bank/MFS account numbers returned by list endpoints with no `select` exclusion
- Severity: high
- Location: src/services/employee.service.ts:14-21, 59-64, 163; src/services/employee-payout-account.service.ts:11-13, 22-28; src/services/payment-instrument.service.ts:19; src/services/admin.service.ts:11 (same `include = { profile: true }` in customer.service.ts:11, supplier.service.ts:11, doctor.service.ts:7); src/services/ingest.service.ts:55-63; schema prisma/schema.prisma:458-461, 521-545, 1284-1285, 1356, 1385
- Evidence:
  - `EmployeeService.getAll` returns full `Employees` rows with `include = { profile: { include: { avatar: true } }, ... }`. That includes `nid_number`, `date_of_birth`, `marital_status`, `emergency_name/phone/email/address`, `reference_name/phone/address`, `reference_salary`, plus the profile's `mobile`, `email` and `address`.
  - `EmployeePayoutAccountService.getAll` returns `account_number`, `routing_number`, `bank_name` and `holder_relation` for every employee.
  - `PaymentInstrument` returns `account_no` and `mobile_no`.
  - `GET /api/ingest/v1/sales` (unauthenticated by design, `ingest.routes.ts:33-39`) returns the raw device `payload` including `buyer_name`.
  - None of these services use a `select` that leaves out sensitive columns.
- Scenario: Combined with S-1, one unauthenticated request per endpoint pulls the whole staff dossier: national ID numbers, dates of birth, family contacts, and the bank/bKash/Nagad account each wage is sent to. That is enough for identity fraud or social-engineering a wallet provider. The list views also don't need most of these fields: NID and emergency contacts are detail-page data, not roster data.
- Direction: Gate behind auth/role, and use a narrow `select` for list endpoints (mask account numbers to last 4 except on explicit detail/reveal).

### S-4: Payroll payout accepts client-supplied `account_number` and `amount`, bypassing the append-only, verified payout-account control
- Severity: high
- Location: src/validators/payroll-payout.validator.ts:7-16; src/services/payroll-payout.service.ts:82-121
- Evidence: The validator accepts `method: method.optional()`, `account_number: z.string().optional()` and `amount: z.coerce.number().positive(...).optional()`, with no upper bound. The service runs `const account_number = data.account_number ?? account?.account_number;` (line 96) and `const amount = data.amount ?? record.total_pay;` (line 109). When `payout_account_id` is given, the body's `account_number` still wins: the row links to the verified account but stores the attacker's number. The only cross-check is `account.employee_id !== record.employee_id` (line 102). Nothing compares the account number or the amount.
- Scenario: The schema states the intent (`prisma/schema.prisma:1347-1349`): "redirecting someone's salary is the most attractive target in a payroll system", so payout accounts are append-only and verified. That control can be skipped entirely:
  1. Call `POST /api/payroll-payouts {payroll_record_id, payout_account_id: <real verified acct>, account_number: "<attacker bKash>", amount: 99999}`.
  2. The payout shows the verified account link, so it looks legitimate in the UI, but the snapshot says to send 99,999 Tk to the attacker's wallet.
  3. `markPaid` (lines 159-209) then books that amount as a SALARY expense and an outgoing Payment.
  This works unauthenticated today (S-1), and still works for any authenticated non-owner role later.
- Direction: Derive `account_number`/`method` from the referenced account only (reject a body override when `payout_account_id` is set), and constrain `amount` to `record.total_pay` (or require an audited override).

### S-5: Performance-score "Owner approval" is a client-supplied, unvalidated profile id
- Severity: medium
- Location: src/validators/performance-score-entry.validator.ts:40-41, 52-55; src/services/performance-score-entry.service.ts:128-130
- Evidence: `approved_by_id: z.string().uuid().optional(),` is required when `criterion === "OTHER"`. The service writes it straight through: `...(data.approved_by_id !== undefined && { approved_by_id: data.approved_by_id })`. No check confirms the id belongs to an Owner/Admin, or even that it differs from `given_by_id`. A non-existent id fails only on the FK.
- Scenario: Any caller can create an `OTHER` entry of ±5 points, which feeds straight into the payroll adjustment percent. They name any profile as the approver, for example the owner's id from `GET /api/admins`. The entry then looks owner-approved. Other fields have comments promising that `*_by_id` "is stamped by the controller from the session, never accepted from the body", but this one breaks that rule.
- Direction: Treat approval as a separate authenticated action by an Owner (stamp `approved_by_id` from the session), not a body field.

### S-6: Payment instrument account numbers are mutable in place after money has moved through them
- Severity: medium
- Location: src/services/payment-instrument.service.ts:50-70 (account_no at line 65); src/validators/payment-instrument.validator.ts:23-25
- Evidence: `update` sets `...(account_no !== undefined && { account_no })` and `...(mobile_no !== undefined && { mobile_no })` with no check on payment history and no AuditLog row. The `remove` doc comment just below (lines 71-77) explains why history matters: "Once any Payment has moved through it ... it is part of the money trail ... so every payment still resolves to the account it actually used." `update` breaks that guarantee.
- Scenario: Someone rewrites the farm's outgoing wallet number on an instrument with a year of payments. Every historical Payment now appears to have left from or arrived at the new number, which erases the real money trail with no trace. Alternatively, a customer's or supplier's receiving `account_no` can be swapped before the next payment.
- Direction: Treat account identifiers as immutable once referenced (new instrument + deactivate old, same pattern as EmployeePayoutAccount), or audit-log every change.

### S-7: Actor attribution is fake for almost every write; several state changes record no actor at all
- Severity: medium
- Location: src/lib/current-actor.ts:16-38; src/services/performance-score-entry.service.ts:143-186; src/services/employee-payout-account.service.ts:84-94; src/services/device.service.ts:99-103; src/services/employee.service.ts:320-340
- Evidence:
  - `getDefaultActorId` returns `prisma.admins.findFirst({ orderBy: { created_at: "asc" } })` and caches the result for the process lifetime (`cachedAdminProfileId`). It ignores `Profiles.is_active`, so a deactivated admin keeps being stamped as the actor.
  - These changes record no actor column at all:
    - `void` (only `status`/`void_reason`, line 160)
    - `dispute` and `acknowledge`
    - payout-account `close`
    - device `revoke`
    - employee `terminate`
- Scenario: In a dispute over who redirected a wage, who voided a −10 score, or who terminated an employee, every row names the same oldest admin, or nobody. The accountability columns the schema carries throughout (`prisma/schema.prisma:475-499`) give no evidence of who did anything. `acknowledge` is meant to be the employee confirming they saw the entry, but anyone can call it and it starts the 7-day dispute clock on the employee's behalf.
- Direction: Resolve the real actor from auth (S-1) and add `*_by_id` to void/close/revoke/terminate/acknowledge.

### S-8: Audit log covers one field and has no tamper protection below the API
- Severity: medium
- Location: src/services/employee.service.ts:268-278 (sole writer); src/services/audit-log.service.ts:6-15; prisma/schema.prisma:1436-1450; prisma/migrations/ (no TRIGGER/RULE/REVOKE in any migration)
- Evidence:
  - `grep auditLog.` finds a single `tx.auditLog.create` call, for an `Employees.reference_salary` change, and it uses `changed_by_id: actor_id ?? (await getDefaultActorId())`.
  - These changes produce no audit rows: payout-account create/close, payroll payout create/mark-paid/mark-failed, payment-instrument edits (S-6), score voids, admin creation, device pairing and revocation.
  - The API exposes only GET (`audit-log.routes.ts:8-13`), which is good. But no migration makes the table append-only (no trigger blocking UPDATE/DELETE, no restricted grants), and `src/lib/db.ts:9-11` connects with a single `DATABASE_URL`, apparently as the owning role (needs verification of the production DB role).
- Scenario: The most sensitive financial actions (wage destination and payout confirmation) leave no audit trail. Anyone with DB credentials, or a future buggy service, can rewrite or delete the few audit rows that exist, and nothing would detect it.
- Direction: Write AuditLog rows for payroll/payout/instrument/admin/device mutations and make AuditLog append-only at the DB level (trigger or a non-owner app role without UPDATE/DELETE on it).

### S-9: `InventoryAdjustment` rows cascade-delete with their Item, Warehouse or House; the app-level guard is a non-transactional check-then-delete
- Severity: medium
- Location: prisma/schema.prisma:1089, 1091, 1093; prisma/migrations/20260805191818_init/migration.sql:1036-1042; src/services/item.service.ts:140-166; src/services/house.service.ts:185-217; src/services/warehouse.service.ts:64-81
- Evidence: The schema sets `item Item @relation(..., onDelete: Cascade)` and does the same for `warehouse` and `house`. The migration matches: `ON DELETE CASCADE`. The services guard deletes with a `_count` that includes `inventoryAdjustments`. However, the count (`findUnique ... _count`) and the `delete` are separate statements, not one transaction, and an adjustment inserted between them is deleted silently. The DB does not protect the history: any delete that skips the service guard removes stock-correction records without error, whether from a future route, a script, Prisma Studio or manual SQL.
- Scenario: Stock adjustments (write-offs, shrinkage, opening balances) are the inventory audit trail. A careless `DELETE FROM "Warehouses"` by an operator cleaning up test data removes every adjustment made in that warehouse, with no FK error to stop it. Balances computed from the ledger then no longer reconcile with what the adjustments explained.
- Direction: Make these FKs `Restrict` (the services already treat history as a blocker) so the DB enforces what the app intends.

### S-10: Profile and Batch cascades could remove role rows and allocation history (no delete path today)
- Severity: low
- Location: prisma/schema.prisma:508, 567, 575, 589, 604 (Profiles → Employees/Admins/Customers/Suppliers/Doctors), 690 (Batches → BatchHouseAllocation)
- Evidence: `profile Profiles @relation(fields: [profile_id], references: [id], onDelete: Cascade)` on all five role tables, and `batch Batches @relation(..., onDelete: Cascade)` on `BatchHouseAllocation`. No `profiles.delete` or `batches.delete` exists in `src/`. Downstream financial tables (PayrollRecord, PerformanceScoreEntry, Payment, etc.) use the default Restrict, so a profile with history would fail to delete. A profile with no financial rows would take its Employees row with it, and that row holds NID and payout linkage.
- Scenario: Low today because no API path deletes these rows. It is a trap for a future "delete customer" feature or a manual cleanup: a batch delete would silently erase its whole house-movement history.
- Direction: Switch to `Restrict` to match the "never hard-delete a Profile" comment at schema line 465.

### S-11: Device `token_hash` returned by the device list and revoke endpoints
- Severity: low
- Location: src/services/device.service.ts:92-103
- Evidence: `listDevices` uses `prisma.device.findMany({ orderBy, include: { profile: { select: { id: true, name: true } } } })`, which returns every scalar including `token_hash`. `revoke` returns the full updated row as well. Both are unauthenticated (S-1).
- Scenario: The hash is sha256 of 32 random bytes, and `resolveToken` hashes what the caller presents, so a leaked hash cannot authenticate or be reversed. The issue is defense-in-depth and secret-adjacent data leaving the server for no reason. It would become exploitable if any future code path ever compares hashes directly.
- Direction: `select` an explicit field list on device reads.

### S-12: Pairing codes stored in plaintext; rate limiter keyed on spoofable `X-Forwarded-For`
- Severity: low
- Location: prisma/schema.prisma:1497-1505; src/services/device.service.ts:11-14, 24-30, 42-45; src/App.ts:63-70
- Evidence: `PairingCode.code String @id` stores the plaintext code, unlike device tokens, which are hashed. Codes are 8 characters from a 32-character alphabet (40 bits), valid for 10 minutes, and single-use. The rate limiter uses `keyGenerator: (c) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"`, so a client can rotate the header to get a fresh bucket. When no proxy sets the header, every client shares the bucket `"unknown"`, so one noisy client can rate-limit everyone.
- Scenario: Brute-forcing a live code by spoofing XFF is still infeasible (about 2^40 space in 10 minutes). The realistic risks are anyone with DB read access redeeming a fresh code inside its window, and the shared-bucket DoS. The more serious version, simply minting a code, is S-2.
- Direction: Store `sha256(code)`; key the limiter on the socket address (or a trusted proxy's header only).

### S-13: Ingest idempotency key is global, not scoped to the sending device
- Severity: low
- Location: src/services/ingest.service.ts:29-34; prisma/schema.prisma:1514
- Evidence: `const idempotency_key = \`${input.sale_id}:${portion}\`;`, then `if (existing) continue;`. `sale_id` comes from the device (`ingest.validator.ts:6`, `z.string().min(1)` and not required to be a UUID), and the key does not include `ctx.device_id`.
- Scenario: Any paired device, including one minted via S-2, can post with a `sale_id` that collides with another device's real sale, for example a predictable or non-UUID id from a buggy build. The genuine upload is then silently skipped, and the server returns success with `created: 0`. The sale never reaches the review queue.
- Direction: Include `device_id` in the uniqueness key (`@@unique([device_id, idempotency_key])`).

### S-14: Payment `direction` is client-chosen, not derived from `ref_type`
- Severity: low
- Location: src/validators/payment.validator.ts:19; src/services/payment.service.ts:139-145
- Evidence: The validator accepts `direction: z.enum(["INCOMING", "OUTGOING"])` independently of `ref_type`, and the service writes it as given. The over-payment guard (`outstandingWithin`) sums amounts per ref regardless of direction.
- Scenario: An `OUTGOING` payment against a `SALE` (cash leaving the farm, recorded as settling a customer's invoice) passes validation. It reduces the sale's outstanding balance and also counts as an outflow on the instrument. That inflates instrument outflows while marking the receivable as collected, which could hide skimmed receipts.
- Direction: Derive `direction` server-side from `ref_type` (SALE/BIRD_SALE → INCOMING; PURCHASE/EXPENSE → OUTGOING).

### S-15: Upload signature signs an arbitrary client-chosen Cloudinary folder
- Severity: low
- Location: src/controllers/upload.controller.ts:13; src/lib/cloudinary-signature.ts:32-43
- Evidence: `const folder = c.req.query("folder") || "employees";` is unvalidated and is signed into the upload params. The endpoint is unauthenticated (S-1).
- Scenario: Anyone can get a valid signed upload into any folder of the farm's Cloudinary account, under the employee preset. That allows storage abuse, or planting files next to real employee photos and notice documents (`notice_doc_url` and `receipt_doc_url` are URLs the app later trusts). Not a DB issue directly, but the resulting URLs are persisted in `Avatars.image_url` and similar columns.
- Direction: Validate `folder` against an allow-list.
