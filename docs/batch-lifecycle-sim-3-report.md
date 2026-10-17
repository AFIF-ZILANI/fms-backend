# Batch lifecycle simulation -- report

Batch `SIM3-2026-09-16` (FAOMI), 4000 chicks, 31 days (2026-09-16 -> 2026-10-16), driven through the HTTP API as admin / worker / manager. Run took 1s.

**Checks: 117/117 passed, 0 failed.**

## Headline numbers

| | |
|---|---|
| Chicks in / died / sold | 4000 / 186 (4.65%) / 0 |
| Final avg weight (last sample) | 507.43 g |
| Feed used | 4,900.5 kg  (FCR api 2.75, expected 2.75) |
| Revenue (sum of total_amount; 0 discounted at sale) | 0 |
| Chicks + direct expenses + consumed stock | 166,000 + 45,700 + 309,652.73 = 521,352.73 |
| True profit (revenue - discounts - costs) | -521,352.73 |
| P&L endpoint profit | -521,352.73 |
| Receivable (customers still owe) / payable (suppliers) | 0 / 225,400 |
| Feed left unused (warehouse + houses) | 2,499.5 kg |
| Active alerts after scan | 3 |

## Findings

- **NOTE** Item categories include VACCINE and SUPPLEMENT but supplier supply categories do not (FEED, MEDICINE, CHICKS, HUSK, ... only), so a vaccine/vitamin distributor can only be tagged MEDICINE.
- **GAP** Environment records, house allocations (incl. the INITIAL one), QR relocations and stock transfers have no client-settable timestamp (they stamp now()). Entries synced late from the offline mobile app would carry the sync time, not the time of the event. This sim back-dated them in SQL after the fact.

## Failed checks

- none

## Alerts raised by the scan

- [WARNING] বড় সেড: no feed logged today
- [WARNING] Jihad: "Blood sampling round" is overdue
- [INFO] Payroll not yet generated for 2 employees

## Day by day

| Day | Alive (EOD) | Died | Feed kg | Weight g | Events |
|---|---|---|---|---|---|
| 1 | 3993 | 7 | 40 |  | litter laid |
| 2 | 3982 | 11 | 48.1 |  |  |
| 3 | 3970 | 12 | 56.1 |  |  |
| 4 | 3960 | 10 | 64.1 |  |  |
| 5 | 3952 | 8 | 72.1 |  | ND B1 |
| 6 | 3945 | 7 | 80 |  |  |
| 7 | 3935 | 10 | 88 |  |  |
| 8 | 3925 | 10 | 95.8 | 91.47 |  |
| 9 | 3921 | 4 | 103.6 |  |  |
| 10 | 3919 | 2 | 111.6 |  |  |
| 11 | 3916 | 3 | 119.5 |  | IBD 1 |
| 12 | 3912 | 4 | 127.5 |  |  |
| 13 | 3908 | 4 | 135.4 |  |  |
| 14 | 3903 | 5 | 143.2 |  |  |
| 15 | 3902 | 1 | 151 | 200.69 | 60% moved to grower |
| 16 | 3899 | 3 | 159 |  | rest moved; brooder emptied |
| 17 | 3896 | 3 | 166.9 |  |  |
| 18 | 3896 | 0 | 174.7 |  | IBD booster |
| 19 | 3891 | 5 | 182.7 |  |  |
| 20 | 3886 | 5 | 190.5 |  |  |
| 21 | 3881 | 5 | 198.2 |  |  |
| 22 | 3881 | 0 | 205.9 | 325.87 | ND Lasota |
| 23 | 3878 | 3 | 213.8 |  |  |
| 24 | 3861 | 17 | 221.6 |  |  |
| 25 | 3847 | 14 | 228.6 |  | antibiotic course |
| 26 | 3828 | 19 | 235.6 |  | antibiotic course |
| 27 | 3820 | 8 | 242.3 |  | antibiotic course |
| 28 | 3818 | 2 | 249.6 |  | antibiotic course |
| 29 | 3816 | 2 | 257.3 | 507.43 | antibiotic course |
| 30 | 3816 | 0 | 265 |  |  |
| 31 | 3814 | 2 | 272.8 |  |  |

## All checks

- PASS house বাচ্চার সেড set READY
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
- PASS end: birds still on the books
- PASS probe: close with live birds and no force -> 409
- PASS refused close left the batch RUNNING with no end date
- PASS batch still RUNNING
- PASS conservation: initial = died + sold + live
- PASS mortality rows sum = model
- PASS sold birds = model
- PASS allocations: INITIAL = chick count
- PASS allocations: moves out of brooder = into grower
- PASS balances = model
- PASS chick purchase lines = initial_chick_count
- PASS chick purchase cost
- PASS count: vaccinations = 4
- PASS count: weight records = 4
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
- PASS purchase SIM3-INV-1-73b2: paid <= total
- PASS purchase SIM3-INV-2-219f: paid <= total
- PASS purchase SIM3-INV-1-89c1: paid <= total
- PASS purchase SIM3-INV-1-7ab8: paid <= total
- PASS purchase SIM3-INV-14-89c1: paid <= total
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
