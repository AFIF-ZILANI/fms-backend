# Batch lifecycle simulation -- report

Batch `SIM2-2026-08-10` (KEDERNATH), 3000 chicks, 62 days (2026-08-10 -> 2026-10-10), driven through the HTTP API as admin / worker / manager. Run took 2s.

**Checks: 169/169 passed, 0 failed.**

## Headline numbers

| | |
|---|---|
| Chicks in / died / sold | 3000 / 175 (5.83%) / 2825 |
| Final avg weight (last sample) | 1611.09 g |
| Feed used | 11,929.5 kg  (FCR api 2.76, expected 2.76) |
| Revenue (sum of total_amount; 0 discounted at sale) | 1,162,747.65 |
| Chicks + direct expenses + consumed stock | 165,000 + 102,000 + 694,912.25 = 961,912.25 |
| True profit (revenue - discounts - costs) | 200,835.4 |
| P&L endpoint profit | 200,835.4 |
| Receivable (customers still owe) / payable (suppliers) | 621,390.97 / 456,300 |
| Feed left unused (warehouse + houses) | 1,120.5 kg |
| Active alerts after scan | 2 |

## Findings

- **NOTE** Item categories include VACCINE and SUPPLEMENT but supplier supply categories do not (FEED, MEDICINE, CHICKS, HUSK, ... only), so a vaccine/vitamin distributor can only be tagged MEDICINE.
- **GAP** Environment records, house allocations (incl. the INITIAL one), QR relocations and stock transfers have no client-settable timestamp (they stamp now()). Entries synced late from the offline mobile app would carry the sync time, not the time of the event. This sim back-dated them in SQL after the fact.
- **NOTE** analytics age_days for a SOLD batch keeps growing (68d, from Date.now()) instead of stopping at the batch end (~62d). Shows on the Analytics page for finished batches.
- **NOTE** actual_end_date is stamped with the close request time (new Date()), not the last sale. Closing a batch a day late shifts bird-days / depreciation accordingly.

## Failed checks

- none

## Alerts raised by the scan

- [WARNING] Jihad: "Blood sampling round" is overdue
- [INFO] Payroll not yet generated for 2 employees

## Day by day

| Day | Alive (EOD) | Died | Feed kg | Weight g | Events |
|---|---|---|---|---|---|
| 1 | 2988 | 12 | 30 |  | litter laid |
| 2 | 2980 | 8 | 36 |  |  |
| 3 | 2976 | 4 | 42 |  |  |
| 4 | 2971 | 5 | 48.1 |  |  |
| 5 | 2965 | 6 | 54.1 |  | ND B1 |
| 6 | 2960 | 5 | 60 |  |  |
| 7 | 2953 | 7 | 66 |  |  |
| 8 | 2947 | 6 | 71.9 | 89.94 |  |
| 9 | 2944 | 3 | 77.8 |  |  |
| 10 | 2941 | 3 | 83.8 |  |  |
| 11 | 2938 | 3 | 89.7 |  | IBD 1 |
| 12 | 2935 | 3 | 95.6 |  |  |
| 13 | 2932 | 3 | 101.6 |  |  |
| 14 | 2928 | 4 | 107.5 |  |  |
| 15 | 2922 | 6 | 113.3 | 190.95 | 60% moved to grower |
| 16 | 2922 | 0 | 119.1 |  | rest moved; brooder emptied |
| 17 | 2920 | 2 | 125.1 |  |  |
| 18 | 2919 | 1 | 131 |  | IBD booster |
| 19 | 2915 | 4 | 136.9 |  |  |
| 20 | 2902 | 13 | 142.7 |  |  |
| 21 | 2896 | 6 | 148 |  | antibiotic course |
| 22 | 2888 | 8 | 153.6 | 349.34 | ND Lasota; antibiotic course |
| 23 | 2872 | 16 | 159.1 |  | antibiotic course |
| 24 | 2858 | 14 | 164.1 |  | antibiotic course |
| 25 | 2856 | 2 | 169.2 |  | antibiotic course |
| 26 | 2856 | 0 | 174.9 |  |  |
| 27 | 2853 | 3 | 180.8 |  |  |
| 28 | 2851 | 2 | 186.4 |  |  |
| 29 | 2849 | 2 | 192.2 | 532.09 |  |
| 30 | 2849 | 0 | 197.9 |  |  |
| 31 | 2848 | 1 | 203.7 |  |  |
| 32 | 2848 | 0 | 209.5 |  |  |
| 33 | 2847 | 1 | 215.3 |  |  |
| 34 | 2846 | 1 | 221.1 |  |  |
| 35 | 2846 | 0 | 226.8 |  |  |
| 36 | 2846 | 0 | 232.7 | 752.42 | ND booster |
| 37 | 2846 | 0 | 238.5 |  |  |
| 38 | 2846 | 0 | 244.3 |  |  |
| 39 | 2846 | 0 | 250.2 |  |  |
| 40 | 2845 | 1 | 256 |  |  |
| 41 | 2845 | 0 | 261.7 |  |  |
| 42 | 2843 | 2 | 267.6 |  |  |
| 43 | 2843 | 0 | 273.2 | 914.35 |  |
| 44 | 2843 | 0 | 279 |  |  |
| 45 | 2842 | 1 | 284.9 |  |  |
| 46 | 2841 | 1 | 290.6 |  |  |
| 47 | 2841 | 0 | 296.3 |  |  |
| 48 | 2840 | 1 | 302.1 |  |  |
| 49 | 2839 | 1 | 307.9 |  |  |
| 50 | 2838 | 1 | 313.6 | 1225.61 |  |
| 51 | 2836 | 2 | 319.3 |  |  |
| 52 | 2835 | 1 | 324.9 |  |  |
| 53 | 2834 | 1 | 330.6 |  |  |
| 54 | 2832 | 2 | 336.3 |  |  |
| 55 | 2832 | 0 | 341.8 |  |  |
| 56 | 2830 | 2 | 347.6 |  |  |
| 57 | 1870 | 0 | 353.2 | 1486.75 |  |
| 58 | 1870 | 0 | 237.2 |  |  |
| 59 | 1869 | 1 | 241 |  |  |
| 60 | 819 | 0 | 244.7 |  |  |
| 61 | 819 | 0 | 108.9 |  |  |
| 62 | 0 | 4 | 110.6 | 1611.09 |  |

## All checks

- PASS pre: no batch with this code
- PASS pre: target houses empty
- PASS auth: no token -> 401
- PASS batch created RUNNING with initial balance
- PASS purchase d1 total = Σlines - discount
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
- PASS sale d57 HIGH: total_amount = net x price
- PASS sale d57 HIGH: due = total - discount
- PASS sale d57 LOW: total_amount = net x price
- PASS sale d57 LOW: due = total - discount
- PASS day 57: house balances match model
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
- PASS purchase SIM2-INV-1-4e9d: paid <= total
- PASS purchase SIM2-INV-1-deb8: paid <= total
- PASS purchase SIM2-INV-1-9d84: paid <= total
- PASS purchase SIM2-INV-14-deb8: paid <= total
- PASS purchase SIM2-INV-34-deb8: paid <= total
- PASS purchase SIM2-INV-46-deb8: paid <= total
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
