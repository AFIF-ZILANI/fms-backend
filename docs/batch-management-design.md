# Batch Management — Design Doc

Extends `docs/inventory-tracking-design.md` (same `Purchase`/`PurchaseItem`/
`Consumption` foundation). Standalone otherwise.

## Constraints from this round

- No execution capacity to log every house event right now. Only **mortality** gets
  real event-level tracking; it's also what advanced analytics will eventually need.
- **Feed** is tracked at allocation granularity only — how much moved into which
  house, when — not per-feeding events. **Water** isn't tracked at all yet.
- Chicks for one batch can come from the same or different suppliers, at the same or
  different prices, in different counts, arriving same-day or 1–2 days apart.
- Chicks go into a **brooder** house first, then shift to a **grower** house later;
  that shift itself can happen in one day or be staggered over 2–3 days.

## Solution

### 1. Drop the generic `HouseEvents` table — mortality gets its own focused log

A three-way `event_type` enum (FEED/WATER/MORTALITY) is overkill for tracking one
thing. Replace it with:

```prisma
model MortalityLog {
  id         String   @id @default(uuid())
  batch_id   String
  batch      Batches  @relation(fields: [batch_id], references: [id])
  house_id   String
  house      Houses   @relation(fields: [house_id], references: [id])
  count_died Int
  cause_note String?
  date       DateTime
  created_by String
  created_at DateTime @default(now())

  @@index([batch_id])
  @@index([house_id, date])
}
```

`skipped: FEED/WATER event types entirely — add a generic house-event log back if/when water tracking execution becomes realistic.`

### 2. Feed allocation reuses `Consumption` — no new table

`Consumption` already has exactly the shape you described: batch, house, item,
quantity, date. A feed delivery to a house is one row:
`Consumption(batch_id, house_id, item_id=<feed>, quantity, date)`. This was already
designed for coded-item usage logging in the inventory doc; feed just uses it at
coarser granularity (per delivery, not per feeding). No schema change needed here.

### 3. Chicks purchasing moves onto `Purchase`/`PurchaseItem`, drop `BatchSuppliers`

`BatchSuppliers` has `@@unique([batch_id, supplier_id])` — one row per supplier per
batch. That blocks the exact case you described: the same supplier delivering chicks
to the same batch twice at different prices. It also duplicates what
`PurchaseItem` already models for every other item.

Fix: add a nullable `batch_id` to `PurchaseItem`, remove `BatchSuppliers`.

```prisma
model PurchaseItem {
  id              String    @id @default(uuid())
  purchase_id     String
  purchase        Purchase  @relation(fields: [purchase_id], references: [id])
  item_id         String
  item            Item      @relation(fields: [item_id], references: [id])
  batch_id        String?   // set for chicks — the batch this delivery funds
  batch           Batches?  @relation(fields: [batch_id], references: [id])
  quantity        Decimal   @db.Decimal(10, 3)
  unit            Units
  unit_price      Decimal   @db.Decimal(10, 2)
  total_price     Decimal   @db.Decimal(10, 2)
  mfg_date        DateTime?
  expiration_date DateTime?
  created_at      DateTime  @default(now())

  @@index([item_id])
  @@index([batch_id])
}
```

Supplier attribution already lives on `Purchase.supplier_id` — no change needed
there. Now: same supplier, different price, different day, same batch → just another
`Purchase` + `PurchaseItem` row with the same `batch_id`. Different supplier, same
day → same thing. No unique constraint stands in the way, and it's the same pattern
already established for medicine lots — one mechanism for both.

### 4. House placement & brooder→grower transfer — no schema change, just a workflow

`BatchHouseAllocation` already fits this. Two uses of it:

- **Initial placement**: for every chicks `PurchaseItem`, create a matching
  `BatchHouseAllocation(reason=INITIAL, to_house_id=<brooder>, quantity=<that
delivery's chick count>, occurred_at=<delivery date>)`. Keeps the financial event
  (purchase) and the physical event (birds placed in a house) as two records — a
  batch can exist financially before its chicks are physically counted into a house,
  consistent with how FMS already treats batch creation.
- **Brooder → grower shift**: `reason=TRANSFER`, `from_house_id=<brooder>`,
  `to_house_id=<grower>`. A shift staggered over 2–3 days is just multiple rows with
  the same batch/from/to and partial quantities summing to the total — the model
  already supports this, nothing new to build.

### 5. `BatchHouseBalance` — keep it, but define what maintains it

This is a cached "how many birds of batch B are in house H right now." With
`HouseEvents` gone, exactly three things can change that number:
`BatchHouseAllocation` inserts, `MortalityLog` inserts, and `BirdSale` inserts (birds
leaving via sale before a batch fully closes). All three need to update
`BatchHouseBalance` in the **same transaction** they're written in — if that update
ever happens as a separate step, the cache will drift from the real sum and you'll
trust a wrong number without knowing it.

## What this doesn't solve (still open, not blocking)

- Bird-days allocation math itself (v2, per the original FMS plan) — this just makes
  sure the three inputs it needs (placements, transfers, mortality) are logged
  correctly; the allocation formula is separate future work.
- Batch closing lifecycle (`RUNNING`/`CLOSED`/`SOLD` transition triggers) — flagged
  last round, still undefined, still worth a pass before equipment depreciation or
  final batch P&L get built.
- `cost_type` classification on `Expense` — same gap as before, applies here too.

## Next Steps

Schema design only — no migration yet. Fold this into the same implementation plan
as the inventory design once you're ready to move to writing-plans.
