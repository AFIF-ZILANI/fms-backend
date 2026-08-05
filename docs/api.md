# FMS API Reference

Full endpoint reference for the ZeroD Farms Management System backend. Written
for building the web admin dashboard and the employee mobile app against —
every field name, enum value, and business rule below matches the actual
implementation, not the original design docs (where the two differ, the
implementation is what's live).

Companion docs: [`FEATURES.md`](./FEATURES.md) (what each role/page needs),
[`PROGRESS.md`](./PROGRESS.md) (build order, status, and the reasoning behind
every deliberate scope decision — read it if something below seems
incomplete on purpose).

Base URL (dev): `http://localhost:5085`. Every route below is mounted under
`/api` (e.g. `/api/admins`) except `GET /health`.

---

## 1. Conventions — read this before building anything

### 1.1 Response envelope

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

**Error — RFC 7807 Problem Details**, on every non-2xx response:

```json
{
  "type": "https://api.bhaze.dev/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "paid_amount cannot exceed the purchase total",
  "extensions": { "fields": { "quantity": "Quantity must be positive" } }
}
```

`extensions.fields` only appears on 400s from Zod validation failures — it's
a flat map of `field.path` → message, ready to attach to a form. Use
`detail` for every other error type (409 conflicts, 404s, etc.) — there's no
separate machine-readable code, match on `status` + read `detail` for the
user-facing message.

| Status | Meaning here |
|---|---|
| 400 | Validation failed, OR a client-supplied foreign id doesn't reference an existing record (e.g. binding a `StockUnit` to a nonexistent `purchase_item_id`) |
| 404 | Resource not found |
| 409 | Conflict — duplicate unique field, invalid state transition (e.g. closing an already-`CLOSED` batch), or a business-rule rejection (oversell, insufficient balance) |
| 500 | Unhandled — report as a bug, this shouldn't happen for any documented flow |

### 1.2 Pagination

Every list endpoint (`GET` without `/:id`) accepts:

| Param | Type | Default |
|---|---|---|
| `page` | int ≥ 1 | 1 |
| `limit` | int, 1–100 | 20 |

Plus whatever filters that resource documents below. All query params are
strings on the wire — booleans are the literal strings `"true"`/`"false"`,
not JSON booleans (e.g. `?is_active=true`).

### 1.3 No auth yet — actor ids go in the request body

**Phase 15 (Auth) hasn't been built.** There is no login, no session, no
`Authorization` header. Every endpoint that needs to know "who did this"
takes that as an explicit field in the request body:

- `recorded_by_id`, `given_by_id`, `administered_by_id`, `measured_by_id`,
  `handled_by_id`, `changed_by_id` — a **required** `Profiles.id` (UUID).
  The web/mobile client must know which Admin/Employee is currently "logged
  in" (however that's tracked client-side for now — a picked profile, a
  stored id, whatever) and pass it explicitly on every write.
- `StockUnit.bound_by_id` — same idea, but **optional**.

When Phase 15 lands, these fields will very likely be dropped in favor of
deriving the actor from a session — **don't build UI that makes the user
manually pick "who am I" from a dropdown as a permanent pattern**; treat the
current explicit-id requirement as a stopgap this doc will be updated to
reflect once Auth exists.

### 1.4 Money fields are Prisma Decimal → JSON strings

Every money/quantity field backed by a Postgres `Decimal` column
(`amount`, `total`, `total_price`, `quantity`, `salary`, `balance`, ...)
serializes as a **JSON string**, not a number — e.g. `"total_amount": "4000"`,
`"unit_price": "15.5"`. Parse with a decimal-safe library client-side (or
`parseFloat` if you accept float rounding for display only); don't do money
math in JS floats when precision matters, same reasoning the backend follows
with `Prisma.Decimal` throughout.

Request bodies accept plain JSON numbers for these fields (Zod coerces) —
only responses come back as strings.

### 1.5 Append-only tables — no update endpoint, ever

These resources are **create + read only** by design (a correction is a new
offsetting row, never an edit): `Purchase`/`PurchaseItem`, `Sale`/`SaleItem`,
`BirdSale`, `Payment`, `Expense`, `Consumption`, `MortalityLog`,
`BatchHouseAllocation`, `PerformanceScoreEntry`, `StockLedger`. Don't build a
PATCH/edit form for any of these — if a farm operator mis-entered one, the
UI should guide them to record a correcting entry, not "fix" the original.

### 1.6 Soft-delete via `is_active` — never a real delete

No endpoint in this API ever hard-deletes a business record. Deactivation
uses `POST /:id/deactivate` + `POST /:id/reactivate` pairs. Two different
`is_active` patterns exist — **don't confuse them**:

- **`Profiles.is_active`** — Admins, Employees, Houses, Items,
  `PaymentInstrument`: deactivating means "this account/record is inactive."
- **The model's own `is_active`** — Suppliers, Customers: deactivating a
  Supplier/Customer flips *their own* `is_active` field, not
  `Profiles.is_active`. A deactivated Supplier's underlying Profile stays
  active — they're a person who exists, just not currently a live supplier
  relationship.

`Warehouses` and `Doctors` have no lifecycle endpoints at all (no
`is_active` field) — they're create + read (+ rename for Warehouses), full
stop.

### 1.7 `idempotency_key` — offline-write safety

These tables carry a unique `idempotency_key`, meant for the mobile app's
offline queue (write locally, sync when back online, retry-safe):
`BatchHouseAllocation`, `MortalityLog`, `Consumption`, `Medications`,
`Vaccinations`, `EnvironmentRecords`, `WeightRecords`,
`InventoryAdjustment`, `PerformanceScoreEntry`. It's an **optional** field
in every create request on these — omit it and the server generates one
(fine for the web dashboard, which writes synchronously); the mobile app's
offline queue should generate and persist one client-side *before* the
first send attempt, so a retried sync can't double-insert.

### 1.8 Polymorphic references — not real foreign keys

A few fields reference "some record in some other table, type given
separately," and are **not** enforced by a Postgres FK — don't expect a 400
if you get them wrong, the row will just silently not resolve to anything
useful:

- `StockLedger.ref_type` + `ref_id`, `Payment.ref_type` + `ref_id` — e.g.
  `ref_type: "PURCHASE", ref_id: "<a Purchase.id>"`.
- `PaymentInstrument.owner_type` + `owner_id` — e.g.
  `owner_type: "SUPPLIER", owner_id: "<a Suppliers.id>"`.
- `Alerts.related_id` — no `related_type`; interpret using `Alerts.type`.

### 1.9 Enums quick reference

Every enum used in a request body, spelled exactly as the API expects
(case-sensitive):

| Enum | Values |
|---|---|
| `UserRole` | `ADMIN`, `EMPLOYEE`, `CUSTOMER`, `SUPPLIER`, `DOCTOR` |
| `EmployeeRoleNames` | `MANAGER`, `WORKER`, `INTERN` |
| `SupplierRoleNames` | `SALES_MAN`, `OWNER`, `DISTRIBUTOR`, `DEALER`, `WHOLESALER`, `RETAILER`, `MANUFACTURER`, `IMPORTER`, `REPRESENTATIVE` |
| `SupplierSupplyCategories` | `FEED`, `MEDICINE`, `CHICKS`, `HUSK`, `EQUIPMENT`, `UTILITIES`, `TRANSPORTATION`, `CLEANING_SUPPLIES`, `OFFICE_SUPPLIES`, `SOFTWARE`, `OTHER` |
| `HouseType` | `BROODER`, `GROWER`, `LAYER` |
| `Units` | `BIRD`, `KG`, `LITER`, `BAG`, `BOX`, `UNIT`, `SACHETS`, `BOTTLE`, `ML`, `L`, `G`, `PCS`, `VIAL`, `DOSE`, `OTHER` |
| `ResourceCategories` (`Item.category`) | `FEED`, `MEDICINE`, `VACCINE`, `SUPPLEMENT`, `BIOSECURITY`, `CHICKS`, `HUSK`, `EQUIPMENT`, `UTILITIES`, `SALARY`, `TRANSPORTATION`, `MAINTENANCE`, `CLEANING_SUPPLIES`, `OTHER` |
| `StockUnitStatus` (read-only, server-managed) | `UNASSIGNED`, `IN_STOCK`, `IN_USE`, `CONSUMED`, `DISPOSED` |
| `AssetStatus` | `ACTIVE`, `RETIRED`, `DISPOSED` |
| `OrganizationRole` | `MANUFACTURER`, `IMPORTER`, `MARKETER`, `DISTRIBUTOR` |
| `BatchStatus` (read-only except via `/close`) | `RUNNING`, `CLOSED`, `SOLD` |
| `Phase` | `BROODER`, `GROWER` |
| `BirdBreeds` | `CLASSIC`, `HIBREED`, `PAKISTHANI`, `KEDERNATH`, `FAOMI`, `TIGER` |
| `AllocationReason` (client-choosable) | `TRANSFER`, `ADJUSTMENT` — `INITIAL` is set internally only, on `Batches` create |
| `TimePeriods` | `MORNING`, `NOON`, `AFTERNOON`, `EVENING`, `NIGHT`, `MIDNIGHT`, `LATENIGHT` |
| `FeedType` | `PRE_STARTER`, `STARTER`, `GROWER`, `FINISHER`, `LAYER` |
| `BirdGrade` | `HIGH`, `LOW`, `CULL` |
| `CostType` | `DIRECT`, `SHARED_PERIOD`, `SHARED_CAPITAL` |
| `ExpenseCategory` | `LABOR`, `ELECTRICITY`, `WATER`, `RENT`, `TRANSPORT`, `FUEL`, `MAINTENANCE`, `VET_FEE`, `INTERNET`, `MISC` |
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

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/admins` | query: `is_active?` |
| GET | `/api/admins/:id` | — |
| POST | `/api/admins` | `{ name, mobile, email?, address? }` |
| PATCH | `/api/admins/:id` | any subset of the create fields |
| POST | `/api/admins/:id/deactivate` | — |
| POST | `/api/admins/:id/reactivate` | — |

`:id` is `Admins.id`, not `Profiles.id`. Response nests the profile:
`{ id, profile_id, created_at, updated_at, profile: { id, name, mobile, email, address, role, is_active, ... } }`.
Create/update conflicts (duplicate `mobile`/`email`) → 409 naming the field.

---

## 3. Employees

`Profiles(role=EMPLOYEE)` + `Employees`. Same shape as Admins plus role/pay
fields.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/employees` | query: `role?`, `is_active?` |
| GET | `/api/employees/:id` | — |
| POST | `/api/employees` | `{ name, mobile, email?, address?, role, salary, joining_date? }` |
| PATCH | `/api/employees/:id` | `{ name?, mobile?, email?, address?, role?, salary?, rating? }` |
| POST | `/api/employees/:id/deactivate` | — |
| POST | `/api/employees/:id/reactivate` | — |

`role` is `EmployeeRoleNames`. `salary` is the baseline used by payroll (§12)
— changing it here only affects *future* `PayrollRecord.generate` calls,
past records stay locked. `rating` (0–5) is update-only, not settable on
create. Response nests `profile` the same way Admins does.

---

## 4. Suppliers, Customers, Doctors

### 4.1 Suppliers

`Profiles(role=SUPPLIER)` + `Suppliers`. **Deactivate/reactivate toggle
`Suppliers.is_active` directly, not `Profiles.is_active`** (§1.6).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/suppliers` | query: `role?`, `supplies?` (single category, array-contains match), `is_active?` |
| GET | `/api/suppliers/:id` | — |
| POST | `/api/suppliers` | `{ name, mobile, email?, address?, role, supplies: [SupplierSupplyCategories, ...] (min 1), company? }` |
| PATCH | `/api/suppliers/:id` | any subset of create fields |
| POST | `/api/suppliers/:id/deactivate` | — |
| POST | `/api/suppliers/:id/reactivate` | — |

`role` here is `SupplierRoleNames` (their role at the supplying company —
sales rep, distributor, etc.), unrelated to `EmployeeRoleNames`. `supplies`
must have at least one category.

### 4.2 Customers

`Profiles(role=CUSTOMER)` + `Customers`. Same `is_active`-is-its-own pattern
as Suppliers.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/customers` | query: `is_active?` |
| GET | `/api/customers/:id` | — |
| POST | `/api/customers` | `{ name, mobile, email?, address?, company? }` |
| PATCH | `/api/customers/:id` | `{ name?, mobile?, email?, address?, company?, rating? }` |
| POST | `/api/customers/:id/deactivate` | — |
| POST | `/api/customers/:id/reactivate` | — |

### 4.3 Doctors

`Profiles(role=DOCTOR)` + `Doctors`. **Reduced scope on purpose** — no
FEATURES.md page of their own, no `is_active` field, referenced only via
`doctor_id` on Medications/Vaccinations. Create + list + get only, no
update, no deactivate.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/doctors` | — (pagination only) |
| GET | `/api/doctors/:id` | — |
| POST | `/api/doctors` | `{ name, mobile, email?, address?, specialty?, position?, degrees?: string[], institution? }` |

---

## 5. Houses

`Houses` — no linked Profile, simplest resource in the API.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/houses` | query: `type?`, `is_active?` |
| GET | `/api/houses/:id` | — |
| POST | `/api/houses` | `{ name, type, number, capacity? }` |
| PATCH | `/api/houses/:id` | any subset of create fields |
| POST | `/api/houses/:id/deactivate` | — |
| POST | `/api/houses/:id/reactivate` | — |

`capacity` (int, optional) has no enforcement yet — it's descriptive only,
no over-allocation check runs against it currently.

---

## 6. Inventory

### 6.1 Items — the catalog

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/items` | query: `category?`, `is_active?` |
| GET | `/api/items/:id` | — |
| POST | `/api/items` | `{ name, category, unit, reorder_level?, preferred_reorder_qty?, lead_time_days?, supplier_ids?: uuid[] }` |
| PATCH | `/api/items/:id` | any subset of create fields |
| POST | `/api/items/:id/deactivate` | — |
| POST | `/api/items/:id/reactivate` | — |

**Don't send `normalized_key`** — it's computed server-side from `name`
(lowercased, trimmed, whitespace-collapsed) specifically to catch
"Amoxicillin" vs "amoxicillin" duplicates; client input for it is ignored
because the field doesn't exist in the request schema at all. Renaming an
item recomputes it. `supplier_ids` connects/replaces the item's m2m link to
`Suppliers` (full replace on update, not additive).

### 6.2 Warehouses

Deliberately minimal — no delete, no deactivate (§1.6). Just a named
location.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/warehouses` | — |
| GET | `/api/warehouses/:id` | — |
| POST | `/api/warehouses` | `{ name }` |
| PATCH | `/api/warehouses/:id` | `{ name }` (rename only) |

### 6.3 Organizations + Item↔Organization links

Recall-tracing: which manufacturer/importer/distributor an item's lot came
from. Same server-computed `normalized_key` pattern as Items.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/organizations` | — |
| GET | `/api/organizations/:id` | includes `itemLinks: [{ item, role }, ...]` |
| POST | `/api/organizations` | `{ label_name }` |
| PATCH | `/api/organizations/:id` | `{ label_name }` |
| POST | `/api/item-organizations` | `{ item_id, organization_id, role: OrganizationRole }` |
| DELETE | `/api/item-organizations/:id` | — |

`(item_id, organization_id, role)` is unique — linking the same trio twice
409s.

### 6.4 StockUnit — the QR-code-per-unit lifecycle

Coded tracking for medicine/vaccine/equipment (feed and other bulk items use
the aggregate `StockLedger`, §6.6, instead). Status only ever moves forward:
`UNASSIGNED → IN_STOCK → IN_USE → CONSUMED` (or `→ DISPOSED` from almost any
state). **The client never sets `status` directly** — it's a side effect of
which action endpoint you call.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/stock-units` | query: `status?`, `house_id?` |
| GET | `/api/stock-units/:id` | — |
| GET | `/api/stock-units/code/:code` | look up by the printed code — this is the QR-scan endpoint |
| POST | `/api/stock-units` | `{ count: int 1-500 }` — provisions that many blank codes, `status: UNASSIGNED` |
| POST | `/api/stock-units/:id/bind` | `{ purchase_item_id, initial_quantity?, bound_by_id? }` — `UNASSIGNED → IN_STOCK`; 409 if not currently `UNASSIGNED` |
| POST | `/api/stock-units/:id/relocate` | `{ house_id }` |
| POST | `/api/stock-units/:id/dispose` | — → `DISPOSED`; 409 if already `DISPOSED` |

`initial_quantity` on bind is the depleting amount (e.g. 1000 mL in a
bottle) — omit it for non-depleting equipment; `remaining_quantity` mirrors
it and only moves via `Consumption` (§9.1), never a direct PATCH here.
Provisioning returns an **array** of the newly created units (each with its
own `code` and `id`) — that's what you print as QR labels.

### 6.5 Assets

Equipment tracking, 1:1 with a `StockUnit` (`stock_unit_id` unique — binding
a second Asset to the same unit 409s).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/assets` | query: `status?` |
| GET | `/api/assets/:id` | includes `stock_unit` |
| POST | `/api/assets` | `{ stock_unit_id, name, purchase_cost, purchase_date, useful_life_batches }` |
| PATCH | `/api/assets/:id/status` | `{ status: AssetStatus }` |

`useful_life_batches` feeds `AssetDepreciation`'s formula (§11.2) — set it
thoughtfully, it can't be corrected after the fact for already-computed
depreciation rows (those stay locked).

### 6.6 StockLedger — read-only

Aggregate balance ledger for non-coded items (feed, etc.). **No POST route
exists** — entries are written internally by `Consumption` (§9.1) and
`InventoryAdjustment` (§6.7) as a side effect, never posted directly.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/stock-ledger` | query: `item_id?`, `direction?` (`IN`/`OUT`), `reason?` (`StockReason`) |

Current balance for an item = sum of `IN` minus sum of `OUT` — there's no
single "current balance" field anywhere, compute it client-side from this
list if needed (or use `GET /api/alerts/scan`, §13, which does this
server-side for reorder-level checking).

### 6.7 Inventory Adjustments

Manual stock corrections — the one client-writable path into `StockLedger`
(via a paired entry the server creates automatically in the same
transaction).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/inventory-adjustments` | query: `item_id?` |
| POST | `/api/inventory-adjustments` | `{ item_id, warehouse_id? or house_id? (at least one), quantity_before, quantity_after, reason: string, note?, recorded_by_id, idempotency_key? }` |

`adjustment_quantity` (= `quantity_after - quantity_before`) is computed
server-side. Equal before/after → 400 (no-op rejected). The paired
`StockLedger` entry's direction follows the sign automatically.

---

## 7. Batches

The core physical/financial unit of the farm. `Batches`,
`BatchHouseAllocation`, `BatchHouseBalance`, `MortalityLog`. This is where
money-adjacent balance math lives — read `PROGRESS.md`'s Phase 6 entry if
something here surprises you.

### 7.1 Batches

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/batches` | query: `status?`, `breed?`, `phase?` |
| GET | `/api/batches/:id` | includes `houseBalances: [{ house_id, quantity, house }]` |
| POST | `/api/batches` | see below |
| PATCH | `/api/batches/:id` | `{ batch_code?, breed?, phase?, expected_selling_date? }` — 409 if batch isn't `RUNNING` |
| POST | `/api/batches/:id/close` | `{ status: "CLOSED" \| "SOLD", force?: boolean }` |

**Create body**: `{ batch_code, breed, starting_date?, expected_selling_date, initial_chick_count, init_chicks_avg_wt, house_id, recorded_by_id }`.
This single call creates the `Batches` row **and** an `INITIAL`
`BatchHouseAllocation` **and** the starting `BatchHouseBalance` in one
transaction — "chicks arrive" is one atomic event, not three separate calls.
`batch_code` must be unique (409 on collision). `house_id` must exist (400
if not).

**Close**: requires every `BatchHouseBalance` row for this batch to sum to
zero (all birds accounted for via sales/mortality/transfers out) —
otherwise 409 with the exact remaining count in the message. Pass
`force: true` to close anyway (birds get written off, no reconciliation).
Closing also **fires the `AssetDepreciation` trigger** (§11.2) for every
`ACTIVE` Asset whose `StockUnit` this batch consumed — that's automatic, no
separate call needed. Closing is one-way: no endpoint reopens a batch.

### 7.2 Batch House Allocations — transfers & corrections

One algorithm covers both `TRANSFER` (moving birds between houses) and
`ADJUSTMENT` (a headcount correction): **decrements `from_house_id`'s
balance if set, increments `to_house_id`'s if set** — set only one for a
one-directional correction, both for a real transfer.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/batch-house-allocations` | query: `batch_id?` |
| POST | `/api/batch-house-allocations` | `{ batch_id, from_house_id?, to_house_id? (at least one), quantity: positive int, reason: "TRANSFER" \| "ADJUSTMENT", recorded_by_id, idempotency_key? }` |

409s: batch isn't `RUNNING`; `from_house_id` doesn't have enough birds for
the requested `quantity` (transaction rolls back cleanly — no partial
write, verified in tests).

### 7.3 Batch House Balances — read-only

The live "how many birds of batch X are in house Y" cache. Never written
directly — only `Batches.create`, `BatchHouseAllocation.create`, and
`MortalityLog.create` (and `BirdSale.create`, §10.2) touch it, always inside
their own transaction.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/batch-house-balances` | query: `batch_id?`, `house_id?` |

Good endpoint for an occupancy-grid view (all batches × all houses at once).

### 7.4 Mortality Log

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/mortality-logs` | query: `batch_id?`, `house_id?` |
| POST | `/api/mortality-logs` | `{ batch_id, house_id, count_died: positive int, cause_note?, date, recorded_by_id, idempotency_key? }` |

Decrements the batch-house balance in the same transaction as the log row.
409 if `count_died` exceeds that house's current live balance for the
batch — nothing is written on rejection.

---

## 8. Purchases

`Purchase` + `PurchaseItem`. **Append-only** (§1.5) — create, list, get,
never update.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/purchases` | query: `supplier_id?` |
| GET | `/api/purchases/:id` | includes `items: [{ ..., item }]`, `supplier` |
| POST | `/api/purchases` | see below |
| GET | `/api/purchase-items` | query: `item_id?`, `batch_id?` — cross-purchase lot lookup |

**Create body**:
```
{
  supplier_id?, invoice_no?, purchase_date, paid_amount? (default 0), recorded_by_id,
  items: [{ item_id, batch_id?, quantity, unit, unit_price, mfg_date?, expiration_date? }, ...] (min 1)
}
```
`total_price` per line and `total_amount` for the purchase are computed
server-side (`quantity × unit_price`, summed) — don't send them, they're
ignored/not accepted. `due_amount = total_amount - paid_amount`; sending a
`paid_amount` greater than the computed total → 400. Set `batch_id` on a
line item when the purchase funds a specific batch (chicks) — this is how
`Batches`/`PurchaseItem` link financially.

**Note**: `Purchase.due_amount` is a locked snapshot at creation — recording
a `Payment` (§10) against a purchase later does **not** update it. Compute
"how much is actually still owed" via
`GET /api/payments/total-paid?ref_type=PURCHASE&ref_id=<purchase.id>`
(§10.1) and subtract from `due_amount` client-side.

---

## 9. Treatment & Monitoring

### 9.1 Consumption — the stock-draw event

Two behaviors depending on whether `stock_unit_id` is set — **this is the
most important branch in the whole API to understand correctly**:

- **Coded draw** (`stock_unit_id` set — medicine/vaccine/equipment):
  decrements `StockUnit.remaining_quantity`; flips status
  `IN_STOCK → IN_USE`, or `→ CONSUMED` at exactly zero. Equipment
  (`remaining_quantity` was never set) just flips to `IN_USE` once,
  non-depleting. 409 if the unit is `DISPOSED`/`CONSUMED` already, or if
  `quantity` exceeds what's left.
- **Aggregate draw** (no `stock_unit_id` — feed, etc.): no `StockUnit`
  touched at all; writes a `StockLedger` `OUT` entry instead.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/consumptions` | query: `batch_id?`, `house_id?`, `item_id?` |
| POST | `/api/consumptions` | `{ batch_id?, house_id, item_id, stock_unit_id?, quantity, date, note?, recorded_by_id, idempotency_key? }` |

### 9.2 Medications / Vaccinations

Nearly identical shape; `dosage` is free-text on Medications, an integer
count on Vaccinations. Both optionally link back to the `Consumption` row
the dose was drawn from.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/medications` | query: `batch_id?` |
| POST | `/api/medications` | `{ batch_id, consumption_id?, medicine_name, dosage: string, cause?, period?, administered_by_id, doctor_id?, remarks?, date?, idempotency_key? }` |
| GET | `/api/vaccinations` | query: `batch_id?` |
| POST | `/api/vaccinations` | `{ batch_id, consumption_id?, vaccine_name, dosage: positive int, cause?, period?, administered_by_id, doctor_id?, remarks?, date?, idempotency_key? }` |

### 9.3 Environment Records

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/environment-records` | query: `batch_id?`, `house_id?` |
| POST | `/api/environment-records` | `{ batch_id, house_id, temperature_c, humidity_percent, ammonia_ppm, co2_ppm, air_pressure_hpa, time_period: TimePeriods, recorded_by_id, idempotency_key? }` |

### 9.4 Weight Records

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/weight-records` | query: `batch_id?`, `house_id?` |
| POST | `/api/weight-records` | `{ batch_id?, house_id, average_wt_grams, sample_size: positive int, date, measured_by_id, idempotency_key? }` |

`(batch_id, house_id, date)` is unique — a second sample logged for the same
batch+house+day 409s instead of silently overwriting. If retrying a failed
submission, don't just resend the same date; surface the 409 as "already
logged today" in the UI.

### 9.5 Batch Feeding Program

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/batch-feeding-programs` | query: `batch_id?` |
| POST | `/api/batch-feeding-programs` | `{ batch_id, feed_type: FeedType, item_id, start_day: int ≥0, end_day?: int ≥0 }` |
| PATCH | `/api/batch-feeding-programs/:id` | `{ end_day: int ≥0 }` — the **only** editable field |

No actor field on this one (no `recorded_by_id`) — it's a planning record,
not a field-execution log.

---

## 10. Sales

`Sale`/`SaleItem` (non-bird items) + `BirdSale`. Both **append-only** (§1.5).

### 10.1 Sale (regular items — feed surplus, culls, manure, etc.)

Exact mirror of Purchases' money-math pattern.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/sales` | query: `customer_id?` |
| GET | `/api/sales/:id` | includes `items`, `customer` |
| POST | `/api/sales` | `{ customer_id?, sale_date, paid_amount? (default 0), recorded_by_id, items: [{ item_id, quantity, unit, unit_price }, ...] (min 1) }` |

`total`/line `total_price`/`due_amount` computed server-side, same as
Purchases. `paid_amount` exceeding the computed total → 400.

### 10.2 BirdSale

The batch's actual product sale — **decrements `BatchHouseBalance`**, one
of only three things allowed to (with `MortalityLog` and
`BatchHouseAllocation`).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/bird-sales` | query: `batch_id?`, `customer_id?` |
| GET | `/api/bird-sales/:id` | — |
| POST | `/api/bird-sales` | see below |

**Create body**:
```
{
  batch_id, house_id, customer_id?, sale_date, grade: BirdGrade,
  male_count?, female_count?, birds_count,
  dholta_in_g, total_katha, avg_wt_per_katha_kg?,
  total_weight, net_weight, avg_weight_g?,
  price_per_kg, paid_amount? (default 0), recorded_by_id
}
```
**Only `total_amount` (`= net_weight × price_per_kg`) and `due_amount` are
server-computed.** Every regional field (`dholta_in_g`, `total_katha`,
`avg_wt_per_katha_kg`, `avg_weight_g`) is stored exactly as sent — the API
deliberately doesn't try to derive them from each other (unit-conversion
ambiguity the team didn't have full context on; see `PROGRESS.md` Phase 9).
If `male_count` and `female_count` are both given, they must sum to
`birds_count` (400 if not). 409 if `birds_count` exceeds the house's live
balance for that batch — nothing written on rejection.

---

## 11. Finance

### 11.1 Expense

Append-only (§1.5).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/expenses` | query: `batch_id?`, `category?`, `cost_type?` |
| GET | `/api/expenses/:id` | — |
| POST | `/api/expenses` | `{ batch_id?, category: ExpenseCategory, cost_type: CostType, amount, date, remarks?, recorded_by_id }` |

`cost_type = SHARED_PERIOD` expenses currently show as **unallocated** in
batch P&L (§14.3) — the bird-days formula that would distribute them across
concurrent batches is still v2, not built. Don't build UI that implies
shared costs are already split across batches; they aren't yet.

### 11.2 Asset Depreciation — read-only

Never posted directly. Rows are written automatically by
`POST /api/batches/:id/close` (§7.1) for every `ACTIVE` Asset whose
`StockUnit` the closing batch consumed (via `Consumption`,
`amount = purchase_cost / useful_life_batches`).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/asset-depreciations` | query: `asset_id?`, `batch_id?` |

---

## 12. Payroll

### 12.1 Performance Score Entries

Fixed point value **per criterion**, looked up server-side — the client
cannot set `points` for a normal criterion (sending one is silently
ignored; the server snapshots the fixed value regardless). `OTHER` is the
one escape hatch: client supplies `points`, validator bounds it to ±1–5
(excluding 0).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/performance-score-entries` | query: `employee_id?` |
| POST | `/api/performance-score-entries` | `{ employee_id, given_by_id, criterion: PerformanceCriterion, points? (OTHER only), reason, date?, idempotency_key? }` |

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

### 12.2 Payroll Records

Manual, admin-triggered month-end action (there's no cron). Locked snapshot
per `(employee_id, month)` — regenerating throws 409, and there's no update
endpoint; if the baseline salary or a criterion's points change later, past
months' `PayrollRecord`s stay exactly as computed.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/payroll-records` | query: `employee_id?` |
| POST | `/api/payroll-records/generate` | `{ employee_id, month }` |

`month` can be any date within the target month (normalized server-side to
the 1st). Sums that month's `PerformanceScoreEntry.points` for the
employee, clamps to **[-10, +20]** as `adjustment_percent`, applies to the
employee's *current* `Employees.salary` as `baseline_salary`, computes
`final_salary = baseline_salary × (1 + adjustment_percent / 100)`.

---

## 13. Alerts

Built as an **on-demand reconciliation scan**, not live hooks on every
write — see `PROGRESS.md` Phase 13 for why. `POST /api/alerts/scan` is
meant to be called periodically (there's no cron yet, so: on dashboard load,
on a timer, or manually) or manually by an admin; call it, don't expect
alerts to appear the instant a triggering condition becomes true elsewhere
in the API.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/alerts` | query: `type?`, `level?`, `status?` |
| GET | `/api/alerts/:id` | — |
| POST | `/api/alerts` | `{ title, description?, type: AlertTypes, level: AlertLevels, related_id?, action_type? }` — manual alert |
| POST | `/api/alerts/:id/resolve` | — 409 if already `RESOLVED` |
| POST | `/api/alerts/scan` | — runs all 5 checks below, returns the current `ACTIVE` list |

Scan checks (each dedupes against an existing `ACTIVE` alert for the same
`(type, related_id)` — re-running the scan doesn't spam duplicates; resolve
one to let the next scan re-raise it if still true):

1. **Low stock** — `StockLedger` balance (`IN − OUT`) below `Item.reorder_level` → `FEED` or `MEDICINE` alert (by item category), `WARNING`.
2. **Mortality spike** — 24h deaths ÷ current live balance > 1% for a `RUNNING` batch → `BATCH`, `CRITICAL`.
3. **Expiring stock** — `PurchaseItem.expiration_date` within 30 days → `MEDICINE`, `WARNING`.
4. **Payroll due** — an active employee missing last month's `PayrollRecord`, checked from the 5th of the month onward → `EMPLOYEE`, `INFO`.
5. **Negative performance pattern** — net `PerformanceScoreEntry` points this month ≤ -5 → `EMPLOYEE`, `WARNING`.

---

## 14. Audit Log & Analytics

### 14.1 Audit Log — read side only

`AuditLog` exists in the schema, but **nothing writes to it yet** —
population needs Phase 15 (Auth) to know who's making a change. Expect this
to return an **empty list** until Auth lands; the endpoint is built and
ready, just unpopulated. Don't build UI that assumes audit history exists
for anything created through this API today.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/audit-logs` | query: `table_name?`, `record_id?`, `changed_by_id?`, `action?`, `from?`, `to?` (dates) |
| GET | `/api/audit-logs/:id` | full `before_data`/`after_data` JSON diff |

### 14.2 Analytics — farm overview

```
GET /api/analytics/overview
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

### 14.3 Analytics — batch performance & P&L

```
GET /api/analytics/batches/:id/performance
```
```json
{
  "batch_id": "...", "live_count": 680, "initial_chick_count": 1000,
  "cumulative_died": 20, "cumulative_mortality_rate": 0.02,
  "age_days": 14, "expected_selling_date": "...", "actual_end_date": null,
  "latest_average_weight_grams": "500", "latest_weight_date": "..."
}
```
**No FCR field** — feed is logged in whatever `Unit` the item uses (`BAG`,
`KG`, ...), and turning that into a true feed-conversion ratio needs a
per-unit weight table this system doesn't have. Don't compute one
client-side either without that same missing conversion table — an FCR
built on an unstated unit assumption is worse than none.

```
GET /api/analytics/batches/:id/pnl
```
```json
{
  "batch_id": "...", "revenue": "118000", "purchase_cost": "15000",
  "direct_expenses": "2000", "depreciation_share": "4000",
  "shared_period_expenses_unallocated": "1500", "profit": "97000"
}
```
`revenue` = sum of `BirdSale.total_amount` for the batch. `purchase_cost` =
sum of `PurchaseItem.total_price` linked to the batch (chicks, and anything
else explicitly tagged with this `batch_id`). `profit = revenue −
purchase_cost − direct_expenses − depreciation_share`.
`shared_period_expenses_unallocated` is reported but **not** subtracted
into `profit` — it's shown so the UI can flag "there's N in shared costs
not yet allocated to this batch," not silently baked into the number.

### 14.4 Analytics — financial dashboard

```
GET /api/analytics/financial?month=2026-08-01
```
`month` optional, defaults to the current month; any date within the target
month works (normalized server-side).
```json
{
  "month": "2026-08",
  "revenue": "118000", "expenses": "2000", "gross_profit": "116000",
  "outstanding_payables": "45000",
  "cash_position": "70000",
  "cash_by_instrument": [
    { "instrument_id": "...", "label": "Farm Bank", "balance": "70000" }
  ]
}
```
`revenue`/`expenses` are scoped to the given month (`Sale.sale_date` /
`BirdSale.sale_date` / `Expense.date` within it). `outstanding_payables` is
**all-time**, not month-scoped (sum of every `Purchase.due_amount`).
`cash_position` sums every active `PaymentInstrument`'s balance (incoming
minus outgoing, all-time) — same computation as §15.1's per-instrument
balance endpoint, just totaled.

---

## 15. Payments

### 15.1 Payment Instruments

Full CRUD + deactivate/reactivate (own `is_active`, §1.6).
`owner_type`/`owner_id` is a polymorphic reference (§1.8) — e.g. the farm's
own bank account has `owner_type: "ADMIN"`, a supplier's account has
`owner_type: "SUPPLIER", owner_id: <Suppliers.id>`.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/payment-instruments` | query: `owner_type?`, `owner_id?`, `is_active?` |
| GET | `/api/payment-instruments/:id` | — |
| GET | `/api/payment-instruments/:id/balance` | `{ instrument_id, incoming, outgoing, balance }` — computed, not stored |
| POST | `/api/payment-instruments` | `{ owner_type, owner_id, type: PaymentMethod, label, bank_name?, account_no?, mobile_no?, mfs_type? }` |
| PATCH | `/api/payment-instruments/:id` | `{ type?, label?, bank_name?, account_no?, mobile_no?, mfs_type? }` (`owner_type`/`owner_id` not editable) |
| POST | `/api/payment-instruments/:id/deactivate` | — |
| POST | `/api/payment-instruments/:id/reactivate` | — |

### 15.2 Payments

Append-only (§1.5).

| Method | Path | Body / Query |
|---|---|---|
| GET | `/api/payments` | query: `ref_type?`, `ref_id?`, `direction?`, `instrument_id?` (matches either from/to) |
| GET | `/api/payments/total-paid` | query (**required**): `ref_type`, `ref_id` → `{ ref_type, ref_id, total_paid }` |
| GET | `/api/payments/:id` | — |
| POST | `/api/payments` | `{ amount, payment_date, direction: PaymentType, ref_type: PaymentRefType, ref_id, from_instrument_id, to_instrument_id?, transaction_ref?, handled_by_id?, note? }` |

`from_instrument_id` must reference a real `PaymentInstrument` (400 if not,
via the shared FK-violation handler); `to_instrument_id` is optional (e.g.
an outgoing payment to a supplier whose exact receiving account isn't
tracked). **This is the read-time substitute for a mutable `due_amount`**
(§1.5, §8 note) — use `total-paid` to compute "how much of this
Purchase/Sale/BirdSale/Expense/Payroll is actually paid off" rather than
trusting any `due_amount` field to update itself.

---

## 16. Building the mobile app — role/permission notes

`FEATURES.md` §3 has the full breakdown; the load-bearing points for
implementation:

- **Intern**: read-only + environment readings + weight-sample assist. Don't
  expose `POST /api/mortality-logs`, `/api/consumptions`,
  `/api/medications`, `/api/vaccinations` in an Intern's UI at all — nothing
  server-side blocks it today (no Auth/permissions yet, §1.3), but the
  intended role boundary is enforced client-side until Phase 15 exists.
- **Worker**: adds mortality/consumption/treatment logging (all of §7.4,
  §9.1–9.2) on top of Intern.
- **Manager**: adds `BatchHouseAllocation` (§7.2), `BatchFeedingProgram`
  (§9.5), `PerformanceScoreEntry` (§12.1, scoring Workers/Interns), and the
  two Manager-specific writes: `StockUnit.bind`/`relocate` (§6.4, receiving
  deliveries in the field) and `InventoryAdjustment` (§6.7, reporting a
  discrepancy found in the field).
- **Every mobile write should generate `idempotency_key` client-side before
  the first send attempt** (§1.7) — the whole point is surviving a flaky
  connection retrying a queued write without double-inserting.
- Purchases, Sales, Payments, Finance, and Admin/Employee management stay
  web-dashboard-only — don't build mobile UI for any endpoint in §2, §3,
  §8, §10, §11, or §15.
