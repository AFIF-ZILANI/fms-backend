# Error Contract — RFC 7807 Problem Details

All API errors follow [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) — the IETF standard for HTTP API error responses.

> **Why RFC 7807?**
>
> - Interoperable — any HTTP client can parse it automatically
> - Standardised `type` URI enables link-relation lookups
> - `instance` field enables per-request tracing
> - Widely adopted (used by AWS, Azure, Spring Boot, FastAPI, etc.)

## Problem Details Format

```json
{
    "type": "https://api.bhaze.dev/errors/not-found",
    "title": "Not Found",
    "status": 404,
    "detail": "User not found",
    "instance": "/api/users/abc123"
}
```

### Field Definitions (RFC 7807 §3)

| Field        | Type           | Required | Description                                                                             |
| ------------ | -------------- | -------- | --------------------------------------------------------------------------------------- |
| `type`       | `string` (URI) | **Yes**  | Identifies the problem type. Clients should use this to programmatically handle errors. |
| `title`      | `string`       | **Yes**  | Short, human-readable summary. Same for all occurrences of this problem type.           |
| `status`     | `number`       | **Yes**  | HTTP status code.                                                                       |
| `detail`     | `string`       | **Yes**  | Human-readable explanation specific to this occurrence.                                 |
| `instance`   | `string` (URI) | No       | URI identifying the specific occurrence (e.g. request path).                            |
| `extensions` | `object`       | No       | Additional structured data (not in RFC 7807, but RFC 9457 allows it).                   |

## AppError Class

The `AppError` class is the single source of truth for all application errors.

### Static Factories

| Method                                         | Status | `type` URI          | Usage                             |
| ---------------------------------------------- | ------ | ------------------- | --------------------------------- |
| `AppError.badRequest(detail, extensions?)`     | 400    | `.../bad-request`   | Validation errors, missing fields |
| `AppError.unauthorized(detail?)`               | 401    | `.../unauthorized`  | Authentication failures           |
| `AppError.forbidden(detail?)`                  | 403    | `.../forbidden`     | Authorization failures            |
| `AppError.notFound(resource, instance?)`       | 404    | `.../not-found`     | Resource not found                |
| `AppError.conflict(detail, extensions?)`       | 409    | `.../conflict`      | Duplicate resource                |
| `AppError.unprocessable(detail, extensions?)`  | 422    | `.../unprocessable` | Semantic validation failure       |
| `AppError.tooManyRequests(detail?)`            | 429    | `.../rate-limited`  | Rate limit exceeded               |
| `AppError.internal(detail?, cause?)`           | 500    | `.../internal`      | Unexpected server error           |
| `AppError.serviceUnavailable(detail?, cause?)` | 503    | `.../unavailable`   | Dependency unavailable            |

### Properties

```ts
class AppError {
    readonly name: "AppError";
    readonly status: ErrorStatus;
    readonly type: string; // RFC 7807 type URI
    readonly title: string; // RFC 7807 title
    readonly detail: string; // RFC 7807 detail
    readonly instance?: string; // RFC 7807 instance
    readonly extensions?: Record<string, unknown>;
    readonly timestamp: string; // ISO 8601
}
```

### Converting to Problem Details

```ts
const err = AppError.notFound("User", "/api/users/123");
err.toProblemDetails();
// → { type: ".../not-found", title: "Not Found", status: 404, detail: "User not found", instance: "/api/users/123" }
```

## Error Handling Flow

```
Request
  │
  ├─→ Middleware (validation, auth, etc.)
  │     └─ throw AppError.badRequest("Validation failed", { fields: {...} })
  │
  ├─→ Controller
  │     └─ calls service (wrapped in withHandler)
  │
  ├─→ Service
  │     └─ throw AppError.notFound("User", "/api/users/123")
  │
  └─→ withHandler() catches error
        └─→ sendError(c, err)
              └─→ c.json(err.toProblemDetails(), err.status)
                    └─→ RFC 7807 JSON response
```

### withHandler Wrapper

```ts
import { withHandler } from "@lib/helper";

export const UserController = {
    async getById(c: Context) {
        return withHandler(c, async () => {
            const user = await UserService.getById(id);
            return sendSuccess(c, user, "User fetched");
        });
    },
};
```

**What it does:**

1. Executes the async function
2. On success → `sendSuccess(c, data)`
3. On `AppError` → `sendError(c, err)` (RFC 7807)
4. On unknown error → `sendError(c, AppError.internal(...))`

### Global Error Handler

The `App.ts` `onError` handler catches errors that escape `withHandler`:

```ts
app.onError((err, c) => {
    if (err instanceof AppError) return sendError(c, err);
    if (err instanceof HTTPException) return sendErrorRaw(c, err.message, err.status);
    return sendErrorRaw(c, "An unexpected error occurred", 500, c.req.path);
});
```

## Examples

### Service Layer — Basic

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

### With Extensions (Validation Details)

```ts
throw AppError.badRequest("Validation failed", {
    fields: {
        email: "Invalid email format",
        name: "Name is required",
    },
});
// → RFC 7807:
// {
//   "type": "https://api.bhaze.dev/errors/bad-request",
//   "title": "Bad Request",
//   "status": 400,
//   "detail": "Validation failed",
//   "extensions": { "fields": { "email": "Invalid email format", "name": "Name is required" } }
// }
```

### With Instance (Request Tracing)

```ts
throw AppError.notFound("User", `/api/users/${id}`);
// → RFC 7807:
// {
//   "type": "https://api.bhaze.dev/errors/not-found",
//   "title": "Not Found",
//   "status": 404,
//   "detail": "User not found",
//   "instance": "/api/users/abc123"
// }
```

### Catching Unknown Errors

```ts
try {
    await someExternalService();
} catch (err) {
    throw AppError.serviceUnavailable("Database connection failed", err);
    // → RFC 7807 503 with cause preserved in AppError
}
```

## Client-Side Handling

```ts
const response = await fetch("/api/users/123");

if (!response.ok) {
    const problem: ProblemDetails = await response.json();

    // Programmatic handling by error type
    switch (problem.status) {
        case 404:
            showNotFound(problem.detail);
            break;
        case 409:
            showConflict(problem.detail);
            break;
        case 400:
            showValidationErrors(problem.extensions?.fields);
            break;
        default:
            showError(problem.detail);
    }
}
```

## Content-Type

All RFC 7807 responses use `Content-Type: application/problem+json` (set automatically by Hono's `c.json()`).
