# Setup & Architecture

## 1. Install & Run

### Bun (recommended)

```bash
bun install          # installs deps + runs prisma generate (postinstall)
bun run db:migrate   # run migrations
bun run dev          # http://localhost:5085
```

### Node.js

```bash
npm install                # installs deps + runs prisma generate (postinstall)
npx prisma migrate dev     # run migrations (the `db:migrate` script calls bunx)
npm run dev:node           # http://localhost:5085
```

---

## 2. Environment Variables

All env vars are validated at startup via Zod. **Never use `process.env` directly** — always import from `@config/env`:

```ts
import env from "@config/env";
const port = env.PORT; // ✅ typed, validated
```

### Variables

The full list, with the default and purpose of each, is the Configuration table in the
[README](../README.md#configuration). [`.env.example`](../.env.example) is a ready-to-copy
template:

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and `SESSION_SECRET` (32+ characters: `openssl rand -base64 48`). The five
`CLOUDINARY_*` values are also required, because the server exits at startup without them.
Everything else has a development default.

### Adding a New Variable

1. Add the field to `src/config/env.ts`:

```ts
const envSchema = z.object({
    // ...existing vars
    MY_NEW_VAR: z.string().default("default-value"),
});
```

2. Add it to `.env` and to `.env.example`:

```env
MY_NEW_VAR=default-value
```

3. Use it anywhere via import:

```ts
import env from "@config/env";
const value = env.MY_NEW_VAR;
```

### TypeScript

The `Env` type is exported from `config/env.ts`:

```ts
import type { Env } from "@config/env";

function configureDb(env: Env) {
    const url = env.DATABASE_URL;
}
```

### Validation Errors

If a required variable is missing or invalid, the server exits immediately:

```
❌ Invalid environment variables:
{
  DATABASE_URL: ["DATABASE_URL is required"],
  PORT: ["Expected number, received string"]
}
```

### Security

- **Never commit `.env` to version control** — it's in `.gitignore`
- **Use `.env.local`** for local overrides (also gitignored)
- **In production** the `.env` lives only on the server and is never copied from the repo (see the README's Deployment section)
- **Secrets** — `DATABASE_URL` contains credentials; treat as sensitive

---

## 3. Architecture

### Request Lifecycle

```
Client Request
  │
  ├─→ secureHeaders()       Set security headers
  ├─→ csrf()                CSRF protection (prod only)
  ├─→ cors()                Cross-origin resource sharing
  ├─→ timeout()             Request timeout (configurable)
  ├─→ rateLimiter()         Rate limiting (configurable)
  ├─→ logger()              Request/response logging
  │
  ├─→ Route Handler
  │     ├─→ zValidator()    Validate request body (Zod)
  │     ├─→ Controller      Parse request, call service
  │     ├─→ Service         Business logic, Prisma queries
  │     └─→ withHandler()   Wrap in success/error envelope
  │
  └─→ Response
        ├─→ 2xx: SuccessResponse { success, message, data, meta? }
        └─→ 4xx/5xx: RFC 7807 ProblemDetails { type, title, status, detail, instance? }
```

### Middleware Stack

| #   | Middleware      | Purpose                               |
| --- | --------------- | ------------------------------------- |
| 1   | `secureHeaders` | CSP, X-Frame-Options, Referrer-Policy |
| 2   | `csrf`          | CSRF token validation (prod only)     |
| 3   | `cors`          | Cross-origin resource sharing         |
| 4   | `timeout`       | Request timeout (configurable)        |
| 5   | `rateLimiter`   | Rate limiting (configurable)          |
| 6   | `logger`        | Request/response logging              |

### Data Flow

```
HTTP Request
  → Zod Validator (validates body/query/params)
    → Controller (extracts validated data)
      → Service (business logic + Prisma queries)
        → Prisma (database)
      ← Service returns data
    ← Controller wraps in sendSuccess()
  ← withHandler() sends Response

Any error at any layer → AppError → RFC 7807 ProblemDetails
```

### Error Handling

All errors are converted to **RFC 7807 Problem Details**:

1. **Service layer** throws `AppError` (typed static factories)
2. **`withHandler()`** catches and converts to RFC 7807 via `sendError(c, err)`
3. **Global `app.onError()`** catches anything that escapes
4. **`app.notFound()`** handles unmatched routes

```ts
// Service throws → withHandler catches → RFC 7807 response
throw AppError.notFound("User");
// → { type: ".../not-found", title: "Not Found", status: 404, detail: "User not found" }
```

### Key Patterns

**Singleton Services** — plain objects with methods, no instantiation:

```ts
export const UserService = {
  async getAll() { ... },
  async getById(id: string) { ... },
};
```

**withHandler Wrapper** — every controller method is wrapped:

```ts
async getById(c: Context) {
  return withHandler(c, async () => {
    const user = await UserService.getById(id);
    return sendSuccess(c, user, "User fetched");
  });
}
```

**Path Aliases** — import paths aliased in `tsconfig.json`:

```ts
import { AppError } from "@lib/app-error"; // → src/lib/app-error.ts
import { UserService } from "@services/user.service"; // → src/services/user.service.ts
```
