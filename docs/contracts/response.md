# Response Contract

All API responses follow a consistent JSON envelope. Errors use **RFC 7807 Problem Details** ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)).

## Success Response

```json
{
  "success": true,
  "message": "Users fetched successfully",
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### Fields

| Field     | Type     | Required       | Description                    |
| --------- | -------- | -------------- | ------------------------------ |
| `success` | `true`   | Always         | Indicates successful operation |
| `message` | `string` | Always         | Human-readable description     |
| `data`    | `T`      | Always         | The response payload           |
| `meta`    | `Meta`   | Paginated only | Pagination metadata            |

### Meta (Pagination)

| Field        | Type     | Description              |
| ------------ | -------- | ------------------------ |
| `page`       | `number` | Current page (1-indexed) |
| `limit`      | `number` | Items per page           |
| `total`      | `number` | Total item count         |
| `totalPages` | `number` | Total page count         |

### Status Codes

| Code  | When                        |
| ----- | --------------------------- |
| `200` | Successful read/update      |
| `201` | Successful create           |
| `204` | Successful delete (no body) |

---

## Error Response — RFC 7807 Problem Details

All errors follow [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) — a standardised JSON format for HTTP API errors.

```json
{
    "type": "https://api.bhaze.dev/errors/not-found",
    "title": "Not Found",
    "status": 404,
    "detail": "User not found",
    "instance": "/api/users/abc123"
}
```

### Fields

| Field        | Type           | Required | Description                                                  |
| ------------ | -------------- | -------- | ------------------------------------------------------------ |
| `type`       | `string (URI)` | Always   | Identifies the error class (see [Error Types](#error-types)) |
| `title`      | `string`       | Always   | Short human-readable summary of the error type               |
| `status`     | `number`       | Always   | HTTP status code                                             |
| `detail`     | `string`       | Always   | Human-readable explanation specific to this occurrence       |
| `instance`   | `string (URI)` | Optional | URI identifying the specific occurrence (e.g. request path)  |
| `extensions` | `object`       | Optional | Additional structured data (validation errors, etc.)         |

### Error Types

| Status | `type` URI                                   | `title`               |
| ------ | -------------------------------------------- | --------------------- |
| 400    | `https://api.bhaze.dev/errors/bad-request`   | Bad Request           |
| 401    | `https://api.bhaze.dev/errors/unauthorized`  | Unauthorized          |
| 403    | `https://api.bhaze.dev/errors/forbidden`     | Forbidden             |
| 404    | `https://api.bhaze.dev/errors/not-found`     | Not Found             |
| 409    | `https://api.bhaze.dev/errors/conflict`      | Conflict              |
| 422    | `https://api.bhaze.dev/errors/unprocessable` | Unprocessable Entity  |
| 429    | `https://api.bhaze.dev/errors/rate-limited`  | Too Many Requests     |
| 500    | `https://api.bhaze.dev/errors/internal`      | Internal Server Error |
| 503    | `https://api.bhaze.dev/errors/unavailable`   | Service Unavailable   |

### Validation Error Example

```json
{
    "type": "https://api.bhaze.dev/errors/bad-request",
    "title": "Bad Request",
    "status": 400,
    "detail": "Validation failed",
    "instance": "/api/users",
    "extensions": {
        "fields": {
            "email": "Invalid email format",
            "name": "Name is required"
        }
    }
}
```

---

## Usage

### In Controllers (with withHandler)

```ts
import { sendSuccess } from "@lib/response";
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

### Throwing Errors (Service Layer)

```ts
import { AppError } from "@lib/app-error";

// AppError.notFound("User") → RFC 7807:
// { type: ".../not-found", title: "Not Found", status: 404, detail: "User not found" }

throw AppError.notFound("User");

throw AppError.conflict("Email already exists");

throw AppError.badRequest("Validation failed", {
    fields: { email: "Invalid email format" },
});
```

### Direct Error Responses

```ts
import { sendErrorRaw } from "@lib/response";

// From raw values
return sendErrorRaw(c, "Route not found", 404, c.req.path);
```

### Type Safety

All types are exported from `@types`:

```ts
import type {
    ApiResponse, // SuccessResponse<T> | ProblemDetails
    SuccessResponse,
    ProblemDetails, // RFC 7807
    Meta,
    ErrorStatus,
} from "@types";
```
