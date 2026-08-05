# Inventory Unit Tracking — Design Doc

Status: Approved. Standalone — no need to cross-reference `codes/previous_schema.prisma`.

## Problem

1. **Same SKU, different price across purchases** — medicine bought at price Y, then
   again 10 days later at price Z. Nothing currently ties a physical bottle to the
   specific purchase (and price) it came from once it leaves its box.
2. **Physical units get separated from their purchase context** — a box of 12 bottles
   gets broken up, bottles move to racks for storage, and there's no printer on-site
   to label them at that moment, so codes have to be pre-printed and bound later.
3. **Medicine is house-bound, batches aren't** — a bottle carried into a shed doesn't
   fully drain there, and birds move between houses mid-batch (brooder → grower)
   independently of where any given bottle physically sits.
4. **Treatment records aren't linked to inventory at all today** — a medication/
   vaccination log is currently just a free-text medicine name, with no path back to
   which priced lot was actually used.

## Design Principles

- **Lot costing lives on `PurchaseItem`** — every unit bought on one purchase line
  shares one price. This is the anchor for "which price applied to this bottle."
- **Physical identity lives on `StockUnit`** — one row per individually-coded bottle
  or asset, bound to a `PurchaseItem` once received. Codes can be printed in bulk
  _before_ any purchase exists, because the physical sticker carries no information
  beyond an opaque ID — meaning lives entirely in the database.
- **All usage flows through one `Consumption` log** — batch, house, item, quantity,
  and (when relevant) which exact `StockUnit` it came from. This single event log is
  what a bottle spanning multiple batches, a house move, or a treatment record all
  hook into — no parallel bookkeeping mechanism per case.
- **Coded items only where it earns its keep**: medicine, vaccine, and equipment.
  Feed and other bulk/loose stock stay on the plain aggregate `StockLedger` — stable
  pricing, not purchased/consumed as discrete countable units, so per-unit codes
  would be overhead with no payoff.
- **House location is tracked, not enforced** — birds move houses via
  `BatchHouseAllocation` on their own schedule; a partially-used bottle doesn't
  automatically follow. `StockUnit.house_id` records where a bottle currently sits,
  updated manually if it's moved. No automatic transfer/reconciliation logic runs on
  a bird-house-move — leftover amounts are typically small enough that forcing every
  allocation event to also resolve open bottles would cost more than it saves.

## Schema

```prisma
// ── Enums ──────────────────────────────────────────────────────────

enum Units {
  BIRD
  KG
  LITER
  BAG
  BOX
  UNIT
  SACHETS
  BOTTLE
  ML
  L
  G
  PCS
  VIAL
  DOSE
  OTHER
}

enum ResourceCategories {
  FEED
  MEDICINE
  VACCINE
  SUPPLEMENT
  BIOSECURITY
  CHICKS
  EQUIPMENT
  UTILITIES
  OTHER
}

enum HouseType {
  BROODER
  GROWER
  LAYER
}

enum BatchStatus {
  RUNNING
  CLOSED
  SOLD
}

enum StockUnitStatus {
  UNASSIGNED // printed, not yet bound to a purchase
  IN_STOCK   // bound, sitting in storage, untouched
  IN_USE     // opened and being drawn down (medicine/vaccine), or currently assigned to a batch (equipment)
  CONSUMED   // fully depleted — medicine/vaccine only, equipment never reaches this
  DISPOSED   // written off — expired, damaged, discarded
}

enum AllocationReason {
  INITIAL    // placement into first house
  TRANSFER   // house → house move
  ADJUSTMENT // correction
}

enum StockDirection {
  IN
  OUT
}

enum StockReason {
  PURCHASE
  TRANSFER
  CONSUMPTION
  WASTAGE
  EXPIRED
  ADJUSTMENT
  OPENING_BALANCE
}

enum LocationType {
  WAREHOUSE
  HOUSE
  DISPOSAL
}

enum RefType {
  PURCHASE
  CONSUMPTION
  ADJUSTMENT
}

// ── Farm structure ───────────────────────────────────────────────────

model Houses {
  id         String    @id @default(uuid())
  name       String
  type       HouseType
  number     Int
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt

  stockUnits           StockUnit[]
  consumptions         Consumption[]
  batchAllocationsTo   BatchHouseAllocation[] @relation("ToHouse")
  batchAllocationsFrom BatchHouseAllocation[] @relation("FromHouse")
}

model Batches {
  id                    String      @id @default(uuid())
  batch_code            String      @unique
  starting_date         DateTime    @default(now())
  expected_selling_date DateTime
  status                BatchStatus @default(RUNNING)
  created_at            DateTime    @default(now())
  updated_at            DateTime    @updatedAt

  houseAllocations BatchHouseAllocation[]
  consumptions     Consumption[]
  medications      Medications[]
  vaccinations     Vaccinations[]
}

model BatchHouseAllocation {
  id            String           @id @default(uuid())
  batch_id      String
  batch         Batches          @relation(fields: [batch_id], references: [id], onDelete: Cascade)
  from_house_id String?
  from_house    Houses?          @relation("FromHouse", fields: [from_house_id], references: [id], onDelete: SetNull)
  to_house_id   String?
  to_house      Houses?          @relation("ToHouse", fields: [to_house_id], references: [id], onDelete: SetNull)
  quantity      Int              // birds moved in this event
  reason        AllocationReason
  occurred_at   DateTime         @default(now())
  created_at    DateTime         @default(now())

  @@index([batch_id])
}

// ── Purchasing & lot costing ─────────────────────────────────────────

model Item {
  id         String             @id @default(uuid())
  name       String
  category   ResourceCategories
  unit       Units
  created_at DateTime           @default(now())
  updated_at DateTime           @updatedAt

  purchaseItems PurchaseItem[]
  ledgerEntries StockLedger[]
  consumptions  Consumption[]

  @@index([name, category])
}

model Purchase {
  id            String         @id @default(uuid())
  vendor        String?
  invoice_no    String?
  purchase_date DateTime
  total_amount  Decimal        @db.Decimal(10, 2)
  paid_amount   Decimal        @db.Decimal(10, 2)
  due_amount    Decimal        @db.Decimal(10, 2)
  created_at    DateTime       @default(now())

  items PurchaseItem[]
}

model PurchaseItem {
  id              String    @id @default(uuid())
  purchase_id     String
  purchase        Purchase  @relation(fields: [purchase_id], references: [id])
  item_id         String
  item            Item      @relation(fields: [item_id], references: [id])
  quantity        Decimal   @db.Decimal(10, 3)
  unit            Units
  unit_price      Decimal   @db.Decimal(10, 2)
  total_price     Decimal   @db.Decimal(10, 2)
  mfg_date        DateTime?
  expiration_date DateTime?
  created_at      DateTime  @default(now())

  stockUnits StockUnit[]

  @@index([item_id])
}

// ── Physical unit tracking ───────────────────────────────────────────

model StockUnit {
  id                 String          @id @default(uuid())
  code               String          @unique // printed as QR + human-readable text
  purchase_item_id   String?         // null = blank, pre-printed, not yet bound
  purchase_item      PurchaseItem?   @relation(fields: [purchase_item_id], references: [id])
  status             StockUnitStatus @default(UNASSIGNED)
  initial_quantity   Decimal?        @db.Decimal(10, 3) // e.g. 1000 (mL); null for equipment
  remaining_quantity Decimal?        @db.Decimal(10, 3)
  house_id           String?         // current physical location, updated manually
  house              Houses?         @relation(fields: [house_id], references: [id])
  bound_at           DateTime?
  created_at         DateTime        @default(now())

  consumptions Consumption[]

  @@index([purchase_item_id])
  @@index([status])
}

// ── Consumption & treatment logging ──────────────────────────────────

model Consumption {
  id            String     @id @default(uuid())
  batch_id      String?
  batch         Batches?   @relation(fields: [batch_id], references: [id])
  house_id      String
  house         Houses     @relation(fields: [house_id], references: [id])
  item_id       String
  item          Item       @relation(fields: [item_id], references: [id])
  stock_unit_id String?    // set when drawn from a specific coded unit
  stock_unit    StockUnit? @relation(fields: [stock_unit_id], references: [id])
  quantity      Decimal    @db.Decimal(10, 3)
  date          DateTime
  note          String?
  created_at    DateTime   @default(now())

  medications  Medications[]
  vaccinations Vaccinations[]

  @@index([batch_id])
  @@index([house_id])
  @@index([stock_unit_id])
}

model Medications {
  id              String       @id @default(uuid())
  batch_id        String
  batch           Batches      @relation(fields: [batch_id], references: [id])
  consumption_id  String?      // links this treatment to the actual stock draw
  consumption     Consumption? @relation(fields: [consumption_id], references: [id])
  medicine_name   String       // kept for quick display / manual entries
  dosage          String
  administered_by String
  date            DateTime     @default(now())
  remarks         String?
  created_at      DateTime     @default(now())

  @@index([batch_id])
}

model Vaccinations {
  id              String       @id @default(uuid())
  batch_id        String
  batch           Batches      @relation(fields: [batch_id], references: [id])
  consumption_id  String?
  consumption     Consumption? @relation(fields: [consumption_id], references: [id])
  vaccine_name    String
  dosage          Int
  administered_by String
  date            DateTime     @default(now())
  remarks         String?
  created_at      DateTime     @default(now())

  @@index([batch_id])
}

// ── Aggregate ledger for non-coded items (e.g. feed) ─────────────────

model StockLedger {
  id              String         @id @default(uuid())
  item_id         String
  item            Item           @relation(fields: [item_id], references: [id])
  quantity        Decimal        @db.Decimal(10, 3)
  direction       StockDirection
  reason          StockReason
  unit_cost       Decimal?       @db.Decimal(10, 2)
  location_type   LocationType?
  location_id     String?
  ref_type        RefType
  ref_id          String
  idempotency_key String         @unique
  occurred_at     DateTime       @default(now())

  @@index([item_id, occurred_at])
  @@index([ref_type, ref_id])
}
```

## Code Lifecycle

```
[bulk print run] → StockUnit(status=UNASSIGNED, purchase_item_id=null)
       │
       ▼ (intake: bind to a purchase line)
  StockUnit(status=IN_STOCK, purchase_item_id=X, initial_quantity, remaining_quantity, house_id?)
       │
       ▼ (first use: carried to a house, dosed against a batch)
  Consumption(batch_id, house_id, item_id, stock_unit_id, quantity, date)
  → StockUnit.remaining_quantity -= quantity, status → IN_USE
       │
       ├─ repeats across batches/houses as the bottle gets reused ──┐
       │                                                            │
       ▼ (remaining_quantity hits 0)                                │
  StockUnit(status=CONSUMED)  ◄─────────────────────────────────────┘

  Equipment variant: Consumption(quantity=1) marks "batch started using this asset";
  StockUnit.status stays IN_USE, remaining_quantity untouched, never reaches CONSUMED.
```

`Medications`/`Vaccinations` rows link to the `Consumption` row that caused them,
which is what finally connects "batch got this treatment" to "at this cost, from this
lot" — a path that doesn't exist in the current system at all.

## Code Type: QR

- Farm labels get dirty/handled roughly — QR's error correction tolerates torn or
  smudged stickers far better than a 1D barcode.
- Scanning will eventually go through a phone camera (mobile app, separate design,
  already flagged as "discuss later") — QR is built for camera/2D-imager reads;
  barcodes want a dedicated laser scanner to be reliable.
- The `code` string is opaque — no item, price, or date printed on the label. All
  meaning lives in the database, looked up by that code — this is what makes
  pre-printing before knowing what you'll buy possible.
- Print a short human-readable version of the same code under the QR, so binding can
  be done by manual entry before a scanning app exists.

## Printing Workflow (no printer on-site)

1. One-time (or periodic) bulk print run: generate N unique codes, print as QR
   stickers via an external vendor (local print/sticker shop or an online custom
   label printing service) on weatherproof/laminated material — plain paper won't
   survive farm storage, and a ruined code breaks the whole chain.
2. Insert all N as `StockUnit` rows up front, `status = UNASSIGNED`, before any
   purchase happens. Same blank pool covers medicine, vaccine, and equipment.
3. At intake, peel off however many stickers are needed, apply one per bottle/asset,
   bind each to the new `PurchaseItem`.
4. Reorder before the unassigned pool runs low — order enough for a few months of
   expected purchases per run rather than reordering constantly, but don't overorder
   so far ahead a format change strands stock.

**On cost**: this is a commodity print job — price scales with quantity and label
material (paper vs weatherproof vinyl/polyester). Get 2-3 quotes from local
printing/sticker vendors or an online label printing service; I don't have current
pricing for your region to quote here.

## v1 Simplifications

- No mobile scanning app yet — binding and consumption logging happen via manual
  code entry wherever the intake/dosing UI ends up living.
- No automatic reorder-point alert for the blank-code pool — manual count check
  before ordering more.
- No automatic stock transfer/reconciliation when a batch moves houses — `house_id`
  is updated manually if a bottle needs to follow.
- Equipment depreciation math (dividing purchase cost across the batches that used
  it) is future work — this plan only makes sure the `Consumption` usage log exists
  for it to run against later.

## Open Items (deferred, not blocking this design)

- Exact QR payload format/length and the print vendor — pick when placing the order.
- Mobile app scanning flow — separate design conversation.
- Reconciling this with the `cost_type` (direct/shared_period/shared_capital) model
  from the earlier FMS planning doc (`docs/PREVIOUS_CONTEXT.md`) — worth a pass later
  to make sure cost classification and this `StockUnit` model agree on how medicine/
  vaccine/equipment costs reach batch P&L.

## Next Steps

This is a schema design, not an implementation — no migration has been written. Once
approved: save this doc to `docs/inventory-tracking-design.md`, then write an
implementation plan (migration + binding/consumption endpoints) via the writing-plans
skill.
