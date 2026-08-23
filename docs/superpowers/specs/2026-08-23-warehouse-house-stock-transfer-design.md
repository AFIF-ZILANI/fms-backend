# Warehouse → House stock transfer

## Problem

Inventory items (Medicine, Rice Husk, Feed, ...) currently have exactly two
states: sitting in undifferentiated stock (after a Purchase), or consumed
(via Consumption, which requires a `house_id`). There is no way to say "50 kg
of Rice Husk is now at House 3, on hand but not yet used" — stock either
exists in aggregate or has already been used.

`StockLedger.location_type`/`location_id` are defined in the schema but
written by nobody. A `TRANSFER` value exists in the `StockReason` enum but is
dead code for inventory — it's only wired up for a separate feature
(`batch-house-allocation`) that moves *birds* between houses, unrelated to
stock items.

This spec adds a real transfer: move a quantity of an item from a specific
warehouse to a specific house, so it becomes visible as "on hand at that
house" before it's consumed, and makes `location_type`/`location_id` finally
mean something across the board.

## Goals

- Record a transfer of an item from a warehouse to a house.
- Show current balance-on-hand per warehouse and per house.
- Make Consumption at a house honest: you can't consume more than what's
  actually been transferred there.
- Make Purchases honest about where stock lands, since "available at
  Warehouse X" is meaningless if purchases don't say which warehouse they
  went to.

## Non-goals

- Retroactively backfilling `location_type`/`location_id` on historical
  StockLedger rows. Existing rows stay untagged; balance math treats
  untagged as unattributed, never guessed.
- A warehouse detail page. The transfer dialog shows "available: X" inline;
  no new page for warehouses.
- Changing how the *coded* `StockUnit` draw path works (medicine
  vials/equipment tracked individually via `remaining_quantity` and the
  existing "Relocate" button). That's a separate mechanism and is untouched.
- A dedicated `GET /stock-transfers` list endpoint. A transfer's two
  `StockLedger` rows already show up in the existing Stock Ledger tab.

## Data model

### `Purchase.warehouse_id` (new, required for new writes)

```prisma
model Purchase {
  ...
  warehouse_id  String?
  warehouse     Warehouses? @relation(fields: [warehouse_id], references: [id])
  ...
}
```

Nullable in the schema (there is already one real `Purchase` row in the dev
database with a payment against it — not test debris, not something this
spec touches or deletes), but required by the `createPurchaseSchema` Zod
validator for every new write. Same "nullable at the DB level, enforced at
the API level" split as the Migration notes section below describes — the
one existing row keeps `warehouse_id = NULL` forever and is simply never
counted toward any warehouse's balance.

### `RefType` gains `TRANSFER`

```prisma
enum RefType {
  PURCHASE
  CONSUMPTION
  ADJUSTMENT
  TRANSFER
}
```

### New model: `StockTransfer`

```prisma
model StockTransfer {
  id                String     @id @default(uuid())
  item_id           String
  item              Item       @relation(fields: [item_id], references: [id])
  from_warehouse_id String
  from_warehouse    Warehouses @relation(fields: [from_warehouse_id], references: [id])
  to_house_id       String
  to_house          Houses     @relation(fields: [to_house_id], references: [id])
  quantity          Decimal    @db.Decimal(10, 3) // as entered, in `unit`
  unit              String
  unitRef           Unit       @relation(fields: [unit], references: [code], onUpdate: Cascade)
  base_quantity     Decimal    @db.Decimal(10, 3) // quantity converted to Item.unit, snapshotted at write time
  note              String?
  recorded_by_id    String
  recorded_by       Profiles   @relation(fields: [recorded_by_id], references: [id])
  created_at        DateTime   @default(now())
  idempotency_key   String     @unique

  @@index([item_id])
  @@index([to_house_id])
}
```

Mirrors `PurchaseItem`'s quantity/unit/base_quantity shape exactly — same
reasoning: `quantity`+`unit` is what the user typed, `base_quantity` is what
actually moves through `StockLedger`.

### `StockLedger.location_type`/`location_id` — wired up everywhere

`StockLedgerService.record()`'s `LedgerEntryInput` type currently omits these
two fields entirely, so no caller can populate them even if it wanted to.
Add them as optional fields to that type, then update every existing caller:

| Caller | `location_type` | `location_id` |
|---|---|---|
| `purchase.service.ts` (IN) | `WAREHOUSE` | `data.warehouse_id` (new field, above) |
| `consumption.service.ts` (OUT, aggregate path only) | `HOUSE` | `data.house_id` (already exists) |
| `inventory-adjustment.service.ts` (IN or OUT) | `WAREHOUSE` or `HOUSE` | whichever of `data.warehouse_id`/`data.house_id` was set (already exists on that model) |
| New `transfer.service.ts` (OUT) | `WAREHOUSE` | `data.from_warehouse_id` |
| New `transfer.service.ts` (IN) | `HOUSE` | `data.to_house_id` |

The coded `StockUnit` consumption path (drawing from a specific vial/unit)
does **not** get a location tag from this change — it's a different
mechanism (see Non-goals).

## Business rules

### Transfer validation

- Quantity must be positive.
- Quantity (converted to base units) must not exceed the item's current
  balance *at `from_warehouse_id` specifically* — computed by summing that
  warehouse's `WAREHOUSE`-tagged `StockLedger` rows for that item (IN minus
  OUT). Reject with a clear "only X available at this warehouse" error,
  same style as the existing `PurchaseService`/`ConsumptionService` errors.
- Unit: the item's *usable* units only (`ItemUnit.is_usable = true`, plus
  the item's own base unit — always implicitly usable, same as everywhere
  else in the app). Never purchase-only units like Bag or Metric Ton.
  Conversion via the existing `toBaseQuantity(tx, item_id, unit, quantity,
  "USABLE")`.
- `recorded_by_id` resolved silently (last-picked admin, same pattern as
  every other "no picker" flow this session) — not user-entered.

### Consumption validation (new constraint)

- For the aggregate (non-coded) draw path only: quantity (converted to base
  units) must not exceed the item's current balance *at `house_id`
  specifically* — summed the same way as the warehouse check above, but
  over `HOUSE`-tagged rows for that house. Reject with a clear "only X of
  this item is on hand at this house" error.
- The coded `StockUnit` draw path (checks `remaining_quantity`) is
  unchanged — this new check applies only when `stock_unit_id` is absent.

### Purchase (changed)

- `warehouse_id` becomes a required field on `POST /purchases`. Every
  purchase must specify which warehouse the stock lands in.

## API surface

- `POST /stock-transfers` — creates the `StockTransfer` row and its two
  `StockLedger` entries in one transaction. Body: `item_id`,
  `from_warehouse_id`, `to_house_id`, `quantity`, `unit`, `note?`,
  `recorded_by_id`, `idempotency_key?`.
- `GET /warehouses/:id/stock` — `[{ item_id, item_name, unit, balance }]`,
  current balance per item at that warehouse (only items with a nonzero
  balance).
- `GET /houses/:id/stock` — same shape, for a house.
- `POST /purchases` — `warehouse_id` added as a required body field.

New balance helper in `lib/stock-balance.ts`:

```ts
export async function getLocationStock(
  location_type: "WAREHOUSE" | "HOUSE",
  location_id: string,
): Promise<{ item_id: string; balance: Prisma.Decimal }[]>
```

Groups `StockLedger` by `item_id`/`direction` filtered to that
`location_type`+`location_id`, same `groupBy` shape as the existing
`getItemBalances` (which stays completely unchanged — it already sums
across all locations, and a transfer nets to zero company-wide, so the
item's total balance is never affected by where the stock physically sits).

## UI

- **Purchase form** (`purchase-create-page.tsx`): new required "Warehouse"
  select, same row as Supplier/Invoice number/Purchase date.
- **Stock Ledger tab**: new "Transfer to house" button next to "Record
  opening balance" → dialog (item, quantity + unit select restricted to
  usable units, from-warehouse, to-house, note). Same shape as
  `AdjustmentFormDialog`'s opening-balance mode: no reason/recorded-by
  pickers, `NumericInput` for quantity.
- **House detail page** (`house-detail-page.tsx`): new "View stock" button
  → dialog showing that house's current on-hand balance per item (from
  `GET /houses/:id/stock`). No permanent card, no new page — a dialog,
  matching every other "show me current state" surface in this app.

## Migration notes

- `Purchase.warehouse_id`: added as a nullable column (there's one real
  existing `Purchase` row with a payment against it — not deleted, not
  backfilled), with the `createPurchaseSchema` *validator* requiring it for
  all new writes. The one pre-existing row keeps `warehouse_id = NULL`
  forever; nothing reads it for old data, so this is inert, not broken.
- No other backfill. Existing `StockLedger` rows stay untagged
  (`location_type = NULL`). Per-warehouse/per-house balances only reflect
  activity recorded from this feature's rollout onward — this is stated
  as a known, accepted limitation, not a bug to fix later.
- Operational rollout requirement: because of the no-backfill decision above,
  every house starts at a zero on-hand balance for every item once this
  ships. `ConsumptionService.create`'s aggregate path enforces balance
  against `StockLedger`, so the first aggregate Consumption recorded at any
  house will be rejected with `409 "Only 0 of this item is on hand at this
  house"` until stock actually reaches that house. Each house therefore
  needs an initial Transfer recorded into it (sourced from a Warehouse that
  itself has stock, via a Purchase or an opening-balance entry) before
  aggregate feeding/dosing can be recorded there. This is expected behavior
  per this feature's design — Consumption should require real on-hand
  stock — not a bug, but it is an operational step someone must take for
  each house; it does not resolve itself.

## Testing

- `getLocationStock` — sums correctly per warehouse/house, ignores
  untagged rows, returns empty for a location with no activity.
- `TransferService.create` — happy path posts both ledger rows correctly;
  rejects when requested quantity exceeds warehouse balance; rejects a unit
  that isn't usable for the item; rejects a unit from a different base
  family (reuses the existing family-check logic).
- `ConsumptionService.create` (aggregate path) — rejects when quantity
  exceeds house balance; unaffected when a coded `stock_unit_id` is given
  (existing behavior preserved); a transfer followed by a consumption at
  the same house within the transferred amount succeeds.
- `PurchaseService.create` — rejects when `warehouse_id` is missing; posts
  `location_type`/`location_id` on its `StockLedger` entries correctly.
