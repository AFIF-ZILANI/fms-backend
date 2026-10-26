# Inventory simulation -- report

Driven through the HTTP API as admin / manager / worker against the running batch `SIM3-2026-09-16`, then audited against the database. Took 1s.

**Checks: 195/195 passed, 0 failed.** Findings: 0 bugs, 0 gaps, 0 notes.

## Findings

- none

## By section

| Section | Pass | Fail |
|---|---|---|
| 1 catalog | 15 | 0 |
| 2 purchases | 23 | 0 |
| 3 coded units | 17 | 0 |
| 4 allocation | 28 | 0 |
| 5 consumption | 24 | 0 |
| 6 adjustments | 16 | 0 |
| 7 disposal | 17 | 0 |
| 8 assets | 14 | 0 |
| 9 alerts | 6 | 0 |
| 10 concurrency | 5 | 0 |
| 11 item lifecycle | 12 | 0 |
| 12 reports | 18 | 0 |

## Failed checks

- none

## All checks

- PASS [1 catalog] duplicate item name (different case) -> 409
- PASS [1 catalog] item in unknown category -> 400
- PASS [1 catalog] item with a derived base unit -> 400
- PASS [1 catalog] ItemUnit BAG on a KG item
- PASS [1 catalog] ItemUnit = the base unit -> 400
- PASS [1 catalog] ItemUnit from another family (LITER on KG item) -> 400
- PASS [1 catalog] duplicate ItemUnit -> 409
- PASS [1 catalog] fixed_factor wins over a typo'd factor (ML stored as 0.001, sent 5)
- PASS [1 catalog] ItemUnit KG-family unit (SACHETS) on a PCS item -> 400
- PASS [1 catalog] rename warehouse
- PASS [1 catalog] delete an unused warehouse
- PASS [1 catalog] delete a warehouse with stock history -> 409
- PASS [1 catalog] duplicate item-organization link -> 409
- PASS [1 catalog] remove item-organization link
- PASS [1 catalog] item shows its supplier link
- PASS [2 purchases] purchase P1-feed: total = Σ line nets - discount
- PASS [2 purchases] ledger IN: 20 BAG -> 1000 kg at WAREHOUSE with net unit cost 57/kg
- PASS [2 purchases] purchase P2-vet: total = Σ line nets - discount
- PASS [2 purchases] purchase P3-annex: total = Σ line nets - discount
- PASS [2 purchases] purchase P4-heater-lot: total = Σ line nets - discount
- PASS [2 purchases] discount_type without value -> 400
- PASS [2 purchases] PERCENT discount over 100 -> 400
- PASS [2 purchases] FLAT line discount bigger than the line -> 400
- PASS [2 purchases] paid more than the total -> 400
- PASS [2 purchases] paid without an account -> 400
- PASS [2 purchases] paid from an inactive account -> 400
- PASS [2 purchases] BAG on an item with no conversion -> 400
- PASS [2 purchases] zero quantity -> 400
- PASS [2 purchases] empty purchase -> 400
- PASS [2 purchases] unknown item -> 400
- PASS [2 purchases] unknown warehouse -> 4xx
- PASS [2 purchases] worker cannot purchase -> 403
- PASS [2 purchases] no ledger rows leaked from refused purchases
- PASS [2 purchases] overpay a purchase -> 400
- PASS [2 purchases] pay a purchase without a source account -> 400
- PASS [2 purchases] total paid = 24,000 + 10,000
- PASS [2 purchases] a fully paid purchase refuses more -> 400
- PASS [2 purchases] payments list reflects all paid purchases
- PASS [3 coded units] 14 blank codes provisioned UNASSIGNED
- PASS [3 coded units] provision over the 500 cap -> 400
- PASS [3 coded units] 5th vial on a lot split into 4 -> 409
- PASS [3 coded units] bind with a different unit_count than the lot's -> 409
- PASS [3 coded units] bind to a lot of a non-tracked item -> 400
- PASS [3 coded units] bind an already-bound code -> 409
- PASS [3 coded units] bind needs a manager: worker -> 403
- PASS [3 coded units] bound units are BOUND with bound_by
- PASS [3 coded units] complete a lot with more units declared than linked -> 400
- PASS [3 coded units] complete a lot -> ok
- PASS [3 coded units] complete it again -> 409
- PASS [3 coded units] complete a lot that already has a count -> 409
- PASS [3 coded units] complete a non-tracked lot -> 400
- PASS [3 coded units] counts endpoint has UNASSIGNED and BOUND
- PASS [3 coded units] search by id fragment
- PASS [3 coded units] filter by category=VACCINE
- PASS [3 coded units] purchase-items list for the lot shows linked units
- PASS [4 allocation] vial -> house A is an ALLOCATION
- PASS [4 allocation] vial 2 -> house A
- PASS [4 allocation] vial 2 house A -> house B is a REALLOCATION
- PASS [4 allocation] vial 2 house B -> warehouse is a RETURN
- PASS [4 allocation] relocate to where it already is -> 409
- PASS [4 allocation] relocate unknown unit -> 404
- PASS [4 allocation] relocate an UNASSIGNED blank code -> 4xx
- PASS [4 allocation] replayed relocation key is refused
- PASS [4 allocation] allocation log lists house A moves
- PASS [4 allocation] allocation filter by type=RETURN
- PASS [4 allocation] allocation summary counts today's moves
- PASS [4 allocation] house coded-stock lists vaccine, antibiotic, heater
- PASS [4 allocation] warehouse -> house A: 300 kg feed
- PASS [4 allocation] annex -> house A: 200 kg feed
- PASS [4 allocation] house A -> house B: 50 kg feed
- PASS [4 allocation] house B -> warehouse (return): 20 kg feed
- PASS [4 allocation] premix to house A: 4 kg
- PASS [4 allocation] transfer more than the source holds -> 409
- PASS [4 allocation] transfer to the same place -> 409
- PASS [4 allocation] warehouse -> warehouse -> 400
- PASS [4 allocation] transfer in BAG (purchasable, not usable) -> 400
- PASS [4 allocation] transfer to an unknown house -> 404
- PASS [4 allocation] transfer from an unknown warehouse -> 404
- PASS [4 allocation] worker cannot move warehouse stock -> 403
- PASS [4 allocation] transfer of a never-stocked item -> 409
- PASS [4 allocation] replayed transfer key -> 409 (no double move)
- PASS [4 allocation] unit move linked to its aggregate transfer
- PASS [4 allocation] link a unit to another item's transfer -> 400
- PASS [5 consumption] feed 100 kg at house A (batch-linked)
- PASS [5 consumption] premix 500 G -> 0.5 kg (derived usable unit)
- PASS [5 consumption] house-level feed with no batch is allowed
- PASS [5 consumption] feed beyond the house balance -> 409
- PASS [5 consumption] feed from a house that never got any -> 409
- PASS [5 consumption] BAG is not a usable unit -> 400
- PASS [5 consumption] ML on a KG item -> 400
- PASS [5 consumption] zero quantity -> 400
- PASS [5 consumption] unknown item -> 400
- PASS [5 consumption] keyed consumption 5 kg
- PASS [5 consumption] replayed consumption key -> 409
- PASS [5 consumption] vaccine: 4,000 doses from vial 1 (in house A)
- PASS [5 consumption] vial flips BOUND -> IN_USE on first draw
- PASS [5 consumption] same vial again (it is IN_USE)
- PASS [5 consumption] draw from a vial that is at the warehouse -> 409
- PASS [5 consumption] draw from a vial in another house -> 409
- PASS [5 consumption] unit of a different item -> 400
- PASS [5 consumption] unknown unit -> 404
- PASS [5 consumption] antibiotic 300 ML (usable derived unit) from bottle
- PASS [5 consumption] coded draw larger than the bottle/lot is refused
- PASS [5 consumption] equipment draw (1 unit, non-depleting)
- PASS [5 consumption] equipment draw posts no ledger OUT
- PASS [5 consumption] consumption summary counts today's draws
- PASS [5 consumption] consumption list filters by item
- PASS [6 adjustments] count correction down: server reads the real balance, ignores the client's quantity_before
- PASS [6 adjustments] count correction up
- PASS [6 adjustments] house adjustment with reason Wastage
- PASS [6 adjustments] Wastage adjustment posts ledger reason WASTAGE
- PASS [6 adjustments] Expired adjustment posts ledger reason EXPIRED
- PASS [6 adjustments] opening balance on an empty location
- PASS [6 adjustments] opening balance where stock exists -> 409
- PASS [6 adjustments] count equal to the balance -> 400
- PASS [6 adjustments] negative count -> 400
- PASS [6 adjustments] no location -> 400
- PASS [6 adjustments] unknown item -> 4xx
- PASS [6 adjustments] unknown warehouse -> 4xx
- PASS [6 adjustments] worker cannot adjust stock -> 403
- PASS [6 adjustments] replayed adjustment key is refused
- PASS [6 adjustments] adjusting a QR-coded item's warehouse count works
- PASS [6 adjustments] adjustment list filters by item
- PASS [7 disposal] dispose a vial
- PASS [7 disposal] disposal writes off the vial's 5,000 doses as WASTAGE at DISPOSAL
- PASS [7 disposal] dispose twice -> 409
- PASS [7 disposal] draw from a disposed vial -> 409
- PASS [7 disposal] disposal reduces item stock (ledger OUT/WASTAGE/DISPOSAL row written)
- PASS [7 disposal] marking a vial CONSUMED writes off its unused remainder
- PASS [7 disposal] a CONSUMED unit can't go back to BOUND -> 409
- PASS [7 disposal] draw from a CONSUMED vial -> 409
- PASS [7 disposal] relocate a DISPOSED unit -> 4xx
- PASS [7 disposal] DISPOSED is final: back to BOUND -> 409
- PASS [7 disposal] UNASSIGNED can't be set by hand -> 400
- PASS [7 disposal] consumed-from unit can't be hard-deleted -> 409
- PASS [7 disposal] a blank code can be deleted
- PASS [7 disposal] a bound but never-used unit can be deleted
- PASS [7 disposal] deleting a bound unit leaves the lot's unit_count alone (lot now 1 of 2 linked)
- PASS [7 disposal] bind a replacement code into the freed slot
- PASS [7 disposal] lot is whole again (2 of 2 linked)
- PASS [8 assets] asset registered on a heater unit
- PASS [8 assets] second asset on the same unit -> 409
- PASS [8 assets] asset on an unknown unit -> 4xx
- PASS [8 assets] asset with zero cost -> 400
- PASS [8 assets] retire an asset
- PASS [8 assets] delete a never-depreciated asset
- PASS [8 assets] unit with a linked asset can't be hard-deleted -> 409
- PASS [8 assets] heater drawn for the demo batch
- PASS [8 assets] heater drawn for the demo batch
- PASS [8 assets] demo batch force-closed
- PASS [8 assets] only the ACTIVE asset depreciates: 2500 / 5 batches = 500
- PASS [8 assets] asset-depreciations list shows it
- PASS [8 assets] delete an asset with depreciation history -> 409
- PASS [8 assets] batch P&L carries the depreciation share
- PASS [9 alerts] feed (reorder 50) is not low while stocked
- PASS [9 alerts] feed is low once reorder level > balance
- PASS [9 alerts] scan raises LOW_STOCK for the feed
- PASS [9 alerts] scan raises an expiry alert for the vaccine lot expiring in 12 days
- PASS [9 alerts] low-stock alert clears when the level is satisfied
- PASS [9 alerts] a negative item balance is surfaced by a scan (needs a reorder level to be set)
- PASS [10 concurrency] parallel draws of 30 kg against 337 kg: exactly 11 succeed
- PASS [10 concurrency] no negative feed balance after the race
- PASS [10 concurrency] parallel transfers: only what the annex holds leaves it
- PASS [10 concurrency] parallel binds on a full lot (3 of 3 already linked): none succeed
- PASS [10 concurrency] parallel payments: the purchase is never overpaid
- PASS [11 item lifecycle] deactivate an item
- PASS [11 item lifecycle] consume a deactivated item -> 400
- PASS [11 item lifecycle] transfer a deactivated item -> 400
- PASS [11 item lifecycle] purchase P5-deactivated: total = Σ line nets - discount
- PASS [11 item lifecycle] a deactivated item can still be purchased
- PASS [11 item lifecycle] deactivated items drop out of low-stock
- PASS [11 item lifecycle] delete an item with history -> 409
- PASS [11 item lifecycle] delete a never-used item
- PASS [11 item lifecycle] tracking mode can't change after purchase -> 409
- PASS [11 item lifecycle] transfer into a deactivated house -> 4xx
- PASS [11 item lifecycle] consume in a deactivated house -> 4xx
- PASS [11 item lifecycle] relocate a unit into a deactivated house -> 4xx
- PASS [12 reports] ledger matches the model at every item/location (14 cells)
- PASS [12 reports] no item has a negative total balance
- PASS [12 reports] warehouse stock endpoint = model (feed)
- PASS [12 reports] stock-by-location = model (feed at house A)
- PASS [12 reports] house stock endpoint = model (feed)
- PASS [12 reports] ledger summary: loss_30d counts our WASTAGE + EXPIRED rows
- PASS [12 reports] ledger list filter reason=WASTAGE
- PASS [12 reports] stock value FEED/VACCINE is positive-balance x avg cost (includes other tests' items, so >=)
- PASS [12 reports] stock movement trend has today's bucket
- PASS [12 reports] wastage report sees the Wastage/Expired adjustments
- PASS [12 reports] consumption-by-category lists FEED
- PASS [12 reports] purchase INV-P1-feed: payments = model
- PASS [12 reports] purchase INV-P2-vet: payments = model
- PASS [12 reports] purchase INV-P3-annex: payments = model
- PASS [12 reports] purchase INV-P4-heater-lot: payments = model
- PASS [12 reports] purchase INV-P5-deactivated: payments = model
- PASS [12 reports] financial dashboard payables include our open balances
- PASS [12 reports] every purchase total = its lines' total_price - discount
