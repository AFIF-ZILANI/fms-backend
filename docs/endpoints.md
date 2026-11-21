# Endpoint index

Every route the API serves (318 in all), generated from the source by `bun run docs:endpoints`. Do not edit by hand: change the code and regenerate.

For what the fields mean, the error cases and worked examples, see [`api.md`](api.md). For conventions (envelope, pagination, errors, idempotency) see its section 1.

## How to read it

- **Access** is evaluated with the real `canAccess()` in [`src/lib/permissions.ts`](../src/lib/permissions.ts), so it is what the server enforces. Admins may call everything. An employee may call only what a rule grants, and the rule is for their level: *Worker* rules cover WORKER and MANAGER, *Manager* rules cover MANAGER only. Everything not listed there is **Admin** only (default deny). *Public* needs no session, *Device key* needs a paired scale device's token, and *Anyone signed in* covers the self-service `/auth` routes.
- **Status** is the success status the controller sends (`200` unless it says otherwise). Failures are RFC 7807 problem responses; see `api.md` section 1.3.
- **Input** lists the top-level fields of the Zod schema that validates the request. A trailing `?` marks an optional field, and *any of* means every field is optional (a partial update). A bare schema name means its shape isn't a plain object. List endpoints also take `page` and `limit`.
- `:id` and other `:name` segments are path parameters.

## Contents

[`/health`](#health) · [`/api/auth`](#apiauth) · [`/api/admins`](#apiadmins) · [`/api/devices`](#apidevices) · [`/api/ingest`](#apiingest) · [`/api/employees`](#apiemployees) · [`/api/employee-roles`](#apiemployee-roles) · [`/api/farm-settings`](#apifarm-settings) · [`/api/uploads`](#apiuploads) · [`/api/employee-payout-accounts`](#apiemployee-payout-accounts) · [`/api/payroll-payouts`](#apipayroll-payouts) · [`/api/bonus-events`](#apibonus-events) · [`/api/suppliers`](#apisuppliers) · [`/api/customers`](#apicustomers) · [`/api/doctors`](#apidoctors) · [`/api/houses`](#apihouses) · [`/api/items`](#apiitems) · [`/api/item-units`](#apiitem-units) · [`/api/warehouses`](#apiwarehouses) · [`/api/organizations`](#apiorganizations) · [`/api/item-organizations`](#apiitem-organizations) · [`/api/stock-units`](#apistock-units) · [`/api/stock-house-allocations`](#apistock-house-allocations) · [`/api/assets`](#apiassets) · [`/api/batches`](#apibatches) · [`/api/batch-house-allocations`](#apibatch-house-allocations) · [`/api/mortality-logs`](#apimortality-logs) · [`/api/batch-house-balances`](#apibatch-house-balances) · [`/api/purchases`](#apipurchases) · [`/api/purchase-items`](#apipurchase-items) · [`/api/stock-ledger`](#apistock-ledger) · [`/api/inventory-adjustments`](#apiinventory-adjustments) · [`/api/stock-transfers`](#apistock-transfers) · [`/api/consumptions`](#apiconsumptions) · [`/api/medications`](#apimedications) · [`/api/vaccinations`](#apivaccinations) · [`/api/vaccine-templates`](#apivaccine-templates) · [`/api/vaccine-purposes`](#apivaccine-purposes) · [`/api/diseases`](#apidiseases) · [`/api/disease-cases`](#apidisease-cases) · [`/api/batch-vaccine-schedules`](#apibatch-vaccine-schedules) · [`/api/environment-records`](#apienvironment-records) · [`/api/weight-records`](#apiweight-records) · [`/api/batch-feeding-programs`](#apibatch-feeding-programs) · [`/api/sales`](#apisales) · [`/api/sale-scans`](#apisale-scans) · [`/api/bird-sales`](#apibird-sales) · [`/api/payment-instruments`](#apipayment-instruments) · [`/api/payments`](#apipayments) · [`/api/expenses`](#apiexpenses) · [`/api/asset-depreciations`](#apiasset-depreciations) · [`/api/performance-score-entries`](#apiperformance-score-entries) · [`/api/payroll-records`](#apipayroll-records) · [`/api/alerts`](#apialerts) · [`/api/notifications`](#apinotifications) · [`/api/audit-logs`](#apiaudit-logs) · [`/api/analytics`](#apianalytics) · [`/api/item-categories`](#apiitem-categories) · [`/api/units`](#apiunits) · [`/api/expense-categories`](#apiexpense-categories) · [`/api/supplier-supply-categories`](#apisupplier-supply-categories) · [`/api/task-types`](#apitask-types) · [`/api/tasks`](#apitasks) · [`/api/task-assignments`](#apitask-assignments)

### `/health`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | Public | 200 | — | Liveness check (outside `/api`) |

### `/api/auth`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | Public | 200 | body: `email`, `password`, `client?` | Logged in |
| POST | `/api/auth/logout` | Public | 200 | — | Logged out |
| GET | `/api/auth/me` | Anyone signed in | 200 | — | Fetched successfully |
| POST | `/api/auth/change-password` | Anyone signed in | 200 | body: `current_password`, `new_password` | Password changed |
| GET | `/api/auth/account` | Anyone signed in | 200 | — | Fetched successfully |
| PATCH | `/api/auth/account` | Anyone signed in | 200 | body: any of `name`, `mobile`, `address` | Account updated |
| POST | `/api/auth/deactivate-account` | Anyone signed in | 200 | body: `password` | Account deactivated |

### `/api/admins`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/admins` | Admin | 200 | query: `page`, `limit`, `is_active` | Admins fetched successfully |
| GET | `/api/admins/:id` | Admin | 200 | — | Admin fetched successfully |
| POST | `/api/admins` | Admin | 201 | body: `name`, `mobile`, `email`, `address?` | Admin created |
| PATCH | `/api/admins/:id` | Admin | 200 | body: any of `name`, `mobile`, `email`, `address` | Admin updated |
| POST | `/api/admins/:id/deactivate` | Admin | 200 | — | Admin deactivated |
| POST | `/api/admins/:id/reactivate` | Admin | 200 | — | Admin reactivated |
| POST | `/api/admins/:id/reset-password` | Admin | 200 | — | Password reset |

### `/api/devices`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/devices` | Admin | 200 | — | Devices fetched successfully |
| POST | `/api/devices/pairing-codes` | Admin | 201 | body: `profile_id` | Pairing code created |
| POST | `/api/devices/:id/revoke` | Admin | 200 | — | Device revoked |

### `/api/ingest`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/ingest/v1/pair` | Public | 201 | body: `code`, `device_label`, `platform?` | Device paired |
| POST | `/api/ingest/v1/sales` | Device key | 200 | body: `sale_id`, `batch_id?`, `batch_name?`, `sale_date`, `is_pcs_tracked`, `has_cull`, `main?`, `cull?`, `buyer_name?`, `buyer_type?`, `final_amount`, `received_amount` | Sale received |
| GET | `/api/ingest/v1/sales` | Admin | 200 | query: `status` | Ingested sales fetched successfully |
| POST | `/api/ingest/v1/sales/:id/confirm` | Admin | 201 | body: `batch_id`, `house_id`, `customer_id?`, `grade`, `birds_count`, `male_count?`, `female_count?`, `dholta_in_g`, `total_katha`, `avg_wt_per_katha_kg?`, `total_weight`, `net_weight`, `avg_weight_g?`, `price_per_kg`, `paid_amount?`, `paid_to_instrument_id?`, `discount_amount?` | Sale confirmed |
| POST | `/api/ingest/v1/sales/:id/dismiss` | Admin | 200 | body: `reason` | Sale dismissed |

### `/api/employees`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/employees` | Manager, Admin | 200 | query: `page`, `limit`, `role`, `q`, `employment_status`, `is_active` | Employees fetched successfully |
| GET | `/api/employees/kpis` | Manager, Admin | 200 | — | Employee KPIs fetched successfully |
| GET | `/api/employees/:id` | Worker (own record), Manager, Admin | 200 | — | Employee fetched successfully |
| POST | `/api/employees` | Admin | 201 | body: `name`, `mobile`, `email`, `address`, `date_of_birth`, `marital_status`, `nid_number`, `religion?`, `avatar`, `role`, `reference_salary?`, `joining_date?`, `employment_status?`, `probation_end_date?`, `education`, `experience_years`, `experience`, `emergency_name`, `emergency_relation`, `emergency_phone`, `emergency_email?`, `emergency_address?`, `reference_employee_id?`, `reference_name?`, `reference_phone?`, `reference_address?` | Employee created |
| PATCH | `/api/employees/:id` | Admin | 200 | body: any of `name`, `mobile`, `email`, `address`, `date_of_birth`, `marital_status`, `nid_number`, `religion`, `avatar`, `role`, `reference_salary`, `employment_status`, `probation_end_date`, `education`, `experience_years`, `experience`, `emergency_name`, `emergency_relation`, `emergency_phone`, `emergency_email`, `emergency_address`, `reference_employee_id`, `reference_name`, `reference_phone`, `reference_address`, `rating` | Employee updated |
| POST | `/api/employees/:id/reset-password` | Admin | 200 | — | Password reset |
| POST | `/api/employees/:id/terminate` | Admin | 200 | — | Employee terminated |
| POST | `/api/employees/:id/reinstate` | Admin | 200 | — | Employee reinstated |

### `/api/employee-roles`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/employee-roles` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/employee-roles` | Admin | 200 | body: `label`, `reference_salary` | Role created |
| PATCH | `/api/employee-roles/:id` | Admin | 200 | body: `label`, `reference_salary` | Role updated |
| POST | `/api/employee-roles/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/employee-roles/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/employee-roles/:id` | Admin | 200 | — | Delete |

### `/api/farm-settings`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/farm-settings` | Admin | 200 | — | Fetched successfully |
| PATCH | `/api/farm-settings` | Admin | 200 | body: any of `day_start_hour`, `settlement_days` | Farm settings saved |

### `/api/uploads`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/uploads/signature` | Admin | 200 | — | Upload signature issued |

### `/api/employee-payout-accounts`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/employee-payout-accounts` | Admin | 200 | query: `page`, `limit`, `employee_id`, `active_only` | Payout accounts fetched successfully |
| GET | `/api/employee-payout-accounts/:id` | Admin | 200 | — | Payout account fetched successfully |
| POST | `/api/employee-payout-accounts` | Admin | 201 | body: `employee_id`, `method`, `account_name`, `account_number`, `bank_name?`, `branch_name?`, `routing_number?`, `holder_relation?` | Payout account added |
| POST | `/api/employee-payout-accounts/:id/close` | Admin | 200 | — | Payout account closed |

### `/api/payroll-payouts`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/payroll-payouts` | Admin | 200 | query: `page`, `limit`, `status`, `employee_id` | Payouts fetched successfully |
| GET | `/api/payroll-payouts/fee-rates` | Admin | 200 | — | Fee rates |
| GET | `/api/payroll-payouts/:id` | Admin | 200 | — | Payout fetched successfully |
| POST | `/api/payroll-payouts` | Admin | 201 | body: any of `payroll_record_id`, `bonus_id`, `payout_account_id` | Payout created |
| POST | `/api/payroll-payouts/:id/mark-paid` | Admin | 200 | body: `transaction_ref`, `from_instrument_id`, `paid_at?` | Payout confirmed |
| POST | `/api/payroll-payouts/:id/mark-failed` | Admin | 200 | body: `reason` | Payout marked failed |

### `/api/bonus-events`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/bonus-events` | Admin | 200 | query: `page`, `limit` | Bonus events fetched successfully |
| POST | `/api/bonus-events` | Admin | 201 | body: `name`, `event_date`, `religion?`, `multiplier`, `min_service_months?`, `prorate?` | Bonus event created |
| GET | `/api/bonus-events/:id` | Admin | 200 | — | Bonus event fetched successfully |
| GET | `/api/bonus-events/:id/proposal` | Admin | 200 | — | Proposal computed |
| POST | `/api/bonus-events/:id/bonuses` | Admin | 201 | body: any of `bonuses` | Bonuses granted |

### `/api/suppliers`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/suppliers` | Admin | 200 | query: `page`, `limit`, `role`, `supplies`, `is_active` | Suppliers fetched successfully |
| GET | `/api/suppliers/:id` | Admin | 200 | — | Supplier fetched successfully |
| POST | `/api/suppliers` | Admin | 201 | body: `name`, `mobile`, `email?`, `address?`, `role`, `supplies`, `company?` | Supplier created |
| PATCH | `/api/suppliers/:id` | Admin | 200 | body: any of `name`, `mobile`, `email`, `address`, `role`, `supplies`, `company` | Supplier updated |
| POST | `/api/suppliers/:id/deactivate` | Admin | 200 | — | Supplier deactivated |
| POST | `/api/suppliers/:id/reactivate` | Admin | 200 | — | Supplier reactivated |

### `/api/customers`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/customers` | Admin | 200 | query: `page`, `limit`, `is_active` | Customers fetched successfully |
| GET | `/api/customers/:id` | Admin | 200 | — | Customer fetched successfully |
| POST | `/api/customers` | Admin | 201 | body: `name`, `mobile`, `email?`, `address?`, `company?` | Customer created |
| PATCH | `/api/customers/:id` | Admin | 200 | body: any of `name`, `mobile`, `email`, `address`, `company`, `rating` | Customer updated |
| POST | `/api/customers/:id/deactivate` | Admin | 200 | — | Customer deactivated |
| POST | `/api/customers/:id/reactivate` | Admin | 200 | — | Customer reactivated |

### `/api/doctors`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/doctors` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `is_active` | Doctors fetched successfully |
| GET | `/api/doctors/:id` | Worker, Manager, Admin | 200 | — | Doctor fetched successfully |
| POST | `/api/doctors` | Admin | 201 | body: `name`, `mobile`, `email?`, `address?`, `specialty?`, `position?`, `degrees?`, `institution?` | Doctor created |
| PATCH | `/api/doctors/:id` | Admin | 200 | body: any of `name`, `mobile`, `email`, `address`, `specialty`, `position`, `degrees`, `institution` | Doctor updated |
| POST | `/api/doctors/:id/deactivate` | Admin | 200 | — | Doctor deactivated |
| POST | `/api/doctors/:id/reactivate` | Admin | 200 | — | Doctor reactivated |

### `/api/houses`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/houses` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `type`, `is_active`, `phase`, `is_available` | Houses fetched successfully |
| GET | `/api/houses/:id` | Worker, Manager, Admin | 200 | — | House fetched successfully |
| GET | `/api/houses/:id/stock` | Worker, Manager, Admin | 200 | — | House stock fetched successfully |
| GET | `/api/houses/:id/activity` | Worker, Manager, Admin | 200 | query: `page`, `limit` | House activity fetched successfully |
| GET | `/api/houses/:id/coded-stock` | Worker, Manager, Admin | 200 | — | House coded stock fetched successfully |
| GET | `/api/houses/:id/batch-on` | Worker, Manager, Admin | 200 | — | Batch fetched successfully |
| POST | `/api/houses` | Admin | 201 | body: `name`, `type`, `number`, `capacity?` | House created |
| PATCH | `/api/houses/:id` | Admin | 200 | body: any of `name`, `type`, `number`, `capacity`, `phase`, `shares_water_with` | House updated |
| POST | `/api/houses/:id/deactivate` | Admin | 200 | — | House deactivated |
| POST | `/api/houses/:id/reactivate` | Admin | 200 | — | House reactivated |
| DELETE | `/api/houses/:id` | Admin | 200 | — | House deleted |

### `/api/items`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/items` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `category`, `is_active`, `is_unit_tracked`, `is_farm_made` | List |
| GET | `/api/items/low-stock` | Worker, Manager, Admin | 200 | — | Get low stock |
| GET | `/api/items/stock-by-location` | Worker, Manager, Admin | 200 | — | Get stock by location |
| GET | `/api/items/:id` | Worker, Manager, Admin | 200 | — | Get one |
| POST | `/api/items` | Admin | 201 | body: `name`, `category`, `unit`, `reorder_level?`, `preferred_reorder_qty?`, `lead_time_days?`, `supplier_ids?`, `meta_data?`, `is_unit_tracked?`, `is_farm_made?` | Create |
| PATCH | `/api/items/:id` | Admin | 200 | body: any of `name`, `category`, `reorder_level`, `preferred_reorder_qty`, `lead_time_days`, `supplier_ids`, `meta_data`, `is_unit_tracked`, `is_farm_made` | Update |
| DELETE | `/api/items/:id` | Admin | 200 | — | Delete |
| POST | `/api/items/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/items/:id/reactivate` | Admin | 200 | — | Reactivate |

### `/api/item-units`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/item-units` | Admin | 201 | body: `item_id`, `unit`, `factor_to_base`, `is_purchasable?`, `is_usable?` | Create |
| DELETE | `/api/item-units/:id` | Admin | 200 | — | Delete |

### `/api/warehouses`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/warehouses` | Worker, Manager, Admin | 200 | query: `page`, `limit` | Warehouses fetched successfully |
| GET | `/api/warehouses/:id` | Worker, Manager, Admin | 200 | — | Warehouse fetched successfully |
| GET | `/api/warehouses/:id/stock` | Worker, Manager, Admin | 200 | — | Warehouse stock fetched successfully |
| POST | `/api/warehouses` | Admin | 201 | body: `name` | Warehouse created |
| PATCH | `/api/warehouses/:id` | Admin | 200 | body: any of `name` | Warehouse updated |
| DELETE | `/api/warehouses/:id` | Admin | 200 | — | Warehouse deleted |

### `/api/organizations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/organizations` | Admin | 200 | query: `page`, `limit` | List |
| GET | `/api/organizations/:id` | Admin | 200 | — | Get one |
| POST | `/api/organizations` | Admin | 201 | body: `label_name` | Create |
| PATCH | `/api/organizations/:id` | Admin | 200 | body: any of `label_name` | Update |

### `/api/item-organizations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/item-organizations` | Admin | 201 | body: `item_id`, `organization_id`, `role` | Create |
| DELETE | `/api/item-organizations/:id` | Admin | 200 | — | Delete |

### `/api/stock-units`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/stock-units` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `status`, `house_id`, `category`, `purchase_item_id`, `q` | Stock units fetched successfully |
| GET | `/api/stock-units/counts` | Worker, Manager, Admin | 200 | — | Stock unit counts fetched |
| GET | `/api/stock-units/at-location` | Worker, Manager, Admin | 200 | query: `location_type`, `location_id`, `item_id?` | Stock units at location fetched |
| GET | `/api/stock-units/:id` | Worker, Manager, Admin | 200 | — | Stock unit fetched successfully |
| GET | `/api/stock-units/:id/profile` | Worker, Manager, Admin | 200 | — | Profile |
| POST | `/api/stock-units` | Admin | 201 | body: `count` | Stock units provisioned |
| POST | `/api/stock-units/bulk` | Manager, Admin | 200 | body: `action`, `house_id?`, `date?`, `units?` | Stock units processed |
| POST | `/api/stock-units/mark-printed` | Admin | 200 | body: `ids` | Stock units marked printed |
| POST | `/api/stock-units/:id/bind` | Manager, Admin | 200 | body: `purchase_item_id`, `unit_count?` | Stock unit bound |
| POST | `/api/stock-units/:id/relocate` | Worker, Manager, Admin | 200 | body: any of `house_id`, `idempotency_key`, `stock_transfer_id` | Stock unit relocated |
| POST | `/api/stock-units/:id/use` | Worker, Manager, Admin | 200 | body: `action`, `house_id`, `batch_id?`, `date`, `idempotency_key?`, `move_here?` | Unit used up |
| POST | `/api/stock-units/:id/dispose` | Manager, Admin | 200 | — | Stock unit disposed |
| PATCH | `/api/stock-units/:id/status` | Admin | 200 | body: `status` | Stock unit status updated |
| DELETE | `/api/stock-units/:id` | Admin | 200 | — | Stock unit deleted |

### `/api/stock-house-allocations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/stock-house-allocations` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `house_id`, `type`, `stock_unit_id`, `item_id`, `occurred_from`, `occurred_to` | Stock house allocations fetched successfully |
| GET | `/api/stock-house-allocations/summary` | Worker, Manager, Admin | 200 | query: `house_id`, `today_from`, `week_from` | Summary fetched |

### `/api/assets`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/assets` | Admin | 200 | query: `page`, `limit`, `status` | Assets fetched successfully |
| GET | `/api/assets/:id` | Admin | 200 | — | Asset fetched successfully |
| POST | `/api/assets` | Admin | 201 | body: `stock_unit_id`, `name`, `purchase_cost`, `purchase_date`, `useful_life_batches` | Asset created |
| PATCH | `/api/assets/:id/status` | Admin | 200 | body: `status` | Asset status updated |
| DELETE | `/api/assets/:id` | Admin | 200 | — | Asset deleted |

### `/api/batches`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/batches` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `status`, `breed`, `phase` | Batches fetched successfully |
| GET | `/api/batches/:id` | Worker, Manager, Admin | 200 | — | Batch fetched successfully |
| POST | `/api/batches` | Admin | 201 | body: `batch_code`, `breed`, `starting_date?`, `expected_selling_date`, `initial_chick_count`, `init_chicks_avg_wt`, `house_id` | Batch created |
| PATCH | `/api/batches/:id` | Admin | 200 | body: any of `batch_code`, `breed`, `phase`, `expected_selling_date` | Batch updated |
| POST | `/api/batches/:id/close` | Admin | 200 | body: `status`, `force?` | Batch closed |
| POST | `/api/batches/:id/finalize` | Admin | 200 | — | Batch finalised |

### `/api/batch-house-allocations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/batch-house-allocations` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id` | Allocations fetched successfully |
| POST | `/api/batch-house-allocations` | Manager, Admin | 201 | body: `batch_id`, `from_house_id?`, `to_house_id?`, `quantity`, `reason`, `idempotency_key?` | Allocation recorded |

### `/api/mortality-logs`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/mortality-logs` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `house_id` | Mortality logs fetched successfully |
| POST | `/api/mortality-logs` | Worker, Manager, Admin | 201 | body: `batch_id`, `house_id`, `count_died`, `cause_note?`, `disease_case_id?`, `date`, `idempotency_key?` | Mortality logged |
| PATCH | `/api/mortality-logs/:id` | Admin | 200 | body: `disease_case_id` | Disease unlinked |

### `/api/batch-house-balances`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/batch-house-balances` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `house_id` | Balances fetched successfully |

### `/api/purchases`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/purchases` | Admin | 200 | query: `page`, `limit`, `supplier_id`, `date_from`, `date_to`, `item_category` | List |
| GET | `/api/purchases/:id` | Admin | 200 | — | Get one |
| DELETE | `/api/purchases/:id` | Admin | 200 | — | Delete |
| POST | `/api/purchases` | Admin | 201 | body: `supplier_id?`, `warehouse_id`, `invoice_no?`, `purchase_date`, `paid_amount?`, `paid_from_instrument_id?`, `payment_date?`, `payment_transaction_ref?`, `payment_note?`, `items`, `charges?` | Create |
| POST | `/api/purchases/:id/charges` | Admin | 200 | body: `category`, `amount`, `remarks?`, `paid_amount?`, `paid_from_instrument_id?`, `date?` | Add charge |

### `/api/purchase-items`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/purchase-items` | Manager, Admin | 200 | query: `page`, `limit`, `item_id`, `batch_id`, `since` | List |
| POST | `/api/purchase-items/:id/complete` | Manager, Admin | 200 | body: `unit_count` | Complete |

### `/api/stock-ledger`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/stock-ledger` | Admin | 200 | query: `page`, `limit`, `item_id`, `direction`, `reason` | Stock ledger fetched successfully |
| GET | `/api/stock-ledger/summary` | Admin | 200 | — | Stock ledger summary fetched |

### `/api/inventory-adjustments`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/inventory-adjustments` | Admin | 200 | query: `page`, `limit`, `item_id` | Inventory adjustments fetched successfully |
| POST | `/api/inventory-adjustments` | Manager, Admin | 201 | body: `item_id`, `warehouse_id?`, `house_id?`, `quantity_before?`, `quantity_after`, `reason`, `note?`, `idempotency_key?` | Inventory adjustment recorded |

### `/api/stock-transfers`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/stock-transfers` | Worker, Manager, Admin | 201 | body: `item_id`, `from_location_type`, `from_location_id`, `to_location_type`, `to_location_id`, `quantity`, `unit`, `note?`, `idempotency_key?` | Stock transfer recorded |

### `/api/consumptions`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/consumptions` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `house_id`, `item_id`, `occurred_from`, `occurred_to` | Consumptions fetched successfully |
| GET | `/api/consumptions/summary` | Worker, Manager, Admin | 200 | query: `house_id`, `today_from`, `week_from` | Summary fetched |
| GET | `/api/consumptions/:id` | Worker, Manager, Admin | 200 | — | Consumption fetched |
| POST | `/api/consumptions` | Worker, Manager, Admin | 201 | body: `batch_id?`, `house_id`, `item_id`, `stock_unit_id?`, `quantity`, `unit`, `date`, `note?`, `idempotency_key?` | Consumption recorded |
| PATCH | `/api/consumptions/:id` | Manager, Admin | 200 | body: `quantity?`, `unit?`, `stock_unit_id?`, `date?`, `reason` | Usage fixed |
| POST | `/api/consumptions/:id/remove` | Manager, Admin | 200 | body: `reason` | Usage removed |

### `/api/medications`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/medications` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id` | Medications fetched successfully |
| POST | `/api/medications` | Worker, Manager, Admin | 201 | body: `batch_id`, `consumption_id?`, `medicine_name`, `dosage`, `cause?`, `disease_case_id?`, `period?`, `doctor_id?`, `remarks?`, `date?`, `idempotency_key?` | Medication logged |

### `/api/vaccinations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/vaccinations` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id` | Vaccinations fetched successfully |
| POST | `/api/vaccinations` | Worker, Manager, Admin | 201 | body: `batch_id`, `consumption_id?`, `vaccine_name`, `dosage`, `cause?`, `period?`, `doctor_id?`, `remarks?`, `date?`, `idempotency_key?` | Vaccination logged |

### `/api/vaccine-templates`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/vaccine-templates` | Admin | 200 | query: `active` | Vaccine templates fetched successfully |
| GET | `/api/vaccine-templates/:id` | Admin | 200 | — | Vaccine template fetched successfully |
| POST | `/api/vaccine-templates` | Admin | 201 | body: `name`, `entries?` | Vaccine template created |
| PATCH | `/api/vaccine-templates/:id` | Admin | 200 | body: any of `name`, `is_active`, `entries` | Vaccine template updated |

### `/api/vaccine-purposes`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/vaccine-purposes` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/vaccine-purposes` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/vaccine-purposes/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/vaccine-purposes/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/vaccine-purposes/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/vaccine-purposes/:id` | Admin | 200 | — | Delete |

### `/api/diseases`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/diseases` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/diseases` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/diseases/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/diseases/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/diseases/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/diseases/:id` | Admin | 200 | — | Delete |

### `/api/disease-cases`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/disease-cases` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `status` | Disease cases fetched successfully |
| GET | `/api/disease-cases/:id` | Worker, Manager, Admin | 200 | — | Disease case fetched successfully |
| POST | `/api/disease-cases` | Admin | 201 | body: `batch_id`, `disease_id`, `house_ids`, `severity`, `symptoms?`, `affected_count?`, `diagnosis_method`, `doctor_id?`, `noticed_on`, `notes?` | Disease case recorded |
| PATCH | `/api/disease-cases/:id` | Admin | 200 | body: any of `disease_id`, `house_ids`, `severity`, `symptoms`, `affected_count`, `diagnosis_method`, `doctor_id`, `noticed_on`, `notes`, `status`, `resolved_on`, `outcome` | Disease case updated |
| DELETE | `/api/disease-cases/:id` | Admin | 200 | — | Disease case removed |

### `/api/batch-vaccine-schedules`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/batch-vaccine-schedules` | Worker, Manager, Admin | 200 | query: `batch_id` | Vaccine schedule fetched successfully |
| POST | `/api/batch-vaccine-schedules/apply` | Admin | 201 | body: `batch_id`, `template_id` | Vaccine template applied |
| POST | `/api/batch-vaccine-schedules` | Admin | 201 | body: `day`, `purpose`, `method?`, `note`, `batch_id` | Vaccine added |
| PATCH | `/api/batch-vaccine-schedules/:id` | Admin | 200 | body: any of `day`, `purpose`, `method`, `note` | Vaccine updated |
| DELETE | `/api/batch-vaccine-schedules/:id` | Admin | 204 | — | Delete |
| POST | `/api/batch-vaccine-schedules/:id/reschedule` | Admin | 200 | body: `day`, `reason` | Vaccine rescheduled |
| POST | `/api/batch-vaccine-schedules/:id/cancel` | Admin | 200 | body: `reason` | Vaccine cancelled |
| POST | `/api/batch-vaccine-schedules/:id/confirm` | Worker, Manager, Admin | 200 | body: `idempotency_key`, `house_id`, `bottles` | Vaccine confirmed |

### `/api/environment-records`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/environment-records` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `house_id` | Environment records fetched successfully |
| POST | `/api/environment-records` | Worker, Manager, Admin | 201 | body: `batch_id`, `house_id`, `temperature_c`, `humidity_percent`, `ammonia_ppm`, `co2_ppm`, `air_pressure_hpa`, `time_period`, `idempotency_key?` | Environment record logged |

### `/api/weight-records`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/weight-records` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id`, `house_id` | Weight records fetched successfully |
| POST | `/api/weight-records` | Worker, Manager, Admin | 201 | body: `batch_id?`, `house_id`, `average_wt_grams`, `sample_size`, `date`, `idempotency_key?`, `note?` | Weight record logged |

### `/api/batch-feeding-programs`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/batch-feeding-programs` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `batch_id` | Feeding programs fetched successfully |
| POST | `/api/batch-feeding-programs` | Manager, Admin | 201 | body: `batch_id`, `feed_type`, `item_id`, `start_day`, `end_day?`, `idempotency_key?` | Feeding program created |
| PATCH | `/api/batch-feeding-programs/:id` | Admin | 200 | body: `end_day` | Feeding program updated |

### `/api/sales`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/sales` | Admin | 200 | query: `page`, `limit` | Sales fetched successfully |
| GET | `/api/sales/summary` | Admin | 200 | query: `customer_id`, `date_from`, `date_to`, `item_category`, `kind` | Sales summary computed |
| GET | `/api/sales/sellable` | Admin | 200 | query: `kind`, `warehouse_id?` | Sellable stock fetched |
| GET | `/api/sales/:id` | Admin | 200 | — | Sale fetched successfully |
| POST | `/api/sales` | Admin | 201 | body: `kind?`, `batch_id?`, `customer_id?`, `sale_date`, `warehouse_id?`, `paid_amount?`, `paid_to_instrument_id?`, `payment_date?`, `payment_transaction_ref?`, `payment_note?`, `items` | Sale recorded |

### `/api/sale-scans`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/sale-scans` | Manager, Admin | 200 | — | Sales waiting for bottles |
| GET | `/api/sale-scans/:id` | Manager, Admin | 200 | — | Get |
| POST | `/api/sale-scans/:id/scan` | Manager, Admin | 200 | body: `stock_unit_id` | Bottle scanned |

### `/api/bird-sales`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/bird-sales` | Admin | 200 | query: `page`, `limit` | Bird sales fetched successfully |
| GET | `/api/bird-sales/summary` | Admin | 200 | query: `batch_id`, `customer_id`, `date_from`, `date_to`, `grade` | Bird sales summary computed |
| GET | `/api/bird-sales/:id` | Admin | 200 | — | Bird sale fetched successfully |
| POST | `/api/bird-sales` | Admin | 201 | body: `batch_id`, `house_id?`, `houses?`, `customer_id?`, `sale_date`, `grade`, `male_count?`, `female_count?`, `birds_count`, `dholta_in_g`, `total_katha`, `avg_wt_per_katha_kg?`, `total_weight`, `net_weight`, `avg_weight_g?`, `price_per_kg`, `paid_amount?`, `paid_to_instrument_id?`, `discount_amount?`, `labour_cost?`, `labour_paid_from_instrument_id?` | Bird sale recorded |

### `/api/payment-instruments`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/payment-instruments` | Admin | 200 | query: `page`, `limit`, `is_active` | Payment instruments fetched successfully |
| GET | `/api/payment-instruments/:id` | Admin | 200 | — | Payment instrument fetched successfully |
| GET | `/api/payment-instruments/:id/balance` | Admin | 200 | — | Balance computed |
| POST | `/api/payment-instruments` | Admin | 201 | body: `type`, `label`, `bank_name?`, `account_no?`, `mobile_no?`, `mfs_type?` | Payment instrument created |
| PATCH | `/api/payment-instruments/:id` | Admin | 200 | body: any of `type`, `label`, `bank_name`, `account_no`, `mobile_no`, `mfs_type` | Payment instrument updated |
| POST | `/api/payment-instruments/:id/deactivate` | Admin | 200 | — | Payment instrument deactivated |
| POST | `/api/payment-instruments/:id/reactivate` | Admin | 200 | — | Payment instrument reactivated |
| DELETE | `/api/payment-instruments/:id` | Admin | 200 | — | Payment instrument deleted |

### `/api/payments`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/payments` | Admin | 200 | query: `page`, `limit`, `ref_type`, `ref_id`, `direction`, `instrument_id` | Payments fetched successfully |
| GET | `/api/payments/total-paid` | Admin | 200 | query: `ref_type`, `ref_id` | Total paid computed |
| GET | `/api/payments/outstanding` | Admin | 200 | query: `ref_type` | Paid totals computed |
| GET | `/api/payments/:id` | Admin | 200 | — | Payment fetched successfully |
| POST | `/api/payments` | Admin | 201 | body: `amount`, `payment_date`, `ref_type`, `ref_id`, `from_instrument_id?`, `to_instrument_id?`, `transaction_ref?`, `note?` | Payment recorded |

### `/api/expenses`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/expenses` | Admin | 200 | query: `page`, `limit`, `batch_id`, `category`, `cost_type`, `date_from`, `date_to` | Expenses fetched successfully |
| GET | `/api/expenses/summary` | Admin | 200 | query: `batch_id`, `category`, `cost_type`, `date_from`, `date_to` | Expense summary computed |
| GET | `/api/expenses/:id` | Admin | 200 | — | Expense fetched successfully |
| POST | `/api/expenses` | Admin | 201 | body: `batch_id?`, `category`, `cost_type`, `amount`, `date`, `remarks?`, `paid_amount?`, `paid_from_instrument_id?` | Expense recorded |

### `/api/asset-depreciations`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/asset-depreciations` | Admin | 200 | query: `page`, `limit`, `asset_id`, `batch_id` | Asset depreciations fetched successfully |

### `/api/performance-score-entries`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/performance-score-entries` | Worker (own record), Manager, Admin | 200 | query: `page`, `limit`, `employee_id`, `status`, `date_from`, `date_to` | Score entries fetched successfully |
| POST | `/api/performance-score-entries` | Manager, Admin | 201 | body: `employee_id`, `criterion`, `points?`, `reason`, `incident_date`, `approved_by_id?`, `notice_doc_url?`, `idempotency_key?` | Score entry recorded |
| POST | `/api/performance-score-entries/:id/void` | Admin | 200 | body: `void_reason` | Score entry voided |
| POST | `/api/performance-score-entries/:id/dispute` | Admin | 200 | — | Score entry disputed |
| POST | `/api/performance-score-entries/:id/acknowledge` | Admin | 200 | — | Score entry acknowledged |

### `/api/payroll-records`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/payroll-records` | Worker (own record), Manager, Admin | 200 | query: `page`, `limit`, `employee_id` | Payroll records fetched successfully |
| GET | `/api/payroll-records/:id` | Admin | 200 | — | Payroll record fetched successfully |
| GET | `/api/payroll-records/:id/payslip` | Admin | 200 | — | Payslip fetched successfully |
| POST | `/api/payroll-records/generate` | Admin | 201 | body: `employee_id`, `month` | Payroll generated |

### `/api/alerts`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/alerts` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `type`, `level`, `status` | Alerts fetched successfully |
| POST | `/api/alerts/scan` | Admin | 200 | — | Scan complete |
| GET | `/api/alerts/:id` | Worker, Manager, Admin | 200 | — | Alert fetched successfully |
| POST | `/api/alerts` | Manager, Admin | 201 | body: `title`, `description?`, `type`, `level`, `related_id?`, `action_type?`, `idempotency_key?` | Alert created |
| POST | `/api/alerts/:id/resolve` | Manager, Admin | 200 | — | Alert resolved |

### `/api/notifications`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/notifications` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `status` | Notifications fetched successfully |
| GET | `/api/notifications/unread-count` | Worker, Manager, Admin | 200 | — | Unread count fetched successfully |
| POST | `/api/notifications/read-all` | Worker, Manager, Admin | 200 | — | All notifications marked read |
| POST | `/api/notifications/:id/read` | Worker, Manager, Admin | 200 | — | Notification marked read |

### `/api/audit-logs`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/audit-logs` | Admin | 200 | query: `page`, `limit`, `table_name`, `record_id`, `changed_by_id`, `action`, `from`, `to` | Audit logs fetched successfully |
| GET | `/api/audit-logs/tables` | Admin | 200 | — | Audited tables fetched successfully |
| GET | `/api/audit-logs/:id` | Admin | 200 | — | Audit log fetched successfully |

### `/api/analytics`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/analytics/overview` | Admin | 200 | — | Farm overview computed |
| GET | `/api/analytics/finance/summary` | Admin | 200 | query: `from`, `to`, `compare_from?`, `compare_to?` | Finance summary computed |
| GET | `/api/analytics/finance/monthly` | Admin | 200 | query: `months` | Monthly finance computed |
| GET | `/api/analytics/finance/owed` | Admin | 200 | query: `top` | Money owed computed |
| GET | `/api/analytics/financial` | Admin | 200 | query: `month` | Financial dashboard computed |
| GET | `/api/analytics/batches/performance` | Admin | 200 | query: `status` | Batch performance list computed |
| GET | `/api/analytics/batches/:id/performance` | Admin | 200 | — | Batch performance computed |
| GET | `/api/analytics/batches/:id/pnl` | Admin | 200 | — | Batch P&L computed |
| GET | `/api/analytics/batches/:id/stock` | Admin | 200 | — | Batch stock computed |
| GET | `/api/analytics/batches-pnl` | Admin | 200 | — | Batch P&L list computed |
| GET | `/api/analytics/shared-costs` | Admin | 200 | — | Shared costs computed |
| GET | `/api/analytics/trends/mortality` | Admin | 200 | query: `days` | Mortality trend computed |
| GET | `/api/analytics/trends/feed` | Admin | 200 | query: `days` | Feed trend computed |
| GET | `/api/analytics/trends/sales` | Admin | 200 | query: `days` | Sales trend computed |
| GET | `/api/analytics/sales/by-product-line` | Admin | 200 | query: `days` | Sales by product line computed |
| GET | `/api/analytics/sales/grade-distribution` | Admin | 200 | query: `days` | Bird grade distribution computed |
| GET | `/api/analytics/sales/top-outstanding-customers` | Admin | 200 | query: `limit` | Top outstanding customers computed |
| GET | `/api/analytics/purchases/by-category` | Admin | 200 | query: `days` | Purchases by category computed |
| GET | `/api/analytics/purchases/trend` | Admin | 200 | query: `days` | Purchases trend computed |
| GET | `/api/analytics/expenses/breakdown` | Admin | 200 | query: `month` | Expense breakdown computed |
| GET | `/api/analytics/revenue-vs-expenses` | Admin | 200 | query: `months` | Revenue vs expenses computed |
| GET | `/api/analytics/inventory/stock-value-by-category` | Admin | 200 | — | Stock value by category computed |
| GET | `/api/analytics/inventory/stock-movement-trend` | Admin | 200 | query: `days` | Stock movement trend computed |
| GET | `/api/analytics/inventory/consumption-by-category` | Admin | 200 | query: `days` | Consumption by category computed |
| GET | `/api/analytics/inventory/consumption-trend` | Admin | 200 | query: `days` | Consumption trend computed |
| GET | `/api/analytics/inventory/wastage-by-category` | Admin | 200 | query: `days` | Wastage by category computed |

### `/api/item-categories`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/item-categories` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/item-categories` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/item-categories/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/item-categories/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/item-categories/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/item-categories/:id` | Admin | 200 | — | Delete |

### `/api/units`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/units` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/units` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/units/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/units/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/units/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/units/:id` | Admin | 200 | — | Delete |

### `/api/expense-categories`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/expense-categories` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/expense-categories` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/expense-categories/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/expense-categories/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/expense-categories/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/expense-categories/:id` | Admin | 200 | — | Delete |

### `/api/supplier-supply-categories`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/supplier-supply-categories` | Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/supplier-supply-categories` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/supplier-supply-categories/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/supplier-supply-categories/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/supplier-supply-categories/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/supplier-supply-categories/:id` | Admin | 200 | — | Delete |

### `/api/task-types`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/task-types` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `active` | List |
| POST | `/api/task-types` | Admin | 201 | body: `label` | Create |
| PATCH | `/api/task-types/:id` | Admin | 200 | body: `label` | Update |
| POST | `/api/task-types/:id/deactivate` | Admin | 200 | — | Deactivate |
| POST | `/api/task-types/:id/reactivate` | Admin | 200 | — | Reactivate |
| DELETE | `/api/task-types/:id` | Admin | 200 | — | Delete |

### `/api/tasks`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/tasks` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `active`, `task_type_id` | Tasks fetched successfully |
| GET | `/api/tasks/:id` | Worker, Manager, Admin | 200 | — | Task fetched successfully |
| POST | `/api/tasks` | Admin | 201 | body: `label`, `task_type_id?` | Task created |
| PATCH | `/api/tasks/:id` | Admin | 200 | body: any of `label`, `task_type_id` | Task updated |
| POST | `/api/tasks/:id/deactivate` | Admin | 200 | — | Task deactivated |
| POST | `/api/tasks/:id/reactivate` | Admin | 200 | — | Task reactivated |
| DELETE | `/api/tasks/:id` | Admin | 200 | — | Task deleted |

### `/api/task-assignments`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/task-assignments` | Worker, Manager, Admin | 200 | query: `page`, `limit`, `employee_id`, `house_id`, `status`, `due_from`, `due_to` | Task assignments fetched successfully |
| GET | `/api/task-assignments/:id` | Worker, Manager, Admin | 200 | — | Task assignment fetched successfully |
| POST | `/api/task-assignments` | Manager, Admin | 201 | body: `employee_id`, `task_id`, `title`, `description?`, `house_id?`, `location_note?`, `due_at`, `idempotency_key?` | Task assigned |
| PATCH | `/api/task-assignments/:id` | Admin | 200 | body: any of `title`, `description`, `house_id`, `location_note`, `due_at` | Task assignment updated |
| POST | `/api/task-assignments/:id/complete` | Worker, Manager, Admin | 200 | body: any of `completion_note` | Task completed |
| POST | `/api/task-assignments/:id/cancel` | Manager, Admin | 200 | — | Task cancelled |
