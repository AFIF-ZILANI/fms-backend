# FMS API Reference

Full endpoint reference for the ZeroD Farms Management System backend. Written
for building the web admin dashboard and the employee mobile app against —
every field name, enum value, status code, and error condition below matches
the actual implementation (verified against source at doc-writing time), not
the original design docs where the two differ.

Companion docs: [`endpoints.md`](./endpoints.md) (every route in one table, with who
may call it, its status and its inputs; generated from the code, so it is the
complete list), [`FEATURES.md`](./FEATURES.md) (what each role/page needs),
[`PROGRESS.md`](./PROGRESS.md) (what is built and what is not).

Base URL (dev): `http://localhost:5085`. Every route below is mounted under
`/api` (e.g. `/api/admins`) except `GET /health`.

---

## 1. Conventions — read this before building anything

### 1.1 Transport: format, compression, headers

- **Request bodies**: `Content-Type: application/json` only. No
  `multipart/form-data`, no file/binary upload endpoint exists anywhere in
  this API (the schema has an `Avatars` model with an `image_url` field, but
  no upload endpoint was built for it — there's currently no way to attach
  an avatar through this API at all).
- **Response bodies**: `Content-Type: application/json; charset=UTF-8`,
  **not compressed** — there's no gzip/brotli middleware in the stack
  (checked directly: no `compress()` middleware, no compression package
  installed). Don't send `Accept-Encoding` expecting a compressed body; you
  won't get one. For a mobile client on a slow connection, this means
  response size is exactly what you see below, uncompressed.
- **CORS**: allowed origins come from `ALLOWED_ORIGINS` (comma-separated
  env var); credentialed requests only work in production
  (`CORS_CREDENTIALS && !isDev`). In dev, origin is wide open (`*`) and
  credentials are off.
- **CSRF**: enabled in production only (skipped entirely in dev), validates
  the request's `Origin` header against `ALLOWED_ORIGINS`. Not relevant to
  local development against this API.
- **Security headers**: `secureHeaders()` sets a restrictive CSP
  (`default-src 'self'`, no inline scripts, `frame-ancestors: DENY`) —
  irrelevant to a same-origin API client but worth knowing if you ever
  render API responses in an iframe or embed a widget.

### 1.2 Response envelope

**Success:**

```json
{ "success": true, "message": "Admin created", "data": { ... } }
```

Paginated list responses add `meta`:

```json
{
  "success": true,
  "message": "Admins fetched successfully",
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 47, "totalPages": 3 }
}
```

**Error — RFC 7807 Problem Details**, on every application-level error:

```json
{
  "type": "https://api.bhaze.dev/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "paid_amount cannot exceed the purchase total",
  "extensions": { "fields": { "quantity": "Quantity must be positive" } }
}
```

`extensions.fields` only appears on 400s from Zod validation failures — a
flat map of `field.path` → message, ready to attach to a form. Every other
error type has no `extensions`; read `detail` for the user-facing message.

**⚠️ One exception to the JSON contract**: a **429** (rate limit exceeded)
response body is **plain text**, not JSON, not RFC 7807-shaped — see §1.5.
Calling `response.json()` on a 429 will throw. Check `response.status`
before parsing the body, or catch the parse failure.

### 1.3 HTTP status codes actually used

| Status | When | Body shape |
|---|---|---|
| 200 | Every successful response except resource creation — list, get, update, and every action endpoint (`deactivate`, `reactivate`, `resolve`, `close`, `bind`, `relocate`, `dispose`, `scan`, `generate`, `/status`, etc.) | success envelope |
| 201 | Endpoints that create a brand-new resource — §1.4 lists the original ones; [`endpoints.md`](./endpoints.md) has every route's status | success envelope |
| 400 | Zod validation failure, OR a business-rule rejection (a computed total exceeded, a cross-field mismatch), OR a client-supplied foreign id that doesn't reference an existing row (P2003 → mapped to 400, not 404 — see §1.7) | RFC 7807 |
| 404 | Resource not found by `:id`, OR (unrelated to any specific resource) hitting a URL that doesn't match any route at all | RFC 7807 |
| 409 | Duplicate unique field, invalid state transition, or a business-rule conflict (oversell, insufficient balance, already-in-that-state) | RFC 7807 |
| 429 | Rate limit exceeded (see §1.5) — **not RFC 7807**, plain text | plain text |
| 500 | Unhandled exception — shouldn't happen for any documented flow; report as a bug | RFC 7807 |
| 504 | Request exceeded `TIMEOUT_MS` (30s default) | RFC 7807 |

**Also used**: 401 (no session, or an invalid or expired one; §1.6) and 403 (the signed-in
employee's role may not call the route; [`endpoints.md`](./endpoints.md) says who may call
what), both RFC 7807. 204 is returned only by `DELETE /api/batch-vaccine-schedules/:id`;
every other delete returns `200` with `data: null`.

**Not used**: 422. The `AppError.unprocessable` factory exists, but nothing throws it.

### 1.4 Endpoints that return 201 (everything else returns 200)

`POST /api/admins`, `/api/employees`, `/api/suppliers`, `/api/customers`,
`/api/doctors`, `/api/houses`, `/api/items`, `/api/warehouses`,
`/api/organizations`, `/api/item-organizations`, `/api/stock-units`
(provision), `/api/assets`, `/api/batches`, `/api/batch-house-allocations`,
`/api/mortality-logs`, `/api/purchases`, `/api/consumptions`,
`/api/medications`, `/api/vaccinations`, `/api/environment-records`,
`/api/weight-records`, `/api/batch-feeding-programs`, `/api/sales`,
`/api/bird-sales`, `/api/expenses`, `/api/performance-score-entries`,
`/api/payroll-records/generate`, `/api/alerts`, `/api/payment-instruments`,
`/api/payments`, `/api/inventory-adjustments`, `/api/item-categories`,
`/api/units`, `/api/expense-categories`, `/api/supplier-supply-categories`
(§6.8). Every other `POST`
(deactivate/reactivate/resolve/close/bind/relocate/dispose/scan) mutates an
existing row rather than creating a new one, and returns 200.

### 1.5 Rate limiting & timeouts

Every route (`"*"`, including `/health`) is rate-limited: **120 requests per
60-second window per client IP** by default (`RATE_LIMIT_MAX`/
`RATE_LIMIT_WINDOW_MS`, both configurable). Standard rate-limit headers are
included on every response so a client can show "requests remaining"
proactively: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
(draft-6 spec). On exceeding the limit: **`429`, `Content-Type: text/plain`,
body `"Too many requests, please try again later."`** — this is the one
place in the API that doesn't return JSON at all; handle it as a distinct
case in your HTTP client's error handling, not through the same
RFC7807-parsing path as everything else.

Every request also has a **30-second timeout** (`TIMEOUT_MS`); exceeding it
returns `504` in the normal RFC 7807 shape (this one *does* flow through the
standard error envelope). No endpoint in this API should legitimately take
anywhere near 30s — a 504 means something is actually stuck, not a
false-positive to silently retry through.

### 1.6 Authentication

Every `/api` route needs a session except `POST /auth/login`, `POST /auth/logout`
and the two PoultryScale device routes (`POST /ingest/v1/pair`, `POST /ingest/v1/sales`,
which use a device token). Anything else without a valid session is a **401**.

There is no registration: admins and employees already exist in the database.
Hiring an employee or creating an admin returns a one-time `temp_password` in the
create response; hand it over with the email. The first login must change it.

| Endpoint | Notes |
| --- | --- |
| `POST /auth/login` | `{ email, password, client? }`. `client: "web"` (default) sets an httpOnly `fms_session` cookie, so send `credentials: "include"`. `client: "mobile"` returns `data.token` instead; send it as `Authorization: Bearer <token>`. Wrong email and wrong password are the same 401. Five failures lock that email for 15 minutes (429). |
| `GET /auth/me` | The logged-in profile: `id, name, email, role, employee_id, employee_role, must_change_password`. |
| `POST /auth/change-password` | `{ current_password, new_password }` (min 8). Returns a fresh token (mobile) or cookie (web). Every older token for that person stops working. |
| `POST /auth/logout` | Clears the cookie. Mobile just discards its token. |
| `POST /employees/:id/reset-password`, `POST /admins/:id/reset-password` | Admin only. New `temp_password`, shown once. The only recovery path (no email is sent). |

While `must_change_password` is true, every route except `/auth/me`,
`/auth/change-password` and `/auth/logout` returns **403** with
`extensions.code = "PASSWORD_CHANGE_REQUIRED"`. Show a set-new-password screen.

Deactivating or terminating a person, or changing their password, cuts off their
existing tokens on the next request. Sessions last 7 days on web and 30 on mobile.

**The actor is never in the request body.** `recorded_by_id`, `given_by_id` and
the like are stamped from the session.

**Roles.** Admins may call every route. An EMPLOYEE may call only what
`src/lib/permissions.ts` allows (default-deny, **403** otherwise): the
farm reads and log forms for WORKER and MANAGER, the manager actions for MANAGER
only, and a worker's own employee, payroll and performance records. That file
mirrors the mobile permission matrix (`mobile/docs/PRD.md` §4). An employee
role code not named there gets nothing.

### 1.7 Bad foreign ids are 400, not 404

If a request body references another table's id that doesn't exist (a
`house_id` that was never created, a typo'd `item_id`, ...), the response is
**`400 Bad Request`** with `detail` naming the field — **not** a 404. This
is deliberate and consistent everywhere in the API (it's a single shared
error-mapping function, not per-endpoint logic): a 404 is reserved for "the
`:id` in the URL path doesn't exist"; a bad id *inside the body* is treated
as a validation problem. Example:

```json
{ "type": "...", "title": "Bad Request", "status": 400,
  "detail": "purchase_item_id does not reference an existing record" }
```

### 1.8 Pagination

Every list endpoint (`GET` without `/:id`) accepts:

| Param | Type | Default |
|---|---|---|
| `page` | int ≥ 1 | 1 |
| `limit` | int, 1–100 | 20 |

Plus whatever filters that resource documents below. All query params are
strings on the wire — booleans are the literal strings `"true"`/`"false"`,
not JSON booleans (e.g. `?is_active=true`). An out-of-range `limit`
(e.g. 500) is a **400** (Zod bounds it), not silently clamped.

### 1.9 Money fields are Prisma Decimal → JSON strings

Every money/quantity field backed by a Postgres `Decimal` column
(`amount`, `total`, `total_price`, `quantity`, `salary`, `balance`, ...)
serializes as a **JSON string**, not a number — e.g. `"total_amount": "4000"`,
`"unit_price": "15.5"`. Parse with a decimal-safe library client-side (or
`parseFloat` if you accept float rounding for display only); don't do money
math in JS floats when precision matters, same reasoning the backend follows
with `Prisma.Decimal` throughout.

Request bodies accept plain JSON numbers for these fields (Zod coerces) —
only responses come back as strings.

### 1.10 Append-only tables — no update endpoint, ever

These resources are **create + read only** by design (a correction is a new
offsetting row, never an edit) — there is no `PATCH`/`PUT` route for any of
them, and attempting to build one client-side has nothing to call:
`Purchase`/`PurchaseItem`, `Sale`/`SaleItem`, `BirdSale`, `Payment`,
`Expense`, `Consumption`, `MortalityLog`, `BatchHouseAllocation`,
`PerformanceScoreEntry`, `StockLedger`.

### 1.11 Soft-delete via `is_active` — never a real delete

No endpoint in this API ever hard-deletes a business record (the one literal
`DELETE` route, `/api/item-organizations/:id`, removes a join-table link,
not a business entity). Deactivation uses `POST /:id/deactivate` +
`POST /:id/reactivate` pairs. Two different `is_active` patterns exist —
**don't confuse them**:

- **`Profiles.is_active`** — Admins, Employees, Houses, Items,
  `PaymentInstrument`: deactivating means "this account/record is inactive."
- **The model's own `is_active`** — Suppliers, Customers: deactivating a
  Supplier/Customer flips *their own* `is_active` field, not
  `Profiles.is_active`. A deactivated Supplier's underlying Profile stays
  active — they're a person who exists, just not currently a live supplier
  relationship.

`Warehouses` have no lifecycle endpoints at all (no `is_active` field) —
create + read + rename, full stop. `Doctors` deactivate through their
profile's `is_active` (a doctor's profile is theirs alone), see §4.3.

### 1.12 `idempotency_key` — offline-write safety

These tables carry a unique `idempotency_key`, meant for the mobile app's
offline queue (write locally, sync when back online, retry-safe):
`BatchHouseAllocation`, `MortalityLog`, `Consumption`, `Medications`,
`Vaccinations`, `EnvironmentRecords`, `WeightRecords`,
`InventoryAdjustment`, `PerformanceScoreEntry`. It's an **optional** field
in every create request on these — omit it and the server generates one
(fine for the web dashboard, which writes synchronously); the mobile app's
offline queue should generate and persist one client-side *before* the
first send attempt, so a retried sync can't double-insert. **Sending a
reused `idempotency_key` doesn't error** — the field is simply a
`@unique` column, so a genuine duplicate submission would hit a 409 like
any other unique-constraint collision; a legitimate retry with the *same*
key against a row that already succeeded will still 409 today (there's no
"return the original row instead of erroring" upsert-on-idempotency-key
behavior built yet — treat a 409 that specifically names
`idempotency_key` as "this already went through," not a real failure).

### 1.13 Polymorphic references — not real foreign keys

A few fields reference "some record in some other table, type given
separately," and are **not** enforced by a Postgres FK — a bad value here
won't 400 like §1.7 describes, because the field isn't a foreign key at all,
just an untyped string the server trusts:

- `StockLedger.ref_type` + `ref_id`, `Payment.ref_type` + `ref_id` — e.g.
  `ref_type: "PURCHASE", ref_id: "<a Purchase.id>"`.
- `Alerts.related_id` — no `related_type`; interpret using `Alerts.type`.

### 1.14 Enums quick reference

Every enum used in a request body, spelled exactly as the API expects
(case-sensitive). **Four of these are no longer fixed enums** — `Item.category`,
`Item.unit`/`PurchaseItem.unit`/`SaleItem.unit`, `Expense.category`, and
`Suppliers` supply categories are now database-backed lookup tables a farm
owner can add to/rename/deactivate through Settings. For those four, this
table is replaced with a pointer to the lookup endpoint that returns the
current valid `code`s — see §6.8 for the shared shape and endpoint list.
Everything else below is still a real Prisma enum, fixed at deploy time:

| Enum | Values |
|---|---|
| `UserRole` | `ADMIN`, `EMPLOYEE`, `CUSTOMER`, `SUPPLIER`, `DOCTOR` |
| `EmployeeRoleNames` | *Not an enum any more.* Employee roles are a lookup table (`/api/employee-roles`, seeded `MANAGER`, `WORKER`, `INTERN`). Only `MANAGER` and `WORKER` are granted routes in `lib/permissions.ts`; a role with no rules can sign in but gets `403` on everything except `/auth` |
| `SupplierRoleNames` | `SALES_MAN`, `OWNER`, `DISTRIBUTOR`, `DEALER`, `WHOLESALER`, `RETAILER`, `MANUFACTURER`, `IMPORTER`, `REPRESENTATIVE` |
| Supplier supply categories | no longer a fixed enum — a string matching an active `SupplierSupplyCategory.code`; fetch valid values from `GET /api/supplier-supply-categories?active=true` (§6.8) |
| `HouseType` | `BROODER`, `GROWER`, `LAYER` |
| Units (`Item.unit`, `PurchaseItem.unit`, `SaleItem.unit`) | no longer a fixed enum — a string matching an active `Unit.code`; fetch valid values from `GET /api/units?active=true` (§6.8) |
| `Item.category` | no longer a fixed enum — a string matching an active `ItemCategory.code`; fetch valid values from `GET /api/item-categories?active=true` (§6.8) |
| `StockUnitStatus` (read-only, server-managed) | `UNASSIGNED`, `PRINTED`, `BOUND`, `IN_USE`, `CONSUMED`, `DISPOSED` |
| `AssetStatus` | `ACTIVE`, `RETIRED`, `DISPOSED` |
| `OrganizationRole` | `MANUFACTURER`, `IMPORTER`, `MARKETER`, `DISTRIBUTOR` |
| `BatchStatus` (read-only except via `/close`) | `RUNNING`, `CLOSED`, `SOLD` |
| `Phase` | `BROODER`, `GROWER` |
| `BirdBreeds` | `CLASSIC`, `HIBREED`, `PAKISTHANI`, `KEDERNATH`, `FAOMI`, `TIGER` |
| `AllocationReason` (client-choosable) | `TRANSFER`, `ADJUSTMENT` — `INITIAL` is set internally only, on `Batches` create |
| `TimePeriods` | `MORNING`, `NOON`, `AFTERNOON`, `EVENING`, `NIGHT`, `MIDNIGHT`, `LATENIGHT` |
| `FeedType` | `PRE_STARTER`, `STARTER`, `GROWER`, `FINISHER`, `LAYER` |
| `BirdGrade` | `HIGH`, `LOW`, `CULL` |
| `CostType` | `DIRECT`, `SHARED_PERIOD`, `SHARED_CAPITAL`, `STOCK` (a purchase's own charge — only created through `/purchases`, see §purchase charges) |
| `Expense.category` | no longer a fixed enum — a string matching an active `ExpenseCategoryLookup.code`; fetch valid values from `GET /api/expense-categories?active=true` (§6.8) |
| `PaymentMethod` | `CASH`, `BANK_TRANSFER`, `MFS` |
| `MfsType` | `BKASH`, `NAGAD`, `ROCKET` |
| `PaymentType` (`Payment.direction`) | `INCOMING`, `OUTGOING` |
| `PaymentRefType` | `SALE`, `BIRD_SALE`, `PURCHASE`, `EXPENSE`, `PAYROLL` |
| `AuditAction` | `CREATE`, `UPDATE`, `DELETE` |
| `AlertTypes` | `EMPLOYEE`, `BATCH`, `FEED`, `MEDICINE`, `SYSTEM` |
| `AlertLevels` | `INFO`, `WARNING`, `CRITICAL` |
| `AlertStatus` | `ACTIVE`, `RESOLVED` |
| `AlertActionTypes` | `PAY`, `REASSIGN`, `MARK_RESOLVED` |
| `PerformanceCriterion` | see §12.1 — fixed point values, not freely assignable |

---

## 2. Admins

`Profiles(role=ADMIN)` + `Admins`. Flat permissions — every Admin has full
access, no owner/admin tier.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/admins` | 200 | query: `is_active?` |
| GET | `/api/admins/:id` | 200 | — |
| POST | `/api/admins` | 201 | `{ name, mobile, email?, address? }` |
| PATCH | `/api/admins/:id` | 200 | any subset of the create fields |
| POST | `/api/admins/:id/deactivate` | 200 | — |
| POST | `/api/admins/:id/reactivate` | 200 | — |

`:id` is `Admins.id`, not `Profiles.id`. Response nests the profile:
`{ id, profile_id, created_at, updated_at, profile: { id, name, mobile, email, address, role, is_active, ... } }`.

**Errors**: `GET /:id`, `PATCH /:id`, both deactivate/reactivate → **404**
if `:id` doesn't exist. `POST`/`PATCH` → **409** on duplicate `mobile` or
`email` (`detail` names the field, e.g. `"mobile already in use"`). `PATCH`
with an empty body (no fields changed) → **400**
`"No update fields provided"`.

---

## 3. Employees

`Profiles(role=EMPLOYEE)` + `Employees`. Same shape as Admins plus role/pay
fields.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/employees` | 200 | query: `role?`, `is_active?` |
| GET | `/api/employees/:id` | 200 | — |
| POST | `/api/employees` | 201 | `{ name, mobile, email?, address?, role, salary, joining_date? }` |
| PATCH | `/api/employees/:id` | 200 | `{ name?, mobile?, email?, address?, role?, salary?, rating? }` |
| POST | `/api/employees/:id/terminate`, `/api/employees/:id/reinstate` | 200 | — — the only way to end or restore employment: they move `employment_status` and the profile's `is_active` together (there is no separate deactivate) |
| POST | `/api/employees/:id/reset-password` | 200 | — — admin only; returns a new one-time `temp_password` |

`GET /api/employees` is the roster: it omits the personal file (NID, date of birth,
emergency and reference contacts, religion). `GET /api/employees/:id` returns all of it.

`role` is `EmployeeRoleNames`. `salary` is the baseline used by payroll
(§12) — changing it here only affects *future* `PayrollRecord.generate`
calls, past records stay locked. `rating` (0–5) is update-only, not settable
on create. Response nests `profile` the same way Admins does.

**Errors**: same shape as Admins — **404** on unknown `:id` (get/patch/
deactivate/reactivate), **409** on duplicate `mobile`/`email`, **400** on an
empty `PATCH` body.

---

## 4. Suppliers, Customers, Doctors

### 4.1 Suppliers

`Profiles(role=SUPPLIER)` + `Suppliers`. **Deactivate/reactivate toggle
`Suppliers.is_active` directly, not `Profiles.is_active`** (§1.11).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/suppliers` | 200 | query: `role?`, `supplies?` (single category, array-contains match), `is_active?` |
| GET | `/api/suppliers/:id` | 200 | — |
| POST | `/api/suppliers` | 201 | `{ name, mobile, email?, address?, role, supplies: [string, ...] (min 1) — each a code matching an active SupplierSupplyCategory.code, see §6.8, company? }` |
| PATCH | `/api/suppliers/:id` | 200 | any subset of create fields |
| POST | `/api/suppliers/:id/deactivate` | 200 | — |
| POST | `/api/suppliers/:id/reactivate` | 200 | — |

`role` here is `SupplierRoleNames` (their role at the supplying company —
sales rep, distributor, etc.), unrelated to `EmployeeRoleNames`. `supplies`
with zero entries → **400** at the validator level, before it ever reaches
the database.

**Errors**: **404** unknown `:id`; **409** duplicate `mobile`/`email`;
**400** empty `PATCH` body or empty `supplies` array on create.

### 4.2 Customers

`Profiles(role=CUSTOMER)` + `Customers`. Same `is_active`-is-its-own pattern
as Suppliers.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/customers` | 200 | query: `is_active?` |
| GET | `/api/customers/:id` | 200 | — |
| POST | `/api/customers` | 201 | `{ name, mobile, email?, address?, company? }` |
| PATCH | `/api/customers/:id` | 200 | `{ name?, mobile?, email?, address?, company?, rating? }` |
| POST | `/api/customers/:id/deactivate` | 200 | — |
| POST | `/api/customers/:id/reactivate` | 200 | — |

**Errors**: **404** unknown `:id`; **409** duplicate `mobile`/`email`;
**400** empty `PATCH` body.

### 4.3 Doctors

`Profiles(role=DOCTOR)` + `Doctors`, referenced via `doctor_id` on
Medications/Vaccinations. The model has no `is_active`, so deactivate/reactivate
flip `profile.is_active`; past treatments keep pointing at the doctor. Every
read includes `_count: { medications, vaccinations }`.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/doctors` | 200 | `is_active?: "true"\|"false"` (on the profile), pagination |
| GET | `/api/doctors/:id` | 200 | — |
| POST | `/api/doctors` | 201 | `{ name, mobile, email?, address?, specialty?, position?, degrees?: string[], institution? }` |
| PATCH | `/api/doctors/:id` | 200 | any create field |
| POST | `/api/doctors/:id/deactivate` | 200 | — |
| POST | `/api/doctors/:id/reactivate` | 200 | — |

**Errors**: **404** unknown `:id`; **409** duplicate `mobile`/`email`;
**400** empty `PATCH` body.

---

## 5. Houses

`Houses` — no linked Profile, simplest resource in the API.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/houses` | 200 | query: `type?`, `is_active?`, `is_available?`, `phase?`; each row carries `occupants[] { batch_id, batch_code, batch_status, alive, placed, since, expected_selling_date }` and `last_vacated_at` |
| GET | `/api/houses/:id` | 200 | — |
| POST | `/api/houses` | 201 | `{ name, type, number, capacity? }` |

A house `number` is unique **within a `type`** (Brooder 1 and Grower 1 can coexist); a clash is a **409**.
| PATCH | `/api/houses/:id` | 200 | any subset of create fields, plus `phase` (`READY`/`CLEANING`/`DISINFECTING`/`RESTING`/`MAINTENANCE`). A house whose last bird leaves by sale, transfer or batch close flips `READY` → `CLEANING` on its own; any other phase is left alone |
| POST | `/api/houses/:id/deactivate` | 200 | — |
| POST | `/api/houses/:id/reactivate` | 200 | — |

`capacity` (int, optional) has no enforcement yet — it's descriptive only,
no over-allocation check runs against it currently. There's no unique
constraint on `Houses` at all, so **create cannot 409** — the only errors on
this resource are **404** (unknown `:id`) and **400** (validation, or an
empty `PATCH` body).

---

## 6. Inventory

### 6.1 Items — the catalog

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/items` | 200 | query: `category?`, `is_active?` |
| GET | `/api/items/:id` | 200 | — (also returns `itemOrganizations` links) |
| POST | `/api/items` | 201 | `{ name, category, unit, reorder_level?, preferred_reorder_qty?, lead_time_days?, supplier_ids?: uuid[] }` |
| PATCH | `/api/items/:id` | 200 | any subset of create fields |
| POST | `/api/items/:id/deactivate` | 200 | — |
| POST | `/api/items/:id/reactivate` | 200 | — |
| DELETE | `/api/items/:id` | 200 | — — hard delete, unused items only |

**Don't send `normalized_key`** — it's computed server-side from `name`
(lowercased, trimmed, whitespace-collapsed) specifically to catch
"Amoxicillin" vs "amoxicillin" duplicates; the field isn't even accepted in
the request schema. Renaming an item recomputes it. `supplier_ids`
connects/replaces the item's m2m link to `Suppliers` (full replace on
update, not additive).

**Errors**: **404** unknown `:id`; **409** on create/update if the computed
`normalized_key` collides with an existing item (`detail`:
`"normalized_key already in use"`); **400** if any id in `supplier_ids`
doesn't reference a real Supplier (§1.7), or an empty `PATCH` body.

`DELETE` is for mis-created rows (typo, duplicate) only. It refuses with
**409** (`detail`: `"Item has recorded history and cannot be deleted.
Deactivate it instead."`) as soon as any `PurchaseItem`, `StockLedger`,
`Consumption`, `SaleItem`, `BatchFeedingProgram`, `InventoryAdjustment` or
`StockTransfer` references the item — history always keeps its item row, so
nothing anywhere ends up pointing at a missing one. An item that is in use
is retired with `deactivate`, which hides it from pickers and low-stock
while every past record still resolves. `ItemUnit`, `ItemOrganization` and
`Suppliers` links are configuration, not history: they cascade away with a
deleted item and don't block the delete.

### 6.2 Warehouses

Deliberately minimal — no deactivate (§1.11). Just a named location, plus a
guarded delete for mis-created ones.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/warehouses` | 200 | — |
| GET | `/api/warehouses/:id` | 200 | — |
| POST | `/api/warehouses` | 201 | `{ name }` |
| PATCH | `/api/warehouses/:id` | 200 | `{ name }` (rename only) |
| DELETE | `/api/warehouses/:id` | 200 | — — hard delete, unused warehouses only |

**Errors**: **404** unknown `:id`; **400** empty `PATCH` body. No unique
constraint on `name` → create can never 409.

`DELETE` exists because there is no `is_active` to retire a typo with, and
it is guarded for the same reason it didn't exist before: `InventoryAdjustment`
is `onDelete: Cascade`, so an unguarded delete would take adjustment history
with it. It refuses with **409** (`detail`: `"Warehouse has recorded stock
history and cannot be deleted. Rename it instead."`) if any `Purchase`,
`InventoryAdjustment`, or location-tagged `StockLedger` row points at it —
which also covers transfers, since every transfer writes a ledger row tagged
at each endpoint. A warehouse that has held stock is renamed, never removed.

### 6.3 Organizations + Item↔Organization links

Recall-tracing: which manufacturer/importer/distributor an item's lot came
from. Same server-computed `normalized_key` pattern as Items.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/organizations` | 200 | — |
| GET | `/api/organizations/:id` | 200 | includes `itemLinks: [{ item, role }, ...]` |
| POST | `/api/organizations` | 201 | `{ label_name }` |
| PATCH | `/api/organizations/:id` | 200 | `{ label_name }` |
| POST | `/api/item-organizations` | 201 | `{ item_id, organization_id, role: OrganizationRole }` |
| DELETE | `/api/item-organizations/:id` | 200 | — (removes the link row, not the Item or Organization) |

**Errors**: `/organizations` → **404** unknown `:id`; **409** duplicate
`normalized_key`; **400** empty `PATCH`. `/item-organizations` create →
**400** bad `item_id`/`organization_id` (§1.7); **409** if
`(item_id, organization_id, role)` already exists (linking the same trio
twice). `DELETE` → **404** if the link `:id` doesn't exist.

### 6.4 StockUnit — the QR-code-per-unit lifecycle

Coded tracking for medicine/vaccine/equipment (feed and other bulk items use
the aggregate `StockLedger`, §6.6, instead). Status only ever moves forward:
`UNASSIGNED → PRINTED → BOUND → IN_USE → CONSUMED` (or `→ DISPOSED` from almost any
state). **The client never sets `status` directly** — it's a side effect of
which action endpoint you call.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/stock-units` | 200 | query: `status?`, `house_id?` |
| GET | `/api/stock-units/:id` | 200 | — |
| GET | `/api/stock-units/code/:code` | 200 | look up by the printed code — this is the QR-scan endpoint |
| POST | `/api/stock-units` | 201 | `{ count: int 1-1170 }` — provisions that many blank codes, `status: UNASSIGNED` |
| POST | `/api/stock-units/mark-printed` | 200 | `{ ids: uuid[1-1170] }` — `UNASSIGNED → PRINTED` once the print is confirmed; ids in any other status are skipped. Returns `{ updated }` |
| POST | `/api/stock-units/:id/bind` | 200 | `{ purchase_item_id, initial_quantity?, bound_by_id? }` |
| POST | `/api/stock-units/:id/relocate` | 200 | `{ house_id }` |
| POST | `/api/stock-units/:id/dispose` | 200 | — |
| POST | `/api/stock-units/:id/use` | 200 | `{ action: START\|FINISH, house_id, batch_id?, date, idempotency_key? }` — "Use an item". `START`: `BOUND → IN_USE`, no Consumption. `FINISH`: `BOUND/IN_USE → CONSUMED`, logs a Consumption of what was left in the unit (ledger OUT from the house). The unit must be in `house_id` (**409** otherwise); equipment can't `FINISH` (**400**, dispose it) |
| POST | `/api/stock-units/bulk` | 200 | `{ action: FINISH\|START\|MOVE\|RETURN\|DISPOSE, house_id? (not RETURN/DISPOSE), date? (FINISH), units: [{ id, idempotency_key? }] (1-25) }` — stock count: one action for many missing units, manager only. Each unit runs the same `/use` (with `move_here`), `/relocate` or `/dispose` in its own transaction; returns `{ results: [{ id, ok: true } \| { id, ok: false, status, message }] }`, so one refused unit (finalised batch, already disposed) doesn't undo the rest. Retry with the same `idempotency_key`s |

`initial_quantity` on bind is the depleting amount (e.g. 1000 mL in a
bottle) — omit it for non-depleting equipment; `remaining_quantity` mirrors
it and only moves via `Consumption` (§9.1), never a direct PATCH here.
Provisioning returns an **array** of the newly created units (each with its
own `code` and `id`) — that's what you print as QR labels. `count` outside
1–1170 → **400** before any codes are generated.

**Errors**: **404** unknown `:id`/`:code` on any of the `GET`/action
routes. `bind` → **409** if the unit's current status isn't `PRINTED`
(`detail`: `"Print this code and confirm it printed before binding it"` for
`UNASSIGNED`, else `"StockUnit is already <status, lowercased>"`); **400** if
`purchase_item_id` or `bound_by_id` doesn't reference a real row (§1.7).
`relocate` → **400** if `house_id` doesn't exist. `dispose` → **409** if
already `DISPOSED`.

### 6.5 Assets

Equipment tracking, 1:1 with a `StockUnit` (`stock_unit_id` unique — binding
a second Asset to the same unit 409s).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/assets` | 200 | query: `status?` |
| GET | `/api/assets/:id` | 200 | includes `stock_unit` |
| POST | `/api/assets` | 201 | `{ stock_unit_id, name, purchase_cost, purchase_date, useful_life_batches }` |
| PATCH | `/api/assets/:id/status` | 200 | `{ status: AssetStatus }` |
| DELETE | `/api/assets/:id` | 200 | — — hard delete, un-depreciated assets only |

`useful_life_batches` feeds `AssetDepreciation`'s formula (§11.2) — set it
thoughtfully, it can't be corrected after the fact for already-computed
depreciation rows (those stay locked).

**Errors**: **404** unknown `:id`. Create → **400** if `stock_unit_id`
doesn't reference a real `StockUnit` (§1.7); **409** if that `StockUnit`
already has an Asset (`stock_unit_id` is unique).

`DELETE` undoes a mis-registration (wrong unit, duplicate): **409**
(`detail`: `"Asset has depreciation history and cannot be deleted. Retire it
instead."`) once any `AssetDepreciation` row exists — a depreciated asset is
moved to `RETIRED`/`DISPOSED` via the status endpoint instead. The `StockUnit`
is never touched: deleting the Asset frees its unique `stock_unit_id` so the
unit can be registered again, and unblocks `DELETE /api/stock-units/:id`,
which refuses while a linked Asset exists.

### 6.6 StockLedger — read-only

Aggregate balance ledger for non-coded items (feed, etc.). **No POST route
exists at all** — entries are written internally by `Consumption` (§9.1) and
`InventoryAdjustment` (§6.7) as a side effect, never posted directly.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/stock-ledger` | 200 | query: `item_id?`, `direction?` (`IN`/`OUT`), `reason?` (`StockReason`) |

Current balance for an item = sum of `IN` minus sum of `OUT` — there's no
single "current balance" field anywhere, compute it client-side from this
list if needed (or use `GET /api/alerts/scan`, §13, which does this
server-side for reorder-level checking). **No errors beyond generic 400
validation** — this endpoint can't 404 or 409, it's a pure filtered list.

### 6.7 Inventory Adjustments

Manual stock corrections — the one client-writable path into `StockLedger`
(via a paired entry the server creates automatically in the same
transaction).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/inventory-adjustments` | 200 | query: `item_id?` |
| POST | `/api/inventory-adjustments` | 201 | `{ item_id, warehouse_id? or house_id? (at least one; house wins if both), quantity_after, reason: string, note?, idempotency_key? }` — `quantity_before` is accepted but ignored |

The server reads the current balance from the stock ledger, so `quantity_before`
on the stored row is the real balance, and `adjustment_quantity`
(= `quantity_after - balance`) is computed from it. The paired `StockLedger`
entry's direction follows the sign. The reasons `"Wastage"` and `"Expired"` are
recorded on the ledger as `WASTAGE` and `EXPIRED`; any other reason is
`ADJUSTMENT`. Only the location actually used is stored on the row. Stock that
arrives (QR-tracked or not) comes in through a purchase, not an adjustment.

**Errors**: **400** if `quantity_after` equals the current balance (nothing to
adjust); **400** if
`item_id`/`warehouse_id`/`house_id` don't reference real rows (§1.7); **400** if
neither `warehouse_id` nor `house_id` is given.

### Deactivated items and houses

Deactivating is how something that has been used is retired, and it has teeth: a **deactivated item**
is refused (**400**) on consumption, transfers and sales, but can still be purchased. A **deactivated
house** is refused on consumption, mortality logs, bird sales, and as the *destination* of a stock
transfer or a bird move; stock and birds can still be moved **out** of it, which is how it is emptied.
Hard delete is for mistakes only: the database refuses to delete anything with history attached.

### 6.8 Lookup tables — categories & units (formerly fixed enums)

`Item.category`, `Item.unit`/`PurchaseItem.unit`/`SaleItem.unit`,
`Expense.category`, and `Suppliers`' supply categories used to be fixed
Prisma enums; they're now database-backed lookup tables a farm owner can
add to, rename, or deactivate through Settings, with every referencing
record's foreign key following a rename automatically (`onUpdate: Cascade`
on the Postgres FK — renaming `ItemCategory.code` from `FEED` to
`ANIMAL_FEED` rewrites every `Item.category = 'FEED'` row to `ANIMAL_FEED`
in the same statement, no app-level migration needed).

All four lookup resources — `item-categories`, `units`, `expense-categories`,
`supplier-supply-categories` — share one identical shape:

**Row shape**: `{ id, code, label, is_active, created_at, updated_at }`.
`code` is server-derived from `label` (uppercased, non-alphanumerics
stripped, whitespace collapsed to `_` — e.g. `"Cleaning Supplies"` →
`CLEANING_SUPPLIES`) and is what every referencing field above actually
stores; **you never send `code` directly**, on create or update.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/item-categories` | 200 | query: `active?` (`"true"`/`"false"`) |
| POST | `/api/item-categories` | 201 | `{ label }` |
| PATCH | `/api/item-categories/:id` | 200 | `{ label }` — changes the label only; `code` is fixed at create and never moves |
| POST | `/api/item-categories/:id/deactivate` | 200 | — |
| POST | `/api/item-categories/:id/reactivate` | 200 | — |

Same 5-route shape, swap the base path:

| Resource | Base path |
|---|---|
| Item categories (`Item.category`) | `/api/item-categories` |
| Units (`Item.unit`, `PurchaseItem.unit`, `SaleItem.unit`) | `/api/units` |
| Expense categories (`Expense.category`) | `/api/expense-categories` |
| Supplier supply categories (`Suppliers` supplies) | `/api/supplier-supply-categories` |

A deactivated row (`is_active: false`) still satisfies existing FK
references (nothing referencing it breaks), but should be filtered out of
any client-side "pick a category" dropdown — that's what `?active=true`
is for. Deactivating a code currently in use on records doesn't retroactively
change or block anything; it only stops it from being offered for new picks.

**Errors** (all four resources, same rules): **404** unknown `:id` on
`PATCH`/deactivate/reactivate; **400** if the label has no letters or
digits at all (`detail`: `"Label must contain at least one letter or
number"` — an empty `code` would result); **409** if the derived `code`
collides with an existing row's `code` (`detail`: `"code already in use"`).

---

## 7. Batches

The core physical/financial unit of the farm. `Batches`,
`BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`. This is where
money-adjacent balance math lives — read `PROGRESS.md`'s Phase 6 entry if
something here surprises you.

### 7.1 Batches

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/batches` | 200 | query: `status?`, `breed?`, `phase?` |
| GET | `/api/batches/:id` | 200 | includes `houseBalances: [{ house_id, quantity, house }]` |
| POST | `/api/batches` | 201 | see below |
| PATCH | `/api/batches/:id` | 200 | `{ batch_code?, breed?, phase?, expected_selling_date? }` |
| POST | `/api/batches/:id/close` | 200 | `{ status: "CLOSED" \| "SOLD", force?: boolean }` |

**Create body**: `{ batch_code, breed, starting_date?, expected_selling_date, initial_chick_count, init_chicks_avg_wt, house_id, recorded_by_id }`.
This single call creates the `Batches` row **and** an `INITIAL`
`BatchHouseAllocation` **and** the starting `BatchHouseBalance` in one
transaction — "chicks arrive" is one atomic event, not three separate calls.

**Close**: requires every `BatchHouseBalance` row for this batch to sum to
zero (all birds accounted for via sales/mortality/transfers out) —
otherwise **409** with the exact remaining count in the message (e.g.
`"Batch still has 700 live birds allocated -- pass force:true to close
anyway"`). Pass `force: true` to close anyway (birds get written off, no
reconciliation). Closing also **fires the `AssetDepreciation` trigger**
(§11.2) for every `ACTIVE` Asset whose `StockUnit` this batch consumed —
automatic, no separate call, and the whole thing (status update + every
depreciation row) is one transaction. Closing is one-way: no endpoint
reopens a batch.

**Errors**: **404** unknown `:id`. Create → **409** duplicate `batch_code`;
**400** if `house_id`/`recorded_by_id` don't exist (§1.7). `PATCH` → **409**
if the batch isn't currently `RUNNING` (`detail`: `"Cannot edit a batch
that isn't RUNNING"`); **400** empty body. `close` → **409** if not
`RUNNING`, or (without `force`) if balances haven't reconciled to zero.

### 7.2 Batch House Allocations — transfers & corrections

One algorithm covers both `TRANSFER` (moving birds between houses) and
`ADJUSTMENT` (a headcount correction): **decrements `from_house_id`'s
balance if set, increments `to_house_id`'s if set** — set only one for a
one-directional correction, both for a real transfer.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/batch-house-allocations` | 200 | query: `batch_id?` |
| POST | `/api/batch-house-allocations` | 201 | `{ batch_id, from_house_id?, to_house_id? (at least one), quantity: positive int, reason: "TRANSFER" \| "ADJUSTMENT", recorded_by_id, idempotency_key? }` |

**Errors**: **400** if neither `from_house_id` nor `to_house_id` is given
(validator-level); **404** if `batch_id` doesn't exist (this one *is* a 404,
not a 400 — it's checked explicitly inside the service before the
transaction, not via the generic FK-violation path); **409** if the batch
isn't `RUNNING`; **409** if `from_house_id` doesn't have enough birds for
the requested `quantity` (`detail`: `"Insufficient birds in source house
for this move"` — the transaction rolls back cleanly on this, no partial
write, verified in tests); **400** if `from_house_id`/`to_house_id` don't
reference real Houses (§1.7).

### 7.3 Batch House Balances — read-only

The live "how many birds of batch X are in house Y" cache. Never written
directly — only `Batches.create`, `BatchHouseAllocation.create`, and
`MortalityLog.create` (and `BirdSale.create`, §10.2) touch it, always inside
their own transaction.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/batch-house-balances` | 200 | query: `batch_id?`, `house_id?` |

Good endpoint for an occupancy-grid view (all batches × all houses at once).
**No errors beyond generic 400 validation** — pure filtered list, can't 404
or 409.

### 7.4 Mortality Log

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/mortality-logs` | 200 | query: `batch_id?`, `house_id?` |
| POST | `/api/mortality-logs` | 201 | `{ batch_id, house_id, count_died: positive int, cause_note?, date, recorded_by_id, idempotency_key? }` |

Decrements the batch-house balance in the same transaction as the log row.

**Errors**: **409** if `count_died` exceeds that house's current live
balance for the batch (`detail`: `"Mortality count exceeds live birds in
this house"` — nothing written on rejection, verified via rollback test);
**400** if `batch_id`/`house_id`/`recorded_by_id` don't reference real rows
(§1.7).

---

## 8. Purchases

`Purchase` + `PurchaseItem`. **Append-only** (§1.10) — create, list, get,
never update. The one way back is removing a purchase entered by mistake (`DELETE` below), and re-entering it.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/purchases` | 200 | query: `supplier_id?` |
| GET | `/api/purchases/:id` | 200 | includes `items: [{ ..., item }]`, `supplier`, `charges` (its `STOCK` expenses) |
| POST | `/api/purchases` | 201 | see below |
| POST | `/api/purchases/:id/charges` | 201 | `{ category, amount, remarks?, paid_amount?, paid_from_instrument_id?, date? (default now) }` — a charge added later |
| DELETE | `/api/purchases/:id` | 200 | Removes a purchase entered by mistake with everything it posted (stock IN, payments, charges and their payments); full record kept in the audit log. 409 if QR units are bound to it or its warehouse stock was already used or moved, or for an opening-balance lot |
| GET | `/api/purchase-items` | 200 | query: `item_id?`, `batch_id?` — cross-purchase lot lookup |

**Create body**:
```
{
  supplier_id?, invoice_no?, purchase_date, paid_amount? (default 0), paid_from_instrument_id?,
  payment_date?, payment_transaction_ref?, payment_note?, recorded_by_id,
  items: [{ item_id, batch_id?, quantity, unit, unit_price, mfg_date?, expiration_date? }, ...] (min 1),
  charges?: [{ category, amount, remarks?, paid_amount?, paid_from_instrument_id? }, ...] (max 10)
}
```
**Purchase charges (landed cost).** Transport, labour, unloading paid for a purchase are
`charges`: each is an `Expense` with `cost_type: STOCK` and `purchase_id`, written in the
purchase's transaction (with its paid-at-create `Payment`). They're split over the purchase's
lines **by value** and added to the stock's average cost, so whatever consumes that stock
(batch P&L, farm P&L, stock value) pays the real per-unit price; a chick line's share lands on
its batch. Computed on read — a charge added later via `/charges` re-costs stock already used.
`STOCK` expenses are left out of expense cost lines, the monthly expense figure, the expense
breakdown and revenue-vs-expenses (they're inside stock cost), but still count as money paid and
owed.
`total_price` per line and `total_amount` for the purchase are computed
server-side (`quantity × unit_price`, summed) — don't send them, they're not
accepted by the request schema at all. `due_amount = total_amount -
paid_amount`. Set `batch_id` on a line item when the purchase funds a
specific batch (chicks) — this is how `Batches`/`PurchaseItem` link
financially. A `paid_amount` is written as a `Payment` from `paid_from_instrument_id`
in the same transaction (dated `payment_date`, default `purchase_date`).

**Errors**: **404** unknown `:id` on get. Create → **400** if `paid_amount`
exceeds the computed `total_amount` (`detail`: `"paid_amount cannot exceed
the purchase total"` — this check runs *before* any database write, so
nothing is created); **400** if any line's `item_id`/`batch_id` or the
top-level `supplier_id`/`recorded_by_id` don't reference real rows (§1.7);
**400** if `items` is empty (validator-level).
`GET /purchase-items` has no errors beyond generic validation.

**Note**: `Purchase.due_amount` is a locked snapshot at creation — recording
a `Payment` (§15.2) against a purchase later does **not** update it. Compute
"how much is actually still owed" via
`GET /api/payments/total-paid?ref_type=PURCHASE&ref_id=<purchase.id>`
(§15.2) and subtract from `due_amount` client-side.

---

## 9. Treatment & Monitoring

### 9.1 Consumption — the stock-draw event

Two behaviors depending on whether `stock_unit_id` is set — **this is the
most important branch in the whole API to understand correctly**:

- **Coded draw** (`stock_unit_id` set — medicine/vaccine/equipment):
  decrements `StockUnit.remaining_quantity`; flips status
  `BOUND → IN_USE`, or `→ CONSUMED` at exactly zero. Equipment
  (`remaining_quantity` was never set) just flips to `IN_USE` once,
  non-depleting.
- **Aggregate draw** (no `stock_unit_id` — feed, etc.): no `StockUnit`
  touched at all; writes a `StockLedger` `OUT` entry instead.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/consumptions` | 200 | query: `batch_id?`, `house_id?`, `item_id?` |
| POST | `/api/consumptions` | 201 | `{ batch_id?, house_id, item_id, stock_unit_id?, quantity, date, note?, recorded_by_id, idempotency_key? }` |

**Errors** (coded-draw path only, when `stock_unit_id` is set): **404** if
that `StockUnit` doesn't exist; **409** if its status isn't `BOUND` or
`IN_USE` (`detail`: `"StockUnit is <status>, cannot draw from it"`); **409**
if `quantity` exceeds `remaining_quantity` (`detail`: `"Consumption
quantity exceeds remaining stock in this unit"`). **Both paths**: **400** if
`batch_id`/`house_id`/`item_id`/`recorded_by_id` don't reference real rows
(§1.7).

### 9.2 Medications / Vaccinations

Nearly identical shape; `dosage` is free-text on Medications, an integer
count on Vaccinations. Both optionally link back to the `Consumption` row
the dose was drawn from.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/medications` | 200 | query: `batch_id?` |
| POST | `/api/medications` | 201 | `{ batch_id, consumption_id?, medicine_name, dosage: string, cause?, period?, administered_by_id, doctor_id?, remarks?, date?, idempotency_key? }` |
| GET | `/api/vaccinations` | 200 | query: `batch_id?` |
| POST | `/api/vaccinations` | 201 | `{ batch_id, consumption_id?, vaccine_name, dosage: positive int, cause?, period?, administered_by_id, doctor_id?, remarks?, date?, idempotency_key? }` |

**Errors** (both resources): **400** if `batch_id`/`consumption_id`/
`administered_by_id`/`doctor_id` don't reference real rows (§1.7). No
409s possible — no unique constraints on either table.

### 9.3 Environment Records

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/environment-records` | 200 | query: `batch_id?`, `house_id?` |
| POST | `/api/environment-records` | 201 | `{ batch_id, house_id, temperature_c, humidity_percent, ammonia_ppm, co2_ppm, air_pressure_hpa, time_period: TimePeriods, recorded_by_id, idempotency_key? }` |

**Errors**: **400** if `batch_id`/`house_id`/`recorded_by_id` don't
reference real rows (§1.7). No 409s — no unique constraint.

### 9.4 Weight Records

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/weight-records` | 200 | query: `batch_id?`, `house_id?` |
| POST | `/api/weight-records` | 201 | `{ batch_id?, house_id, average_wt_grams, sample_size: positive int, date, measured_by_id, idempotency_key? }` |

`date` is stored as the farm-local day (Asia/Dhaka): send any instant (or `YYYY-MM-DD`) and the server files it under that day. One sample per batch + house per day, and one per house per day when there is no batch; a second is a **409**.

`(batch_id, house_id, date)` is unique — a second sample logged for the same
batch+house+day 409s instead of silently overwriting. If retrying a failed
submission, don't just resend the same date; surface the 409 as "already
logged today" in the UI.

**Errors**: **409** duplicate `(batch_id, house_id, date)`; **400** if
`batch_id`/`house_id`/`measured_by_id` don't reference real rows (§1.7).

### 9.5 Batch Feeding Program

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/batch-feeding-programs` | 200 | query: `batch_id?` |
| POST | `/api/batch-feeding-programs` | 201 | `{ batch_id, feed_type: FeedType, item_id, start_day: int ≥0, end_day?: int ≥0 }` |
| PATCH | `/api/batch-feeding-programs/:id` | 200 | `{ end_day: int ≥0 }` — the **only** editable field |

No actor field on this one (no `recorded_by_id`) — it's a planning record,
not a field-execution log.

**Errors**: **404** unknown `:id` on `PATCH`; **400** if `batch_id`/
`item_id` don't reference real rows on create (§1.7). No 409s — no unique
constraint.

---

## 10. Sales

`Sale`/`SaleItem` (non-bird items) + `BirdSale`. Both **append-only**
(§1.10).

### 10.1 Sale (regular items — feed surplus, culls, manure, etc.)

Exact mirror of Purchases' money-math pattern.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/sales` | 200 | query: `customer_id?`, `date_from?`, `date_to?`, `item_category?` (a string matching an `ItemCategory.code`, §6.8) |
| GET | `/api/sales/:id` | 200 | includes `items`, `customer` |
| POST | `/api/sales` | 201 | `{ customer_id?, sale_date, paid_amount? (default 0), recorded_by_id, items: [{ item_id, quantity, unit, unit_price }, ...] (min 1) }` |

`total`/line `total_price`/`due_amount` computed server-side, same as
Purchases.

**Errors**: **404** unknown `:id`. Create → **400** if `paid_amount`
exceeds the computed total (nothing written); **400** if `customer_id` or
any line's `item_id` don't reference real rows (§1.7); **400** if `items`
is empty.

### 10.2 BirdSale

The batch's actual product sale — **decrements `BatchHouseBalance`**, one
of only three things allowed to (with `MortalityLog` and
`BatchHouseAllocation`).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/bird-sales` | 200 | query: `batch_id?`, `customer_id?`, `date_from?`, `date_to?`, `grade?` (`BirdGrade`) |
| GET | `/api/bird-sales/:id` | 200 | includes `houses: [{ house_id, birds_count }]` (list rows too) |
| POST | `/api/bird-sales` | 201 | see below |

**Create body**:
```
{
  batch_id, house_id? or houses?: [{ house_id, birds_count }],
  customer_id?, sale_date, grade: BirdGrade,
  male_count?, female_count?, birds_count,
  dholta_in_g, total_katha, avg_wt_per_katha_kg?,
  total_weight, net_weight, avg_weight_g?,
  price_per_kg, paid_amount? (default 0), paid_to_instrument_id?,
  discount_amount?, labour_cost?, labour_paid_from_instrument_id?
}
```
Exactly one of `house_id` (every bird from that house) or `houses` (a split
across several, each house once, counts summing to `birds_count`). Each house's
balance is checked and decremented in the same transaction -- one house short
is a **409** and nothing is written.
`total_katha` is the crate count and may be fractional (a part-filled last
crate the operator didn't round). `labour_cost` books a DIRECT `LABOR`
expense on the batch in the same transaction, paid from
`labour_paid_from_instrument_id` when given (400 if that is sent without a cost).
**Only `total_amount` (`= net_weight × price_per_kg`) and `due_amount` are
server-computed.** Every regional field (`dholta_in_g`, `total_katha`,
`avg_wt_per_katha_kg`, `avg_weight_g`) is stored exactly as sent — the API
deliberately doesn't try to derive them from each other (unit-conversion
ambiguity the team didn't have full context on; see `PROGRESS.md` Phase 9).

**Errors**: **404** unknown `:id` on get. Create → **400** if `male_count`
+ `female_count` are both given and don't sum to `birds_count`
(validator-level, before any database call); **400** if the computed
`total_amount` is less than `paid_amount`; **409** if `birds_count` exceeds
the house's live balance for that batch (`detail`: `"Sale quantity exceeds
live birds in this house"` — nothing written on rejection); **400** if
`batch_id`/`house_id`/`customer_id`/`recorded_by_id` don't reference real
rows (§1.7).

---

## 11. Finance

### 11.1 Expense

Append-only (§1.10).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/expenses` | 200 | query: `batch_id?`, `category?`, `cost_type?`, `date_from?`, `date_to?` |
| GET | `/api/expenses/:id` | 200 | — |
| POST | `/api/expenses` | 201 | `{ batch_id?, category: string (a code matching an active ExpenseCategoryLookup.code, §6.8), cost_type: CostType, amount, date, remarks?, paid_amount?, paid_from_instrument_id?, recorded_by_id }` -- `paid_amount` (≤ `amount`) is written as a `Payment` from that account in the same transaction; refused for SALARY/FESTIVAL_BONUS/SALARY_TRANSFER_FEE, which payroll pays |

A `DIRECT` cost must carry a `batch_id` (**400** otherwise); costs that belong to no batch are `SHARED_PERIOD` or `SHARED_CAPITAL`.

`cost_type = SHARED_PERIOD` expenses (electricity, rent, internet) are shared out between
the batches that were on the farm, in proportion to **bird-days** in the expense's calendar
month. The split is computed on read and never stored, so a late mortality entry or a
re-dated sale changes it. A month with no birds stays farm overhead. `SHARED_CAPITAL`
(buildings, big equipment) is not a running cost and is not shared. See
`GET /api/analytics/shared-costs` and the statement in §14.3.

**Errors**: **404** unknown `:id`. Create → **400** if `batch_id`/
`recorded_by_id` don't reference real rows (§1.7). No 409s — no unique
constraint on this table.

### 11.2 Asset Depreciation — read-only

Never posted directly. Rows are written automatically by
`POST /api/batches/:id/close` (§7.1) for every `ACTIVE` Asset whose
`StockUnit` the closing batch consumed (via `Consumption`,
`amount = purchase_cost / useful_life_batches`).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/asset-depreciations` | 200 | query: `asset_id?`, `batch_id?` |

**No errors beyond generic 400 validation** — pure filtered list, no POST
route exists for it at all.

---

## 12. Payroll

### 12.1 Performance Score Entries

Fixed point value **per criterion**, looked up server-side — the client
cannot set `points` for a normal criterion (sending one is silently
ignored; the server snapshots the fixed value regardless). `OTHER` is the
one escape hatch: client supplies `points`, validator bounds it to ±1–5
(excluding 0).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/performance-score-entries` | 200 | query: `employee_id?` |
| POST | `/api/performance-score-entries` | 201 | `{ employee_id, given_by_id, criterion: PerformanceCriterion, points? (OTHER only), reason, date?, idempotency_key? }` |

Fixed point table (send `criterion`, never `points`, for any of these):

| Criterion | Points | | Criterion | Points |
|---|---|---|---|---|
| `ATTENDANCE_PERFECT` | +3 | | `FALSIFIED_RECORD` | -5 |
| `EARLY_PROBLEM_REPORT` | +3 | | `NEGLIGENT_LOSS` | -5 |
| `SUGGESTION_IMPLEMENTED` | +3 | | `BIOSECURITY_VIOLATION` | -4 |
| `TEAM_TARGET_HIT` | +3 | | `CONCEALED_PROBLEM` | -4 |
| `ZERO_NEGLIGENT_LOSS` | +2 | | `MISSED_CRITICAL_TASK` | -3 |
| `ACCURATE_DATA_ENTRY` | +2 | | `EQUIPMENT_DAMAGE` | -3 |
| `BIOSECURITY_FOLLOWED` | +2 | | `CONDUCT_ISSUE` | -3 |
| `HELPED_COWORKER` | +2 | | `TEAM_SUPERVISION_FAILURE` | -3 |
| `EXTRA_TASK_COMPLETED` | +2 | | `UNEXCUSED_ABSENCE` | -2 |
| `CONFLICT_RESOLVED` | +2 | | `PATTERN_LATENESS` | -2 |
| `OTHER` | client sends ±1 to ±5 (not 0) | | | |

**Errors**: **400** if `criterion: "OTHER"` and `points` is missing, `0`, or
outside ±5 (validator-level, before any database call); **400** if
`employee_id`/`given_by_id` don't reference real rows (§1.7). No 409s — no
unique constraint on this table.

### 12.2 Payroll Records

Manual, admin-triggered month-end action (there's no cron). Locked snapshot
per `(employee_id, month)` — regenerating throws 409, and there's no update
endpoint; if the baseline salary or a criterion's points change later, past
months' `PayrollRecord`s stay exactly as computed.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/payroll-records` | 200 | query: `employee_id?` |
| POST | `/api/payroll-records/generate` | 201 | `{ employee_id, month }` |

`month` can be any date within the target month (normalized server-side to
the 1st). Sums that month's `PerformanceScoreEntry.points` for the
employee, clamps to **[-10, +20]** as `adjustment_percent`, applies to the
employee's *current* `Employees.salary` as `baseline_salary`, computes
`final_salary = baseline_salary × (1 + adjustment_percent / 100)`.

**Errors**: **404** if `employee_id` doesn't reference a real Employee
(checked explicitly, not via the generic FK path — same reasoning as
`BatchHouseAllocation`'s `batch_id` check in §7.2); **409** if a
`PayrollRecord` already exists for that `(employee_id, month)`.

---

### 12.3 Festival bonus

All admin-only. Design: `docs/superpowers/specs/2026-09-30-festival-bonus-design.md`.
The flow is propose, then commit; nothing is written until the second call.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/bonus-events` | `{ name, event_date, religion?, multiplier, min_service_months? (12), prorate? (true) }` — creates the event only. `religion` omitted = farm-wide. `multiplier` is × the employee's reference salary (R). |
| GET | `/api/bonus-events`, `/api/bonus-events/:id` | The detail carries each granted bonus with its payout status. |
| GET | `/api/bonus-events/:id/proposal` | **Computes only, writes nothing.** `{ event, rows[] }`, every non-terminated employee with `service_months`, `full_amount`, `proposed_amount`, `selected` and a `reason` when unticked. Ticked: CONFIRMED, religion matches (or the event is farm-wide), and enough service — or prorated `multiplier × R × service_months / 12` when `prorate` is on. Religion not recorded is listed, never ticked and never dropped. Already-granted employees show `already_granted`. |
| POST | `/api/bonus-events/:id/bonuses` | `{ bonuses: [{ employee_id, amount, note? }] }` — the owner may adjust `amount`; the salary and service months stored beside it are computed by the server. **409** if an employee already has a bonus at this event. |

A granted bonus is paid through the same payout path as a wage:
`POST /api/payroll-payouts` with `{ bonus_id }` (instead of `payroll_record_id`;
exactly one is required), then `POST /api/payroll-payouts/:id/mark-paid` with the
transfer reference. Confirming writes a `FESTIVAL_BONUS` expense plus the transfer-fee
expense and one `PAYROLL` payment. The payout table is `EmployeePayout` (formerly
`PayrollPayout`); the URL is unchanged.

`Employees.religion` (`ISLAM|HINDU|CHRISTIANITY|BUDDHISM|OTHER`, optional) is returned only
by the single-employee endpoints and the proposal — never the employee list, payslip, or
payroll records.

---

## 13. Alerts

Alerts come from a **reconciliation scan**, not live hooks on every write. The server
runs it in the background every `ALERT_SCAN_INTERVAL_MS` (10 minutes by default, `0` turns
it off), and `POST /api/alerts/scan` runs it on demand. Don't expect an alert the instant a
condition becomes true elsewhere in the API: it appears on the next scan.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/alerts` | 200 | query: `type?`, `level?`, `status?` |
| GET | `/api/alerts/:id` | 200 | — |
| POST | `/api/alerts` | 201 | `{ title, description?, type: AlertTypes, level: AlertLevels, related_id?, action_type? }` — manual alert |
| POST | `/api/alerts/:id/resolve` | 200 | — |

### Notifications

A person's own inbox: things that happened *to them*, as opposed to alerts (conditions the farm should look
at, shared by role). Every endpoint is scoped to the caller; there is no way to name someone else's.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/notifications` | query: `status?` (`all` default, or `unread`), `page`, `limit`. Newest first. |
| GET | `/api/notifications/unread-count` | `{ count }` |
| POST | `/api/notifications/read-all` | `{ updated }` |
| POST | `/api/notifications/:id/read` | 404 for anyone else's. Idempotent. |

Row: `{ id, kind, title, body, related_id, read_at, created_at }`. `kind` is `TASK_ASSIGNED`, `POINTS_GIVEN`,
`POINTS_VOIDED`, `PAYSLIP_READY`, `PAYOUT_CONFIRMED`, `PAYOUT_FAILED`, `BONUS_GRANTED`, `PASSWORD_CHANGED` or
`PASSWORD_RESET`; `related_id` is the task, score entry, payroll record, payout or bonus it is about.
They are written by the services that do the work (assigning a task, giving or voiding points, generating
payroll, confirming or failing a payout, granting a bonus, changing or resetting a password), best effort:
a notification that fails to save never fails the action. Words live in `lib/notification-messages.ts`.

**Who sees what.** Every alert carries an `audience` (employee role codes). Admins see all alerts; an
employee sees only those whose audience names their role, on both the list (and its `total`) and
`/:id`. An empty audience is admin-only (payroll, payouts). Manual alerts are `["MANAGER"]`.

**What the scan raises** (`alert.service.ts`, thresholds in `lib/alert-rules.ts`): mortality per house
(Warning over 0.5%, Critical over 1% of live birds in 24h; workers + managers), low stock (Critical at
zero; managers), lot expiring in 30 days (managers), a running house with no feed logged
by 18:00 farm time (workers + managers), a task pending 2h+ past due (managers), negative performance pattern and
probation ending (managers), a running batch within 7 days of its expected selling date (Info) or
past it (Warning; managers), and, admin only, one payroll-not-generated alert and one failed-payouts
and one unpaid-wages alert per month. Each scan also **resolves** an alert whose condition has
cleared; alerts a person raised by hand are never auto-resolved, so a manager can `POST /:id/resolve`
one they can see. The scan runs every 10 minutes. Environment and sensor alerts are not built yet.
| POST | `/api/alerts/scan` | 200 | — runs all 5 checks below, returns the current `ACTIVE` list |

Scan checks (each dedupes against an existing `ACTIVE` alert for the same
`(type, related_id)` — re-running the scan doesn't spam duplicates; resolve
one to let the next scan re-raise it if still true):

1. **Low stock** — `StockLedger` balance (`IN − OUT`) below `Item.reorder_level` → `FEED` or `MEDICINE` alert (by item category), `WARNING`.
2. **Mortality spike** — 24h deaths ÷ current live balance > 1% for a `RUNNING` batch → `BATCH`, `CRITICAL`.
3. **Expiring stock** — `PurchaseItem.expiration_date` within 30 days → `MEDICINE`, `WARNING`.
4. **Payroll due** — an active employee missing last month's `PayrollRecord`, checked from the 5th of the month onward → `EMPLOYEE`, `INFO`.
5. **Negative performance pattern** — net `PerformanceScoreEntry` points this month ≤ -5 → `EMPLOYEE`, `WARNING`.

**Errors**: **404** unknown `:id` on get/resolve; **409** if resolving an
alert whose `status` is already `RESOLVED`. `create`/`scan` have no error
paths beyond generic validation — `related_id` isn't a real FK (§1.13), so
an unresolvable one is silently accepted, not rejected.

---

## 14. Audit Log & Analytics

### 14.1 Audit Log — read side only

Rows are written by the services that perform a sensitive action
(`lib/audit.ts`), against the signed-in actor: logins and passwords, people,
payroll payouts and payout accounts, purchases, sales, bird sales, stock
adjustments, batch start/edit/close and devices. Every read includes
`changed_by: { id, name }`. The table is append-only at the database. **No
POST/PATCH/DELETE route exists for this resource at all.**

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/audit-logs` | 200 | query: `table_name?`, `record_id?`, `changed_by_id?`, `action?`, `from?`, `to?` (dates) |
| GET | `/api/audit-logs/tables` | 200 | every `table_name` with at least one entry, sorted (`string[]`) |
| GET | `/api/audit-logs/:id` | 200 | full `before_data`/`after_data` JSON diff |

**Errors**: **404** unknown `:id`. List has no error paths beyond generic
validation.

### 14.2 Analytics — farm overview

```
GET /api/analytics/overview   → 200, no query params, no error paths
```
Returns:
```json
{
  "active_batch_count": 4,
  "total_birds_alive": 8340,
  "houses_occupied": 5,
  "houses_empty": 2,
  "employee_headcount": 12,
  "unresolved_alerts_by_level": { "WARNING": 2, "CRITICAL": 1 }
}
```
`total_birds_alive` is scoped to `RUNNING` batches only — a force-closed
batch (`close` with `force: true` while birds remained) can still hold a
nonzero `BatchHouseBalance`, and that's intentionally excluded here.
`unresolved_alerts_by_level` only includes levels that actually have at
least one `ACTIVE` alert — a level with zero is simply absent from the
object, not present with value `0`.

### 14.3 Analytics — batch performance & P&L

```
GET /api/analytics/batches/:id/performance   → 200, or 404 if :id doesn't exist
```
```json
{
  "batch_id": "...", "live_count": 680, "initial_chick_count": 1000,
  "cumulative_died": 20, "cumulative_mortality_rate": 0.02,
  "age_days": 14, "expected_selling_date": "...", "actual_end_date": null,
  "latest_average_weight_grams": "500", "latest_weight_date": "..."
}
```
`cumulative_mortality_rate` is a plain float fraction (0.02 = 2%), not a
percentage or a string. `latest_average_weight_grams`/`latest_weight_date`
are both `null` if no `WeightRecords` exist for the batch yet. **No FCR
field here.** Feed-conversion ratio (feed kg ÷ kg gained) is returned per batch by
`GET /api/analytics/batches/performance` (§14.5) and in the statement below
(`per_unit.fcr`). It is `null` when any of the batch's feed can't be expressed in kg, because
a unit with no kg conversion (a bag of unknown weight) would make the ratio meaningless.
Don't compute one client-side.

```
GET /api/analytics/batches/:id/pnl   → 200, or 404 if :id doesn't exist
```
```json
{
  "batch_id": "...", "revenue": "118000", "purchase_cost": "15000",
  "consumption_cost": "10000", "direct_expenses": "2000", "depreciation_share": "4000",
  "shared_period_expenses_unallocated": "1500", "profit": "87000"
}
```
This is the compact, original shape, kept for existing callers. `revenue` is bird sales net of
discount plus any regular sale tagged to the batch (litter and the like). `purchase_cost` is
the chicks. `consumption_cost` is the feed, medicine and supplies used, costed at the stock's
average purchase price. `profit = revenue − purchase_cost − consumption_cost −
direct_expenses − depreciation_share`, which is the batch's **contribution**: it is *before*
its share of farm-wide costs. `shared_period_expenses_unallocated` sums shared-period
expenses tagged directly to this batch and is not subtracted.

For the full statement, line by line, use `GET /api/analytics/batches-pnl`. It returns one
statement per batch, newest first: `revenue` (gross, discounts, other sales, net), `cost_lines`
by section (chicks, feed, medicine and vaccines, bedding and supplements, direct expenses,
depreciation), `costs`, `contribution`, `shared_costs` (the batch's bird-days share, by
category), `net_profit`, `margin`, `birds`, `kg` and `per_unit` (cost per bird and per kg,
profit per bird, average price per kg, `fcr`). `GET /api/analytics/shared-costs` shows, per
month, each farm-wide expense and how it was split between batches.

### 14.4 Analytics — financial dashboard

```
GET /api/analytics/financial?month=2026-08-01   → 200, no error paths (month is optional and any invalid date just 400s at validation)
```
`month` optional, defaults to the current month; any date within the target
month works (normalized server-side).
```json
{
  "month": "2026-08",
  "revenue": "118000", "expenses": "2000", "gross_profit": "116000",
  "outstanding_payables": "45000",
  "outstanding_receivables": "25000",
  "cash_position": "70000",
  "cash_by_instrument": [
    { "instrument_id": "...", "label": "Farm Bank", "balance": "70000" }
  ]
}
```
`revenue`/`expenses` are scoped to the given month (`Sale.sale_date` /
`BirdSale.sale_date` / `Expense.date` within it). `outstanding_payables` is
**all-time**, not month-scoped (sum of every `Purchase.due_amount`, across
every purchase regardless of date). `outstanding_receivables` is also
**all-time** (sum of `Sale.due_amount` + `BirdSale.due_amount` — what customers
still owe). `cash_position` sums every *active*
`PaymentInstrument`'s balance (incoming minus outgoing, all-time,
deactivated instruments excluded) — same computation as §15.1's
per-instrument balance endpoint, just totaled. `cash_by_instrument` is only
active instruments too.

### 14.5 Analytics trends & aggregates

Read-only, same reporting rules as the rest of Analytics (§ above) — no
state of its own.

| Method | Path | Status | Query |
|---|---|---|---|
| GET | `/api/analytics/trends/mortality` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/trends/feed` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/trends/sales` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/sales/by-product-line` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/sales/grade-distribution` | 200 | `days?` (int, 1-365, default 30) |
| GET | `/api/analytics/expenses/breakdown` | 200 | `month?` (date, defaults to current month) |
| GET | `/api/analytics/revenue-vs-expenses` | 200 | `months?` (int, 1-24, default 6) |
| GET | `/api/analytics/batches/performance` | 200 | `status?` (`RUNNING`\|`CLOSED`\|`SOLD`, optional, all statuses when omitted) |

**`/trends/mortality`** — `{ date: string (YYYY-MM-DD), died: number, birds_alive: number, rate: number }[]`,
one row per day in the window (zero-filled). `rate` = `died / birds_alive`, where `birds_alive` is
birds placed minus earlier deaths and sales across batches running that day.

**`/trends/feed`** — `{ date: string, unit: string, quantity: string }[]`,
`unit` is a `Unit.code` (§6.8), FEED-category consumption only. Items with a weight conversion
(base unit KG/G/MON_40KG/METRIC_TON, or an `ItemUnit` to one) are summed into one `KG` row per day;
items with no conversion keep their own unit row and are never summed into kg.

**`/trends/sales`** — `{ date: string, revenue: string, avg_price_per_kg: string }[]`,
`avg_price_per_kg` is volume-weighted (`total revenue / total net weight`
for the day), not an average of per-sale averages.

**`/sales/by-product-line`** — `{ category: string, revenue: string }[]`,
sorted descending by revenue. Regular Sale line-item revenue grouped by
`Item.category`; BirdSale revenue is folded in as a synthetic `"BIRD"`
entry (not a real `ItemCategory.code` value) since BirdSale has no
`Item`/category relation of its own. Omitted entirely (not zero-filled)
when there's no revenue for a category in the window, same no-zero-fill
convention as `/trends/mortality`.

**`/sales/grade-distribution`** — `{ grade: BirdGrade, birds_count: number, revenue: string }[]`,
sorted descending by `birds_count`. One row per grade (`HIGH`/`LOW`/`CULL`)
with at least one bird sold in the window.

**`/expenses/breakdown`** — `{ category: string, total: string }[]`,
`category` is an `ExpenseCategoryLookup.code` (§6.8), sorted descending by
total.

**`/revenue-vs-expenses`** — `{ month: string (YYYY-MM), revenue: string, expenses: string }[]`,
ascending by month. `revenue` = `Sale.total` + `BirdSale.total_amount` for
that month, same computation as `/analytics/financial`.

**`/batches/performance`** — bulk version of
`/analytics/batches/:id/performance`; same per-batch shape, array instead
of one object, plus:
`feed_kg: number | null` (null when any of the batch's feed has no kg conversion),
`weight_gain_kg: number | null` (latest avg weight × live + sold net weight − chick weight; null with no weighing),
`fcr: number | null` (`feed_kg / weight_gain_kg`),
`cost_to_date: string` (batch-linked purchases + direct expenses + depreciation + consumed stock at avg purchase cost),
`cost_per_kg: string | null` (`cost_to_date` / live + sold kg).
Added so the Analytics page's batch table and comparison chart can fetch every batch's numbers in
one request instead of one per batch.

---

## 15. Payments

### 15.1 Payment Instruments

Full CRUD + deactivate/reactivate (own `is_active`, §1.11).
**Every instrument is one of the farm's own accounts** (Cash, a bank account, a
bKash/Nagad/Rocket wallet). There is no owner: customers', suppliers' and
employees' accounts are never instruments — the counterparty of a payment is
the customer/supplier on the bill it settles, and employees are paid to their
`EmployeePayoutAccount`.

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/payment-instruments` | 200 | query: `is_active?` |
| GET | `/api/payment-instruments/:id` | 200 | — |
| GET | `/api/payment-instruments/:id/balance` | 200 | `{ instrument_id, incoming, outgoing, balance }` — computed, not stored |
| POST | `/api/payment-instruments` | 201 | `{ type: PaymentMethod, label, bank_name?, account_no?, mobile_no?, mfs_type? }` |
| PATCH | `/api/payment-instruments/:id` | 200 | `{ type?, label?, bank_name?, account_no?, mobile_no?, mfs_type? }` |
| POST | `/api/payment-instruments/:id/deactivate` | 200 | — |
| POST | `/api/payment-instruments/:id/reactivate` | 200 | — |
| DELETE | `/api/payment-instruments/:id` | 200 | — — hard delete, unused instruments only |

**Errors**: **404** unknown `:id` on get/balance/patch/deactivate/
reactivate; **400** empty `PATCH` body.

`DELETE` is for a mis-created instrument (wrong account number, duplicate):
**409** (`detail`: `"Payment instrument has payment history and cannot be
deleted. Deactivate it instead."`) as soon as any `Payment` references it as
`from_instrument` or `to_instrument`. Once money has moved through an
instrument it stays, so every payment keeps resolving to the account it
actually used.

### 15.2 Payments

Append-only (§1.10).

| Method | Path | Status | Body / Query |
|---|---|---|---|
| GET | `/api/payments` | 200 | query: `ref_type?`, `ref_id?`, `direction?`, `instrument_id?` (matches either from/to) |
| GET | `/api/payments/total-paid` | 200 | query (**required**): `ref_type`, `ref_id` → `{ ref_type, ref_id, total_paid }` |
| GET | `/api/payments/:id` | 200 | — |
| POST | `/api/payments` | 201 | `{ amount, payment_date, ref_type: SALE\|BIRD_SALE\|PURCHASE\|EXPENSE, ref_id, to_instrument_id \| from_instrument_id, transaction_ref?, note? }` — `direction` is derived from `ref_type` (sales in, purchases and expenses out), and wage/fee expenses are refused: they are paid through their payroll payout |

**Exactly one farm account, on the side the money moved**: money received
(SALE, BIRD_SALE) names only `to_instrument_id` — where it landed; money paid
out (PURCHASE, EXPENSE) names only `from_instrument_id` — where it left from.
Anything else is a **400** (and a database CHECK, `Payment_one_farm_account`).
The account must exist and be active. `ref_type`/`ref_id` are polymorphic
(§1.13, like `StockLedger`) — not validated against the target table, so
pointing `ref_id` at a nonexistent Purchase/Sale/etc. **won't error at
all**, it'll just create an orphaned Payment that `total-paid` will
still happily sum. **This is the read-time substitute for a mutable
`due_amount`** (§1.10, §8 note) — use `total-paid` to compute "how much of
this Purchase/Sale/BirdSale/Expense/Payroll is actually paid off" rather
than trusting any `due_amount` field to update itself.

**Errors**: **404** unknown `:id`. `total-paid` → **400** if `ref_type` or
`ref_id` is missing from the query string (both required, not optional,
unlike most list filters). Create → **400** if `from_instrument_id`,
`to_instrument_id`, or `handled_by_id` don't reference real rows (§1.7). No
409s on this resource.

---

## 16. Building the mobile app — role/permission notes

`FEATURES.md` §3 has the full breakdown, and [`endpoints.md`](./endpoints.md) lists who may call
every route. The server enforces it: `/api` is default-deny, and `lib/permissions.ts` is the
only place that grants an employee anything. The load-bearing points:

- **Worker** reads houses, batches, stock, tasks and alerts, and writes the daily logs
  (mortality, weight, environment, consumption, treatment), completes tasks, confirms a due
  vaccine by scanning the bottle (`POST /batch-vaccine-schedules/:id/confirm`), moves or uses
  coded stock (`/stock-units/:id/relocate`, `/use`) and moves uncoded stock (`/stock-transfers`).
- **Manager** does everything a Worker does, plus assigns tasks and scores people
  (`/task-assignments`, `/performance-score-entries`), moves birds between houses
  (`/batch-house-allocations`), sets feeding programs, files stock adjustments, raises and
  resolves alerts, links codes to a purchase lot (`/stock-units/:id/bind`, `/purchase-items`),
  disposes of or bulk-fixes units (`/stock-units/:id/dispose`, `/stock-units/bulk`), scans a QR
  sale's bottles out (`/sale-scans`), and fixes or removes a wrong usage record (§19.4).
- **Anything else is Admin only** and stays on the web dashboard: purchases, sales, payments,
  finance, and admin and employee management (§2, §3, §8, §10, §11, §15). The two exceptions
  are the money-free `/sale-scans` view and the `/purchase-items` lot picker.
- A role with no rules (`INTERN` today) can sign in but gets `403` on everything except
  `/auth`.
- **Every mobile write should generate `idempotency_key` client-side before the first send
  attempt** (§1.12): the whole point is surviving a flaky connection retrying a queued write
  without double-inserting.
- **Handle the 429 plain-text response** (§1.5) explicitly in the mobile HTTP client's error
  path. A flaky-connection retry storm hitting the rate limit is exactly the scenario this
  app's offline queue is built to survive, and a client that assumes every error body is JSON
  will crash on it.

## 17. Paid at creation, and sales taking stock

- `POST /sales`, `/bird-sales`, `/purchases` (and ingest confirm): when `paid_amount > 0` the request must name the
  account — `paid_to_instrument_id` for sales and bird sales, `paid_from_instrument_id` for purchases (**400**
  otherwise). The record stores paid `0` and due = net owed; the amount paid up front becomes a `Payment`
  ("Paid when recorded"), so it counts in the account balance and cash position.
- `Payment.from_instrument_id` is now nullable: money received from a customer needs only `to_instrument_id`.
  Outgoing payments (purchases) still require `from_instrument_id`.
- `POST /sales` now requires `warehouse_id`. Each line leaves that warehouse's stock (StockLedger OUT, reason and
  ref `SALE`) in the sale's transaction; lines of one item are checked together. **409** when the warehouse holds
  less than is being sold. Unit-tracked items leave the ledger but their StockUnit status is still manual.

## 18. Account (self-service)

Any signed-in profile, under `/api/auth`:

- `GET /auth/account` — name, email, mobile, address, role, `is_active`, `created_at`, `password_changed_at`, `admin_since`.
- `PATCH /auth/account` — `name`, `mobile`, `address` (`""` clears it). Email is the login, so it is changed through `PATCH /admins/:id`.
- `POST /auth/deactivate-account` `{ password }` — deactivates the caller (a profile is never deleted: every record it made points at it)
  and clears the session. **400** on a wrong password, or when the caller is the last active admin. An admin can reactivate.

---

## 19. Newer features, rules at a glance

These areas shipped after the sections above were written. The request and response shapes
for each route are in [`endpoints.md`](./endpoints.md); this section records the rules.

### 19.1 Farm day and the settlement window

- `GET` / `PATCH /api/farm-settings` (admin). `day_start_hour` (0 to 6) is the hour the farm's
  day turns, on Dhaka time. Every daily figure goes through the farm-day helpers
  (`lib/farm-day.ts`), so with a 04:00 start a record made at 02:00 belongs to the previous
  farm day. The hour stops at 06:00 because a stored date (midnight UTC) is 06:00 in Dhaka.
- `settlement_days` (0 to 60, default 7) is how long a **SOLD** batch stays open for late costs
  and income (litter sold, a missed bottle turning up, a late bill). The background scan
  loop moves a batch to **CLOSED** once `actual_end_date + settlement_days` has passed, and
  `POST /api/batches/:id/finalize` does it early.
- A **CLOSED** batch refuses new or changed money rows: consumption, expenses, and sales that
  name it fail with **409** "Batch X is finalised". Payments against bird-sale dues stay
  allowed, because that is cash collection, not profit and loss.
- Equipment depreciation is charged when a batch becomes CLOSED, so equipment used during the
  window is included.
- `GET /api/houses/:id/batch-on?date=YYYY-MM-DD` returns the batch that occupied a house on a
  farm day. The server uses the same lookup when a consumption has a house and date but no
  batch, instead of trusting the phone.

### 19.2 Vaccine schedules

- Templates (`/api/vaccine-templates`) and purposes (`/api/vaccine-purposes`, a lookup such as
  Gumboro or Ranikhet) are admin-managed. A schedule row is **day + purpose + method**, never a
  product, so a template outlives a change of brand. Methods: `EYE_DROP`, `NASAL_DROP`,
  `DRINKING_WATER`, `MUSCLE_INJECTION`, `NECK_INJECTION`, `SPRAY`.
- `POST /api/batch-vaccine-schedules/apply` copies a template onto a batch. Planning (add,
  edit, `reschedule`, `cancel`, delete) is **admin only**, and reschedule and cancel need a
  `reason`. A row is `PENDING`, `DONE` or `CANCELLED`.
- **Confirming a dose is floor work** (worker and up): `POST .../:id/confirm` with
  `{ idempotency_key, house_id, bottles: [{ stock_unit_id }] }`. Every bottle must be in that
  house, each is used up, and the confirmation is recorded as the consumption. Houses that
  share a drinking-water line (`shares_water_with` on a house) drank the same water, so they
  are confirmed together.

### 19.3 Disease cases

- A case is one outbreak of one disease in one batch: `/api/disease-cases`, with the disease
  picked from the `/api/diseases` lookup. Workers and managers read; **writes are admin only**.
- Fields: `severity` (`LOW`, `MEDIUM`, `HIGH`), `diagnosis_method` (`FIELD`, `POST_MORTEM`,
  `LAB`), one or more houses of that batch, optional symptoms, affected count and doctor.
- Resolving a case (`status: "RESOLVED"`) needs `resolved_on` and an `outcome` (`RECOVERED`,
  `CULLED`, `SOLD_EARLY`); reopening clears both. Creating a case on a CLOSED batch is refused.
- `POST /medications` and `POST /mortality-logs` accept an optional `disease_case_id`, which
  must belong to the same batch. Deleting a case keeps those rows and clears the link, and
  writes an audit snapshot.
- Each ACTIVE case raises one alert (`HIGH` is critical, anything else a warning) that
  resolves with the case.

### 19.4 Fix usage

A wrong consumption is corrected in place, not with a compensating record, so every report
that reads consumption stays right and the record keeps its id (and its links to treatments
and the vaccine schedule).

- `PATCH /api/consumptions/:id` with `quantity?`, `unit?`, `stock_unit_id?`, `date?` and a
  required `reason`; `POST /api/consumptions/:id/remove` with a `reason`. **Manager and admin.**
  The record is marked as fixed (who, when, why) and the audit log keeps the full before and
  after. The house cannot be changed: remove the record and record it again.
- The batch must not be CLOSED. A date fix re-resolves the batch for the new date; if that is a
  different batch it must be open too, and a use that confirmed a vaccine row cannot change
  batch.
- For stock without codes, the house only has to cover the *increase*; a decrease always
  passes and returns stock to the house. A fix can't date a use in the future.
- Online only: it checks live stock, so mobile does not queue it.

### 19.5 Sale kinds and sale scans

- `POST /api/sales` takes a `kind`: `CODED` (QR-tracked bottles, recorded as a count), `STOCK`
  (bought, uncoded stock such as feed or husk; needs `warehouse_id`, and the amount leaves that
  warehouse when the sale is saved) or `FARM_MADE` (litter and the like, never stocked).
  A request without `kind` is treated as `STOCK`.
- `GET /api/sales/sellable?kind=` lists what the form can offer: sealed bottles per item for
  `CODED`, one warehouse's balance for `STOCK`.
- A `CODED` sale's bottles leave stock **one scan at a time on mobile**:
  `GET /api/sale-scans` lists sales still waiting, and `POST /api/sale-scans/:id/scan` takes
  `{ stock_unit_id }`. Managers see this money-free view; they never read `/sales` itself.

### 19.6 Stock units: counting, bulk fixes and uncoded transfers

- `POST /api/stock-units/bulk` applies one `action` (`FINISH`, `START`, `MOVE`, `RETURN`,
  `DISPOSE`) to many units, each with its own `idempotency_key`. It is manager-level because it
  can dispose. This is what the mobile stock count uses to settle missing units in one call.
- `POST /api/stock-units/:id/use` accepts `move_here` so a unit found in the wrong place is
  moved and used in one atomic step. `GET /api/stock-units/at-location` returns the units a
  location is expected to hold (the list a count checks against), and
  `GET /api/stock-units/:id/profile` returns everything about one code, from purchase to last
  use (the "look up a code" screen).
- `POST /api/stock-transfers` is the uncoded counterpart of a relocation: feed, husk and other
  bulk stock moved or returned by quantity. Worker level.

### 19.7 Devices and PoultryScale ingest

- An admin issues a pairing code for a profile (`POST /api/devices/pairing-codes`). The
  scale phone redeems it at `POST /api/ingest/v1/pair` with `{ code, device_label, platform? }`
  and receives a device token. A code is single-use and lasts 10 minutes. The token is stored
  hashed, and `POST /api/devices/:id/revoke` cuts the device off.
- The scale posts finished sales to `POST /api/ingest/v1/sales` with the device token. They wait
  in a staging queue: an admin reads it (`GET /api/ingest/v1/sales?status=`), then **confirms**
  one into a real bird sale (adding batch, house, grade, weights and price) or **dismisses** it
  with a reason.
- The path is versioned (`/v1`) because scale builds in the field cannot be updated over the
  air. v1 never breaks.

### 19.8 Employee roles

`/api/employee-roles` is a lookup like the others in §6.8 (list, create, update,
deactivate, reactivate, delete), with one extra required field: `reference_salary`, the
standard salary for the role. Payroll uses it for anyone in the role who has no personal
`reference_salary` of their own. The role's `code` is derived from its label once, at create,
and is never regenerated on rename, because employees point at the code. Creating a role does
not grant it any route: access comes only from `lib/permissions.ts`.
