<div align="center">

# ZeroD Farms — API

**The backend of the ZeroD Farms Management System: one ledger for a poultry farm's flocks, stock, money and people.**

![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)
![Hono](https://img.shields.io/badge/framework-Hono-E36002?logo=hono)
![Prisma](https://img.shields.io/badge/ORM-Prisma%207-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/db-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Zod](https://img.shields.io/badge/validation-Zod%204-3E67B1?logo=zod)
![Errors](https://img.shields.io/badge/errors-RFC%207807-informational)

</div>

---

This API is the single source of truth for the three FMS clients:

| Client | Repo | Who uses it |
| --- | --- | --- |
| **Admin dashboard** (React, web) | [`fms-admin-dashboard`](https://github.com/AFIF-ZILANI/fms-admin-dashboard) | Owner / admins: purchasing, sales, finance, payroll, setup |
| **ZFarm** (Expo, Android) | [`fms-exe-mobile`](https://github.com/AFIF-ZILANI/fms-exe-mobile) | Managers and workers in the barns, offline-first |
| **Scale app** (device) | — | Weighs and sells birds at the gate; pairs with the API and posts sales |

## Contents

- [What it covers](#what-it-covers)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Testing and simulations](#testing-and-simulations)
- [API conventions](#api-conventions)
- [Authentication and permissions](#authentication-and-permissions)
- [Adding a resource](#adding-a-resource)
- [Deployment](#deployment)
- [Documentation](#documentation)

## What it covers

| Domain | Highlights |
| --- | --- |
| **Flocks** | Batches placed across houses, transfers between houses, mortality, weight, environment, feeding programs, treatments, vaccine schedules from templates, bird sales per house |
| **Inventory** | Item catalog with unit conversions, warehouses, purchases with landed cost (charges split by value), a double-entry stock ledger, transfers, adjustments, consumption |
| **QR-coded stock** | Every bottle of medicine or vaccine gets a printed code: provision → print → bind to a purchase lot → move to a house → start using → consumed, each step audited |
| **Assets** | Equipment registered from coded units, depreciated per batch |
| **Money** | Sales and bird sales, payments against payables/receivables, payment instruments, expenses, a cash book and a cost book |
| **People** | Employees and roles, tasks and assignments, performance points, monthly payroll (−10% / +20% performance clamp), bonuses, payouts |
| **Operations** | Rule-based alerts (scanned every 10 minutes) and a notifications inbox, an append-only audit log, analytics endpoints for every dashboard chart |
| **Farm day** | The farm's day turns at a configurable hour on Dhaka time; all daily logic goes through one set of helpers |

66 Prisma models, 58 migrations, ~60 resource routers under `/api`.

## Architecture

```
            ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
            │  Dashboard   │   │  ZFarm app   │   │  Scale app   │
            │  (cookie)    │   │  (bearer)    │   │ (device key) │
            └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                   └──────────────────┼──────────────────┘
                                      ▼
  secureHeaders → csrf → cors → timeout → rate limit → logger → authenticate → authorize
                                      ▼
                 routes ──► validators (Zod) ──► controllers ──► services ──► Prisma ──► PostgreSQL
                                                                     │
                                                       alert scan loop (background)
```

- **Controller → service → Prisma.** Controllers only parse and respond (`withHandler` + `sendSuccess`); every rule lives in a service, which throws `AppError`.
- **Money and stock math uses `Prisma.Decimal`**, never JS numbers.
- **Writes that must not race take Postgres advisory locks**: binding codes to a lot, using up a coded unit, recording purchases and payments.
- **Field writes are idempotent**: mobile sends an `idempotency_key` per write, so a retry after a lost response can't record twice.
- **Wrong records are removed, not voided**: e.g. deleting a purchase writes a full snapshot to the audit log first, and is refused once its stock is used.

```
src/
├── App.ts            # Hono app: middleware stack, error handler, route mount
├── config/env.ts     # Zod-validated env — the only place that reads process.env
├── routes/           # One router per resource, mounted in routes/index.ts
├── validators/       # Zod schemas for bodies and queries
├── controllers/      # Thin HTTP handlers
├── services/         # Business rules + their tests (*.service.test.ts)
├── middlewares/      # authenticate, authorize, require-device
├── lib/              # Shared domain logic: stock balance, unit conversion, payroll math,
│                     # farm day, alert rules, permissions, sessions, errors, pagination
└── types/
prisma/
├── schema.prisma
└── migrations/
scripts/              # Simulations and one-off maintenance (see below)
docs/                 # Design docs, API reference, audits
```

## Getting started

**Prerequisites:** [Bun](https://bun.sh) and a PostgreSQL database.

```bash
bun install                 # also runs `prisma generate`
cp .env.example .env        # then fill in the values below
bun run db:migrate          # apply migrations to your database
bun run dev                 # http://localhost:5085, restarts on change
```

There is no sign-up page. Create the first admin directly in the database, then give them a temporary password:

```bash
bun run auth:set-password admin@example.com   # prints a temp password; a change is forced at first login
```

Then point the dashboard (`VITE_API_BASE_URL`) or the mobile app at `http://localhost:5085/api`.

## Configuration

Every variable is validated at startup ([`src/config/env.ts`](src/config/env.ts)); the process exits with a clear message if one is missing or malformed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/bhaze` | PostgreSQL connection string |
| `SESSION_SECRET` | **required**, 32+ chars | Signs session tokens. Rotating it signs everyone out. `openssl rand -base64 48` |
| `PORT` | `5085` | HTTP port |
| `NODE_ENV` | `development` | `development` · `production` · `test` |
| `ALLOWED_ORIGINS` | `http://localhost:5085,http://localhost:5173` | Comma-separated CORS origins (the dashboard's URL in production) |
| `CORS_CREDENTIALS` | `true` | Allow the dashboard's session cookie cross-origin |
| `CSRF_ENABLED` | `true` | CSRF origin check (production only) |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting. Only behind a proxy that overwrites it |
| `TIMEOUT_MS` | `30000` | Per-request timeout |
| `RATE_LIMIT_MAX` | `120` | Requests per window per client, general bucket |
| `SCAN_RATE_LIMIT_MAX` | `600` | Requests per window per client for QR scanning (unit lookup, bind / relocate / use), a separate bucket |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `ALERT_SCAN_INTERVAL_MS` | `600000` | Background alert scan interval; `0` disables it |
| `CLOUDINARY_CLOUD_NAME` · `CLOUDINARY_API_KEY` · `CLOUDINARY_API_SECRET` · `CLOUDINARY_URL` | **required** | Signed uploads for profile photos and attachments |
| `CLOUDINARY_EMPLOYEE_PRESET` | **required** | Upload preset for employee photos |

> Never read `process.env` in application code — import `env` from `@config/env`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server with watch mode |
| `bun run start` | Production server |
| `bun test` | Full test suite (see the warning below) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run format` / `format:check` | Prettier |
| `bun run db:migrate` | Create/apply migrations in development (`prisma migrate dev`) |
| `bun run db:generate` | Regenerate the Prisma client |
| `bun run auth:set-password <email>` | Issue a temporary password |

## Testing and simulations

```bash
bun test                                # ~640 tests across 80 files
bun test src/services/purchase.service.test.ts
```

> **The tests write to the database in `DATABASE_URL`.** They create and clean up their own fixtures, but always run them against a local or disposable database, never production.

Services are tested against a real Postgres (no mocks), so the tests cover the actual SQL, locks and constraints.

On top of the unit tests, three end-to-end **simulations** drive the real HTTP stack in-process (real auth, validators and permissions) and then audit the database:

| Script | Simulates |
| --- | --- |
| `bun scripts/batch-lifecycle-sim.ts [1\|2\|3]` | A full 62-day broiler batch: placement, daily logs, feed, treatments, vaccines, mortality, sales, costs. Leaves a browsable batch behind |
| `bun scripts/inventory-sim.ts` | Catalog, purchases, QR codes, transfers, consumption, adjustments, assets, alerts, concurrency, stock reports |
| `bun scripts/scan-sim.ts <bind\|allocate\|return\|start\|finish> <old\|new> [n]` | Fast QR scanning from the mobile app: feeds a list of codes through the app's scan logic with network latency and the rate limiter on, then checks every unit was recorded exactly once |

## API conventions

All routes live under `/api` (plus `GET /health`). The full reference is in [`docs/api.md`](docs/api.md).

**Success**

```json
{
  "success": true,
  "message": "Purchases fetched",
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

`meta` is present on paginated lists (`?page=&limit=`, `limit` ≤ 100).

**Errors** follow [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807):

```json
{
  "type": "https://api.bhaze.dev/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "This lot is full — 30 of 30 units already linked",
  "instance": "/api/stock-units/9f1c…/bind"
}
```

Validation failures are `400` with per-field messages in `extensions`. Services raise errors through `AppError` factories: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal`, `serviceUnavailable`. Details: [`docs/contracts/`](docs/contracts/).

## Authentication and permissions

- **Email + password** for admins and employees. New accounts and resets get a temporary password, and a change is forced before anything else works.
- **Sessions are signed tokens**, sent as the `fms_session` cookie by the dashboard and as `Authorization: Bearer` by the mobile app (web 7 days, mobile 30 days). The profile is re-read on every request, so deactivating someone or changing their password cuts off their existing sessions immediately.
- **Default deny.** Every `/api` route needs a session except login, logout and the scale-device endpoints, which authenticate with a device key instead.
- **Roles:** `ADMIN` can do everything. Employees are `MANAGER` or `WORKER`, and [`src/lib/permissions.ts`](src/lib/permissions.ts) lists exactly which routes each may call.

## Adding a resource

1. **Validator** `src/validators/thing.validator.ts`: Zod schemas for the body and the list query (extend `paginationQuerySchema`).
2. **Service** `src/services/thing.service.ts`: the rules. Throw `AppError`, use a transaction for multi-row writes, and add `thing.service.test.ts`.
3. **Controller** `src/controllers/thing.controller.ts`: `withHandler(c, async () => sendSuccess(c, await ThingService.create(getValid(c, "json"))))`.
4. **Routes** `src/routes/thing.routes.ts`: `thingRoutes.post("/", zValidatorRfc7807("json", createThingSchema), ThingController.create)`.
5. **Mount** it in `src/routes/index.ts`, and **grant** employee access in `src/lib/permissions.ts` if field staff need it.
6. **Schema change?** Edit `prisma/schema.prisma`, then `bun run db:migrate --name what_changed`.

## Deployment

Production runs `bun index.ts` as a systemd service on a Linux VM, behind Caddy (automatic TLS) at `https://api.zfarms.zerod.bd`.

1. **Migrate first.** Additive changes don't break the running version: `prisma migrate deploy` against the production database.
2. **Ship the code.** Copy the tree to the server (excluding `node_modules`, `.env` and `.git`), and `bun install` if dependencies changed.
3. **Restart the service** and check `GET /health`.

Production `.env` lives only on the server: set `NODE_ENV=production`, `TRUST_PROXY=true` (Caddy overwrites `X-Forwarded-For`), its own `SESSION_SECRET`, and `ALLOWED_ORIGINS` set to the dashboard's URL.

## Documentation

| Doc | Covers |
| --- | --- |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Feature set by role and page, and the permission matrix |
| [`docs/system-design-arc.md`](docs/system-design-arc.md) | System design and the reasoning behind the schema |
| [`docs/api.md`](docs/api.md) | Endpoint reference with examples |
| [`docs/inventory-tracking-design.md`](docs/inventory-tracking-design.md) | QR-coded units, lots and the stock ledger |
| [`docs/batch-management-design.md`](docs/batch-management-design.md) | Batches, houses, transfers, mortality |
| [`docs/employee-payroll-design.md`](docs/employee-payroll-design.md) · [`docs/payroll-ledger-bridge.md`](docs/payroll-ledger-bridge.md) | Points, payroll, payouts and the ledgers |
| [`docs/finance-page-design.md`](docs/finance-page-design.md) · [`docs/analytics-dashboard-design.md`](docs/analytics-dashboard-design.md) | What the dashboard's finance and analytics endpoints compute |
| [`docs/SETUP.md`](docs/SETUP.md) · [`docs/contracts/`](docs/contracts/) | Setup details, response and error contracts |
| [`docs/audit/`](docs/audit/) | Database audit: findings, fix plan, verification |
