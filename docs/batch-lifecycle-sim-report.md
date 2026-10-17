# Batch lifecycle simulation -- report

Batch `SIM-2026-08-16` (HIBREED), 5000 chicks, 62 days (2026-08-16 -> 2026-10-16), driven through the HTTP API as admin / worker / manager. Run took 2s.

**Checks: 171/171 passed, 0 failed.**

## Headline numbers

| | |
|---|---|
| Chicks in / died / sold | 5000 / 305 (6.10%) / 4695 |
| Final avg weight (last sample) | 1756.33 g |
| Feed used | 20,175.3 kg  (FCR api 2.78, expected 2.78) |
| Revenue (sum of total_amount; 1,500 discounted at sale) | 1,955,061.7 |
| Chicks + direct expenses + consumed stock | 198,000 + 102,000 + 1,173,344.05 = 1,473,344.05 |
| True profit (revenue - discounts - costs) | 480,217.65 |
| P&L endpoint profit | 480,217.65 |
| Receivable (customers still owe) / payable (suppliers) | 262,531.38 / 839,250 |
| Feed left unused (warehouse + houses) | 1,574.7 kg |
| Active alerts after scan | 2 |

## Findings

- **NOTE** Item categories include VACCINE and SUPPLEMENT but supplier supply categories do not (FEED, MEDICINE, CHICKS, HUSK, ... only), so a vaccine/vitamin distributor can only be tagged MEDICINE.
- **GAP** Environment records, house allocations (incl. the INITIAL one), QR relocations and stock transfers have no client-settable timestamp (they stamp now()). Entries synced late from the offline mobile app would carry the sync time, not the time of the event. This sim back-dated them in SQL after the fact.
- **NOTE** actual_end_date is stamped with the close request time (new Date()), not the last sale. Closing a batch a day late shifts bird-days / depreciation accordingly.

## Failed checks

- none

## Alerts raised by the scan

- [WARNING] Jihad: "Blood sampling round" is overdue
- [INFO] Payroll not yet generated for 2 employees

## Day by day

| Day | Alive (EOD) | Died | Feed kg | Weight g | Events |
|---|---|---|---|---|---|
| 1 | 4987 | 13 | 50 |  | litter laid |
| 2 | 4972 | 15 | 60.1 |  |  |
| 3 | 4954 | 18 | 70.1 |  |  |
| 4 | 4947 | 7 | 80 |  |  |
| 5 | 4938 | 9 | 90 |  | ND B1 |
| 6 | 4931 | 7 | 100 |  |  |
| 7 | 4928 | 3 | 110 |  |  |
| 8 | 4915 | 13 | 120 | 89.89 |  |
| 9 | 4910 | 5 | 129.8 |  |  |
| 10 | 4907 | 3 | 139.7 |  |  |
| 11 | 4901 | 6 | 149.7 |  | IBD 1 |
| 12 | 4897 | 4 | 159.5 |  |  |
| 13 | 4895 | 2 | 169.4 |  |  |
| 14 | 4894 | 1 | 179.4 |  |  |
| 15 | 4890 | 4 | 189.4 | 193.47 | 60% moved to grower |
| 16 | 4887 | 3 | 199.3 |  | rest moved; brooder emptied |
| 17 | 4885 | 2 | 209.2 |  |  |
| 18 | 4885 | 0 | 219.1 |  | IBD booster |
| 19 | 4881 | 4 | 229.1 |  |  |
| 20 | 4875 | 6 | 238.9 |  |  |
| 21 | 4873 | 2 | 248.6 |  |  |
| 22 | 4867 | 6 | 258.5 | 342.06 | ND Lasota |
| 23 | 4866 | 1 | 268.2 |  |  |
| 24 | 4863 | 3 | 278.1 |  |  |
| 25 | 4861 | 2 | 287.9 |  |  |
| 26 | 4859 | 2 | 297.7 |  |  |
| 27 | 4856 | 3 | 307.6 |  |  |
| 28 | 4852 | 4 | 317.3 |  |  |
| 29 | 4829 | 23 | 327 | 527.29 |  |
| 30 | 4802 | 27 | 335.4 |  | antibiotic course |
| 31 | 4785 | 17 | 343.3 |  | antibiotic course |
| 32 | 4762 | 23 | 351.9 |  | antibiotic course |
| 33 | 4738 | 24 | 360 |  | antibiotic course |
| 34 | 4735 | 3 | 367.9 |  | antibiotic course |
| 35 | 4733 | 2 | 377.4 |  |  |
| 36 | 4732 | 1 | 386.9 | 728.31 | ND booster |
| 37 | 4729 | 3 | 396.5 |  |  |
| 38 | 4726 | 3 | 406 |  |  |
| 39 | 4726 | 0 | 415.4 |  |  |
| 40 | 4724 | 2 | 425.1 |  |  |
| 41 | 4721 | 3 | 434.6 |  |  |
| 42 | 4720 | 1 | 444 |  |  |
| 43 | 4718 | 2 | 453.6 | 914.7 |  |
| 44 | 4716 | 2 | 463.1 |  |  |
| 45 | 4714 | 2 | 472.5 |  |  |
| 46 | 4714 | 0 | 482 |  |  |
| 47 | 4712 | 2 | 491.7 |  |  |
| 48 | 4711 | 1 | 501.1 |  |  |
| 49 | 4710 | 1 | 510.7 |  |  |
| 50 | 4710 | 0 | 520.2 | 1176.64 |  |
| 51 | 4709 | 1 | 529.9 |  |  |
| 52 | 4709 | 0 | 539.4 |  |  |
| 53 | 4709 | 0 | 549.1 |  |  |
| 54 | 4708 | 1 | 558.7 |  |  |
| 55 | 4705 | 3 | 568.3 |  |  |
| 56 | 4703 | 2 | 577.5 |  |  |
| 57 | 4700 | 3 | 586.9 | 1502.43 |  |
| 58 | 3250 | 0 | 596.2 |  |  |
| 59 | 3250 | 0 | 418.9 |  |  |
| 60 | 1500 | 0 | 425.6 |  |  |
| 61 | 1499 | 1 | 199.5 |  |  |
| 62 | 0 | 4 | 202.4 | 1756.33 |  |

## All checks

- PASS pre: no batch with this code
- PASS pre: target houses empty
- PASS auth: no token -> 401
- PASS batch created RUNNING with initial balance
- PASS purchase d1 total = Σlines - discount
- PASS purchase d2 total = Σlines - discount
- PASS purchase d1 total = Σlines - discount
- PASS purchase d1 total = Σlines - discount
- PASS QR units bound (3 ND, 2 IBD, 2 abx)
- PASS day 1: house balances match model
- PASS day 2: house balances match model
- PASS replayed mortality idempotency_key is rejected
- PASS replay did not double-count
- PASS day 3: house balances match model
- PASS day 4: house balances match model
- PASS day 5: house balances match model
- PASS day 6: house balances match model
- PASS day 7: house balances match model
- PASS day 8: house balances match model
- PASS probe: mortality > live birds -> 409
- PASS day 9: house balances match model
- PASS probe: 2nd weight sample same day -> 409
- PASS day 10: house balances match model
- PASS day 11: house balances match model
- PASS day 12: house balances match model
- PASS probe: feed beyond house stock -> 409
- PASS day 13: house balances match model
- PASS purchase d14 total = Σlines - discount
- PASS day 14: house balances match model
- PASS day 15: house balances match model
- PASS brooder auto-CLEANING once emptied
- PASS batch phase -> GROWER
- PASS day 16: house balances match model
- PASS probe: move birds from emptied brooder -> 409
- PASS day 17: house balances match model
- PASS day 18: house balances match model
- PASS day 19: house balances match model
- PASS day 20: house balances match model
- PASS probe: worker cannot create a batch -> 403
- PASS day 21: house balances match model
- PASS day 22: house balances match model
- PASS day 23: house balances match model
- PASS day 24: house balances match model
- PASS probe: negative count -> 400
- PASS day 25: house balances match model
- PASS day 26: house balances match model
- PASS day 27: house balances match model
- PASS day 28: house balances match model
- PASS day 29: house balances match model
- PASS day 30: house balances match model
- PASS day 31: house balances match model
- PASS day 32: house balances match model
- PASS day 33: house balances match model
- PASS purchase d34 total = Σlines - discount
- PASS day 34: house balances match model
- PASS day 35: house balances match model
- PASS day 36: house balances match model
- PASS day 37: house balances match model
- PASS day 38: house balances match model
- PASS day 39: house balances match model
- PASS probe: worker cannot move warehouse stock -> 403
- PASS day 40: house balances match model
- PASS day 41: house balances match model
- PASS day 42: house balances match model
- PASS day 43: house balances match model
- PASS day 44: house balances match model
- PASS day 45: house balances match model
- PASS purchase d46 total = Σlines - discount
- PASS day 46: house balances match model
- PASS day 47: house balances match model
- PASS day 48: house balances match model
- PASS day 49: house balances match model
- PASS day 50: house balances match model
- PASS day 51: house balances match model
- PASS day 52: house balances match model
- PASS day 53: house balances match model
- PASS day 54: house balances match model
- PASS day 55: house balances match model
- PASS day 56: house balances match model
- PASS day 57: house balances match model
- PASS sale d58 HIGH: total_amount = net x price
- PASS sale d58 HIGH: due = total - discount
- PASS sale d58 LOW: total_amount = net x price
- PASS sale d58 LOW: due = total - discount
- PASS day 58: house balances match model
- PASS day 59: house balances match model
- PASS sale d60 HIGH: total_amount = net x price
- PASS sale d60 HIGH: due = total - discount
- PASS sale d60 LOW: total_amount = net x price
- PASS sale d60 LOW: due = total - discount
- PASS sale d60 CULL: total_amount = net x price
- PASS sale d60 CULL: due = total - discount
- PASS day 60: house balances match model
- PASS day 61: house balances match model
- PASS sale d62 HIGH: total_amount = net x price
- PASS sale d62 HIGH: due = total - discount
- PASS sale d62 LOW: total_amount = net x price
- PASS sale d62 LOW: due = total - discount
- PASS sale d62 CULL: total_amount = net x price
- PASS sale d62 CULL: due = total - discount
- PASS day 62: house balances match model
- PASS end: no live birds left
- PASS batch closes SOLD with zero birds, no force
- PASS probe: closing twice -> 409
- PASS probe: editing a closed batch -> 409
- PASS probe: mortality on a closed batch is refused
- PASS batch SOLD with actual_end_date
- PASS conservation: initial = died + sold + live
- PASS mortality rows sum = model
- PASS sold birds = model
- PASS allocations: INITIAL = chick count
- PASS allocations: moves out of brooder = into grower
- PASS allocations: balances all zero
- PASS chick purchase lines = initial_chick_count
- PASS chick purchase cost
- PASS houses both end CLEANING
- PASS count: vaccinations = 5
- PASS count: weight records = 9
- PASS count: mortality records >= 20
- PASS medications recorded (3 vitamin + 5 abx + 3 vitamin)
- PASS every med/vacc has a linked consumption
- PASS weights rise week over week (grower house)
- PASS ledger starter: warehouse = model
- PASS ledger starter: brooder = model
- PASS ledger starter: grower = model
- PASS consumption starter: DB = model
- PASS ledger grower: warehouse = model
- PASS ledger grower: brooder = model
- PASS ledger grower: grower = model
- PASS consumption grower: DB = model
- PASS ledger finisher: warehouse = model
- PASS ledger finisher: brooder = model
- PASS ledger finisher: grower = model
- PASS consumption finisher: DB = model
- PASS ledger husk: warehouse = model
- PASS ledger husk: brooder = model
- PASS ledger husk: grower = model
- PASS consumption husk: DB = model
- PASS ledger vitamin: warehouse = model
- PASS ledger vitamin: brooder = model
- PASS ledger vitamin: grower = model
- PASS consumption vitamin: DB = model
- PASS purchases: total = Σ lines - discount
- PASS purchase SIM-INV-1-7209: paid <= total
- PASS purchase SIM-INV-2-9d84: paid <= total
- PASS purchase SIM-INV-1-328a: paid <= total
- PASS purchase SIM-INV-1-877e: paid <= total
- PASS purchase SIM-INV-14-328a: paid <= total
- PASS purchase SIM-INV-34-328a: paid <= total
- PASS purchase SIM-INV-46-328a: paid <= total
- PASS sales revenue = model
- PASS analytics: cumulative_died
- PASS analytics: mortality rate
- PASS analytics: live_count = model
- PASS analytics: feed_kg = Σ feed consumed
- PASS analytics: farm overview birds alive = Σ running balances
- PASS analytics: FCR within 1% of feed / (sold kg - chick kg)
- PASS pnl: revenue = Σ sales - discounts
- PASS pnl: purchase_cost = chick cost
- PASS pnl: direct expenses = Σ expenses
- PASS pnl.profit includes feed/medicine cost
- PASS dashboard: receivables rose by exactly the unpaid sales
- PASS dashboard: payables rose by exactly the unpaid purchases
- PASS dashboard: cash position moved by Σ(in - out) payments
- PASS probe: payment from an INACTIVE account is refused
- PASS top outstanding: customer A balance
- PASS top outstanding: customer B balance
- PASS top outstanding: customer C balance
- PASS trend: mortality Σ = died (+ other batches)
- PASS trend: feed Σ = feed consumed (+ pre-existing)
- PASS revenue figures are net of discount_amount
