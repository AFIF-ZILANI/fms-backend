# FMS API — Implementation Progress

What is built and what is deliberately not. Phase-by-phase history lives in `git log`; design
rationale lives in the design docs; the routes themselves are in [`endpoints.md`](./endpoints.md).
Update this file when a gap opens or closes. Last reviewed 2026-11-21.

## Built

Every phase of the original plan: Admins, Employees, Suppliers/Customers/Doctors, Houses,
Inventory (items, warehouses, organizations, stock units, assets, ledger, adjustments), Batches,
Purchases, Treatment & Monitoring, Sales, Payments, Finance (expenses, depreciation), Payroll
(score entries, records, payouts, ledger bridge), Alerts and a notifications inbox, the Audit Log,
and Analytics (including FCR, which is `null` for a batch whose feed unit has no kg conversion).

Sign-in and permissions: email and password, temporary passwords with a forced change, signed
sessions (cookie for the dashboard, bearer token for the app), and default-deny route access
through `lib/permissions.ts` (`middlewares/authenticate.ts`, `docs/api.md` §1.6).

Batch profit and loss is a full statement (revenue, costs by section, contribution, a bird-days
share of farm-wide costs, net profit, per-bird and per-kg figures). Added since the first
release, in roughly this order:

- Festival bonus (events, proposal, grant, payout; `docs/api.md` §12.3), soft-coded categories
  and units, item unit conversion, warehouse-to-house stock transfer, role-based salary
  (employee roles as a table), employee hire redesign, tasks and task types, payout accounts,
  devices and PoultryScale ingest.
- QR-coded stock end to end: provision, print, bind to a purchase lot, relocate, use, dispose,
  look up a code, and a stock count with bulk fixes. A wrong purchase can be removed, with a
  full snapshot kept in the audit log.
- Vaccine schedules, shared water lines, disease cases, the farm-day start hour, the batch
  settlement window, sale kinds with sale scans, discounts, landed cost, and fixing a wrong
  usage record. The rules are in `docs/api.md` §19.
- The web dashboard and the ZFarm mobile app (Expo), both in their own repositories.

## Not built

| Item | State |
| --- | --- |
| Intern permissions | The `INTERN` role exists and can sign in, but `lib/permissions.ts` grants it nothing, so every route except `/auth` is `403`. The intended scope is in `docs/FEATURES.md` §3.4. |
| Audit log coverage | Writes exist for sign-in changes, hire/terminate/reinstate/deactivate, admin create/deactivate, payouts and payout accounts, salary overrides, purchases (including removal), sales, sale scans, bird sales, stock adjustments, batches, usage fixes, disease cases, vaccine schedules, farm settings, bonus events and device pairing (`lib/audit.ts`). The table is append-only at the database. Not covered: payments, expenses, and the daily logs (weight, environment, treatment). |
| Environment and sensor alerts | Not built. The alert scan covers the rules listed in `docs/api.md` §13. |
| Employer accruals (bonus, gratuity, provident fund) | Not modelled. |
| PoultryScale mapping questions | Crate vs katha, dholta, per-piece culls, fractional crates. |
| ৳98,070 pre-bridge cash adjustment | Data fix: confirm which wallet paid the 8 early payouts. |

Mobile gaps (the Intern tier, recurring tasks) are in `mobile/docs/PRD.md` §7.
