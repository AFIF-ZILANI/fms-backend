# bhaze 🔥

> **B**un · **H**ono · **A**rc · **Z**od · **E**cosystem

A production-ready API template with RFC 7807 error handling, type-safe env validation, and zero `process.env` leaks.

---

## Stack

| Layer      | Tool                                                               |
| ---------- | ------------------------------------------------------------------ |
| Runtime    | Bun (primary) / Node.js (fallback)                                 |
| Framework  | Hono                                                               |
| ORM        | Prisma + PostgreSQL                                                |
| Validation | Zod (request bodies + env vars)                                    |
| Errors     | [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) Problem Details |
| Structure  | Controller → Service → Prisma                                      |

---

## Quick Start

### Bun (recommended)

```bash
bun install          # installs deps + runs prisma generate (postinstall)
bun run db:migrate   # run migrations
bun run dev          # http://localhost:5085
```

### Node.js

```bash
npm install          # installs deps + runs prisma generate (postinstall)
npm run db:migrate   # run migrations
npm run dev:node     # http://localhost:5085
```

---

## Scripts

| Command               | Description                      |
| --------------------- | -------------------------------- |
| `bun run dev`         | Dev server with hot reload (Bun) |
| `npm run dev:node`    | Dev server (Node.js via tsx)     |
| `bun run start`       | Production server (Bun)          |
| `npm run start:node`  | Production server (Node.js)      |
| `bun run build`       | Build for Node.js deployment     |
| `bun run db:generate` | Generate Prisma client           |
| `bun run db:migrate`  | Run Prisma migrations            |
| `bun run db:push`     | Push schema to database          |
| `bun run format`      | Format with Prettier             |
| `bun run typecheck`   | TypeScript type check            |

---

## Project Structure

```
src/
├── config/
│   └── env.ts              # Env validation (Zod) — the ONLY place that touches process.env
├── controllers/
│   └── user.controller.ts  # Request handlers (wrap in withHandler)
├── lib/
│   ├── app-error.ts        # RFC 7807 AppError class
│   ├── db.ts               # Prisma singleton
│   ├── helper.ts           # withHandler() wrapper
│   ├── response.ts         # sendSuccess / sendError
│   └── validator.ts        # Zod validator with RFC 7807 errors
├── routes/
│   ├── index.ts            # Route aggregator
│   └── user.routes.ts      # User CRUD routes
├── services/
│   └── user.service.ts     # Business logic (throws AppError)
├── types/
│   ├── app.ts              # Hono environment types
│   └── index.ts            # Public type exports
├── validators/
│   └── user.validator.ts   # Zod schemas
└── App.ts                  # Hono app (middleware stack, error handling)
```

---

## Environment Variables

All env vars are validated at startup via Zod. **Never use `process.env` directly** — always import from `@config/env`.

```ts
import env from "@config/env";
const port = env.PORT; // ✅ typed, validated
```

| Variable               | Type                                      | Default                                               | Description                  |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `PORT`                 | `number`                                  | `5085`                                                | Server port                  |
| `NODE_ENV`             | `"development" \| "production" \| "test"` | `"development"`                                       | Runtime environment          |
| `DATABASE_URL`         | `string`                                  | `postgresql://postgres:postgres@localhost:5432/bhaze` | PostgreSQL connection string |
| `ALLOWED_ORIGINS`      | `string`                                  | `http://localhost:5085,http://localhost:5173`         | Comma-separated CORS origins |
| `CORS_CREDENTIALS`     | `boolean`                                 | `true`                                                | Allow credentials            |
| `RATE_LIMIT_MAX`       | `number`                                  | `120`                                                 | Max requests per window      |
| `RATE_LIMIT_WINDOW_MS` | `number`                                  | `60000`                                               | Window duration (ms)         |
| `TIMEOUT_MS`           | `number`                                  | `30000`                                               | Request timeout (ms)         |
| `CSRF_ENABLED`         | `boolean`                                 | `true`                                                | CSRF protection (off in dev) |

Full docs: [`docs/SETUP.md`](./docs/SETUP.md)

---

## Response Contract

### Success

```json
{
  "success": true,
  "message": "Users fetched successfully",
  "data": [...],
  "meta": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

| Field     | Type     | Required       | Description                    |
| --------- | -------- | -------------- | ------------------------------ |
| `success` | `true`   | Always         | Indicates successful operation |
| `message` | `string` | Always         | Human-readable description     |
| `data`    | `T`      | Always         | Response payload               |
| `meta`    | `Meta`   | Paginated only | Pagination metadata            |

### Error — RFC 7807 Problem Details

```json
{
    "type": "https://api.bhaze.dev/errors/not-found",
    "title": "Not Found",
    "status": 404,
    "detail": "User not found",
    "instance": "/api/users/abc-123"
}
```

| Field        | Type           | Required | Description                               |
| ------------ | -------------- | -------- | ----------------------------------------- |
| `type`       | `string (URI)` | Always   | Error class identifier                    |
| `title`      | `string`       | Always   | Short summary of the error type           |
| `status`     | `number`       | Always   | HTTP status code                          |
| `detail`     | `string`       | Always   | Explanation for this specific occurrence  |
| `instance`   | `string (URI)` | No       | Request path / occurrence identifier      |
| `extensions` | `object`       | No       | Additional data (validation fields, etc.) |

Full docs: [`docs/contracts/response.md`](./docs/contracts/response.md)

---

## Error Handling

### AppError Static Factories

| Method                                      | Status | Usage               |
| ------------------------------------------- | ------ | ------------------- |
| `AppError.badRequest(msg, extensions?)`     | 400    | Validation errors   |
| `AppError.unauthorized(msg?)`               | 401    | Auth failures       |
| `AppError.forbidden(msg?)`                  | 403    | Permission denied   |
| `AppError.notFound(resource)`               | 404    | Resource not found  |
| `AppError.conflict(msg)`                    | 409    | Duplicate resource  |
| `AppError.unprocessable(msg, extensions?)`  | 422    | Semantic validation |
| `AppError.tooManyRequests(msg?)`            | 429    | Rate limit          |
| `AppError.internal(msg?, cause?)`           | 500    | Unexpected error    |
| `AppError.serviceUnavailable(msg?, cause?)` | 503    | Dependency down     |

### Usage in Services

```ts
import { AppError } from "@lib/app-error";

export const UserService = {
    async getById(id: string) {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) throw AppError.notFound("User");
        return user;
    },

    async create(data: CreateUserInput) {
        const existing = await prisma.user.findUnique({ where: { email: data.email } });
        if (existing) throw AppError.conflict("Email already exists");
        return prisma.user.create({ data });
    },
};
```

### Usage in Controllers

```ts
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";

export const UserController = {
    async getById(c: Context) {
        return withHandler(c, async () => {
            const user = await UserService.getById(id);
            return sendSuccess(c, user, "User fetched");
        });
    },
};
```

Full docs: [`docs/contracts/error.md`](./docs/contracts/error.md)

---

## Middleware Stack

Applied in order on every request:

| #   | Middleware      | Purpose                               |
| --- | --------------- | ------------------------------------- |
| 1   | `secureHeaders` | CSP, X-Frame-Options, Referrer-Policy |
| 2   | `csrf`          | CSRF token validation (prod only)     |
| 3   | `cors`          | Cross-origin resource sharing         |
| 4   | `timeout`       | Request timeout (configurable)        |
| 5   | `rateLimiter`   | Rate limiting (configurable)          |
| 6   | `logger`        | Request/response logging              |

---

## Path Aliases

| Alias            | Resolves to         |
| ---------------- | ------------------- |
| `@/*`            | `src/*`             |
| `@config/*`      | `src/config/*`      |
| `@controllers/*` | `src/controllers/*` |
| `@lib/*`         | `src/lib/*`         |
| `@routes/*`      | `src/routes/*`      |
| `@services/*`    | `src/services/*`    |
| `@types/*`       | `src/types/*`       |
| `@validators/*`  | `src/validators/*`  |
| `@middlewares/*` | `src/middlewares/*` |

---

## Adding a New Resource

1. **Validator** — `src/validators/product.validator.ts`

```ts
import { z } from "zod";

export const createProductSchema = z.object({
    name: z.string().min(1),
    price: z.number().positive(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
```

2. **Service** — `src/services/product.service.ts`

```ts
import { AppError } from "@lib/app-error";
import prisma from "@lib/db";
import type { CreateProductInput } from "@validators/product.validator";

export const ProductService = {
    async getAll() {
        return prisma.product.findMany();
    },

    async create(data: CreateProductInput) {
        return prisma.product.create({ data });
    },
};
```

3. **Controller** — `src/controllers/product.controller.ts`

```ts
import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { ProductService } from "@services/product.service";
import type { CreateProductInput } from "@validators/product.validator";

export const ProductController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const products = await ProductService.getAll();
            return sendSuccess(c, products, "Products fetched");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = c.get("validatedBody") as CreateProductInput;
            const product = await ProductService.create(body);
            return sendSuccess(c, product, "Product created", 201);
        });
    },
};
```

4. **Routes** — `src/routes/product.routes.ts`

```ts
import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { ProductController } from "@controllers/product.controller";
import { createProductSchema } from "@validators/product.validator";

export const productRoutes = new Hono();

productRoutes.get("/", ProductController.getAll);
productRoutes.post("/", zValidatorRfc7807("json", createProductSchema), ProductController.create);
```

5. **Register** — `src/routes/index.ts`

```ts
import { productRoutes } from "@routes/product.routes";

appRoutes.route("/products", productRoutes);
```

---

## API Endpoints

### Health

```
GET /health → 200 { "status": "ok", "timestamp": "..." }
```

### Users

| Method   | Endpoint         | Body                | Description    |
| -------- | ---------------- | ------------------- | -------------- |
| `GET`    | `/api/users`     | —                   | List all users |
| `GET`    | `/api/users/:id` | —                   | Get user by ID |
| `POST`   | `/api/users`     | `{ name, email }`   | Create user    |
| `PATCH`  | `/api/users/:id` | `{ name?, email? }` | Update user    |
| `DELETE` | `/api/users/:id` | —                   | Delete user    |

---

## Docs

| Doc                                                          | Description                              |
| ------------------------------------------------------------ | ---------------------------------------- |
| [`docs/SETUP.md`](./docs/SETUP.md)                           | Setup, env vars, architecture            |
| [`docs/contracts/response.md`](./docs/contracts/response.md) | Success/error JSON format                |
| [`docs/contracts/error.md`](./docs/contracts/error.md)       | RFC 7807 Problem Details, AppError class |
| [`docs/api.md`](./docs/api.md)                               | Full API reference with examples         |
