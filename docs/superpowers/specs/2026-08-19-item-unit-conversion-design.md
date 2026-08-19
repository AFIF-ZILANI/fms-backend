# Item unit conversion design

**Date:** 2026-08-19
**Status:** approved, not yet implemented

## Problem

Items are bought in one unit and used in another — feed is bought in Metric
Ton (MT) but the farm consumes it in Bags (50kg) or Kg. Today:

- `Item.unit` is the item's single canonical unit.
- `PurchaseItem.unit` is a free-text field that can already differ from
  `Item.unit`, but **no conversion factor is stored anywhere** — nothing
  ties "1 MT" back to `Item.unit`.
- `Consumption` has no unit field at all; its `quantity` is written straight
  to `StockLedger` (`consumption.service.ts`), implicitly assumed to already
  be in `Item.unit`.
- `getItemAvgCosts` (`stock-value.ts`) sums `PurchaseItem.quantity` and
  `total_price` across all purchases of an item and divides — with **no unit
  normalization**. If the same item is ever bought in mixed units (MT one
  time, Kg another), the average is already silently wrong today.
- `purchase.service.ts` never writes to `StockLedger` at all — purchases
  currently don't move stock balance.

## Decisions

- Unit conversion is needed on both purchase and consumption entry, not
  purchase alone.
- A unit like "Bag" is not a fixed universal size — it varies per item (a
  feed bag and a lime bag aren't the same weight), so conversion factors are
  scoped per item, not global per unit-pair.
- A single item may have more than one alternate unit at once (buy in MT,
  consume in Bags, base-track in Kg).
- The purchase→StockLedger gap is fixed as part of this same piece of work,
  since wiring `base_quantity` into the ledger touches that code path
  anyway.

## Design

### `ItemUnit` (new model)

```prisma
model ItemUnit {
  id             String  @id @default(uuid())
  item_id        String
  item           Item    @relation(fields: [item_id], references: [id], onDelete: Cascade)
  unit           String
  unitRef        Unit    @relation(fields: [unit], references: [code])
  factor_to_base Decimal @db.Decimal(12, 4) // 1 of `unit` = this many of Item.unit

  @@unique([item_id, unit])
}
```

`Item.unit` keeps its current meaning: the canonical base unit that
`StockLedger`, stock balance, and avg-cost are always expressed in. No
change to `Item` or `StockLedger` schema.

A transaction (purchase line or consumption entry) may name any unit that
is either `Item.unit` itself (implicit factor 1, no row needed) or has a
matching `ItemUnit` row for that item. Any other unit is rejected at
validation.

### `PurchaseItem` — add `base_quantity`

`quantity` + `unit` keep meaning exactly what they mean today: what was
actually entered ("2" / "MT"), paired with `unit_price` at that unit. Add:

```prisma
base_quantity Decimal @db.Decimal(12, 3) // quantity converted to Item.unit at write time
```

Computed once at write time as `quantity × factor_to_base` and stored
(snapshotted), the same way `unit_price`/`total_price` are already
snapshotted rather than recomputed from current prices. This means editing
an `ItemUnit` factor later never retroactively changes historical purchase
records.

`purchase.service.ts` gains a `StockLedgerService` write (direction `IN`)
using `base_quantity`, closing the existing gap where purchases never
touched stock balance.

### `Consumption` — add `unit` and `base_quantity`

```prisma
unit          String
unitRef       Unit    @relation(fields: [unit], references: [code], onUpdate: Cascade)
base_quantity Decimal @db.Decimal(12, 3)
```

`quantity` keeps its current meaning (what was entered — "3" / "BAG").
`base_quantity` is computed the same way as `PurchaseItem`'s, at write
time. `consumption.service.ts`'s existing `StockLedgerService` call
switches from passing `quantity` to passing `base_quantity`.

### Validation

`purchase.validator.ts` and `consumption.validator.ts` reject any `unit`
value that is not `Item.unit` and has no matching `ItemUnit` row for that
`item_id`.

### `getItemAvgCosts` fix

`stock-value.ts` currently sums raw `PurchaseItem.quantity`. It switches to
summing `base_quantity`, so cost-per-base-unit stays correct regardless of
what unit each individual purchase was entered in.

## Out of scope

- Historical/versioned conversion factors (e.g. a bag size that changes
  over time) — not requested; `ItemUnit` holds one current factor per
  item+unit. If a factor needs to change, existing `base_quantity` snapshots
  on past transactions are unaffected; only new transactions use the new
  factor.
- UI defaults (e.g. pre-selecting MT as the default purchase unit) — a
  frontend concern, not a schema one.
- `StockUnit` (per-bottle/vial tracking for medicine/vaccine/equipment) is
  unaffected — those items don't use pack-size conversion, they're tracked
  by individual coded unit.
