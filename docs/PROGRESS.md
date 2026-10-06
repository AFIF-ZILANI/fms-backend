# FMS API — Implementation Progress

Current state of the build. Phase-by-phase history lives in `git log`; design
rationale lives in the design docs. Update this file when a gap opens or closes.

## Built

Every phase of the original plan except Auth (below): Admins, Employees,
Suppliers/Customers/Doctors, Houses, Inventory (items, warehouses,
organizations, stock units, assets, ledger, adjustments), Batches, Purchases,
Treatment & Monitoring, Sales, Payments, Finance (expenses, depreciation),
Payroll (score entries, records, payouts, ledger bridge), Alerts (on-demand
scan plus periodic loop), Audit Log (read side), Analytics.

Since then: soft-coded categories/units, item unit conversion, warehouse→house
stock transfer, role-based salary config, employee hire redesign, tasks and
task types, payout accounts, devices and PoultryScale ingest, and the web and
mobile (Expo) clients.

## Not built

| Item | State |
| --- | --- |
| Auth and permission enforcement | No login or role middleware. Actor falls back to the oldest Admin (`lib/current-actor.ts`); paired devices are the only authenticated callers. |
| Audit log writes | Only `employee.service.ts` writes `AuditLog`. Needs auth for a real actor. |
| Festival bonus | Approved spec, no code: `superpowers/specs/2026-09-30-festival-bonus-design.md`. |
| Bird-days shared-cost allocation | v2. Needs 2–3 overlapping batches of real data. |
| FCR | Needs a feed-to-weight unit table. |
| Regular sales moving stock | `SaleService.create` writes no ledger row. Needs its own spec. |
| Employer accruals (bonus, gratuity, provident fund) | Not modelled. |
| PoultryScale mapping questions | Crate vs katha, dholta, per-piece culls, fractional crates. |
| ৳98,070 pre-bridge cash adjustment | Data fix: confirm which wallet paid the 8 early payouts. |

Mobile gaps (Intern tier, unit-level consumption, recurring tasks) are in
`mobile/docs/PRD.md` §7.
