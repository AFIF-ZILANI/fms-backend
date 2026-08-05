# API Reference

Base URL: `http://localhost:3000`

## Health Check

### `GET /health`

Returns server status.

**Response** `200 OK`

```json
{
    "status": "ok",
    "timestamp": "2026-08-05T12:00:00.000Z"
}
```

---

## Users

### `GET /api/users`

List all users.

**Response** `200 OK`

```json
{
    "success": true,
    "message": "Users fetched successfully",
    "data": [
        {
            "id": "abc-123",
            "name": "John Doe",
            "email": "john@example.com",
            "createdAt": "2026-08-01T10:00:00.000Z",
            "updatedAt": "2026-08-05T12:00:00.000Z"
        }
    ]
}
```

---

### `GET /api/users/:id`

Get a user by ID.

**Response** `200 OK`

```json
{
    "success": true,
    "message": "User fetched successfully",
    "data": {
        "id": "abc-123",
        "name": "John Doe",
        "email": "john@example.com",
        "createdAt": "2026-08-01T10:00:00.000Z",
        "updatedAt": "2026-08-05T12:00:00.000Z"
    }
}
```

**Error** `404 Not Found`

```json
{
    "type": "https://api.bhaze.dev/errors/not-found",
    "title": "Not Found",
    "status": 404,
    "detail": "User not found",
    "instance": "/api/users/abc-123"
}
```

---

### `POST /api/users`

Create a new user.

**Request Body**

```json
{
    "name": "Jane Doe",
    "email": "jane@example.com"
}
```

**Validation Rules**

| Field   | Type     | Rules                        |
| ------- | -------- | ---------------------------- |
| `name`  | `string` | Required, min 1 character    |
| `email` | `string` | Required, valid email format |

**Response** `201 Created`

```json
{
    "success": true,
    "message": "User created",
    "data": {
        "id": "def-456",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "createdAt": "2026-08-05T12:00:00.000Z",
        "updatedAt": "2026-08-05T12:00:00.000Z"
    }
}
```

**Errors**

| Status | `type`            | When                                  |
| ------ | ----------------- | ------------------------------------- |
| `400`  | `.../bad-request` | Invalid request body (Zod validation) |
| `409`  | `.../conflict`    | Email already exists                  |

```json
{
    "type": "https://api.bhaze.dev/errors/conflict",
    "title": "Conflict",
    "status": 409,
    "detail": "Email already exists"
}
```

---

### `PATCH /api/users/:id`

Update a user. Only provided fields are updated.

**Request Body** (all optional)

```json
{
    "name": "Updated Name",
    "email": "new@example.com"
}
```

**Response** `200 OK`

```json
{
    "success": true,
    "message": "User updated",
    "data": {
        "id": "abc-123",
        "name": "Updated Name",
        "email": "new@example.com",
        "createdAt": "2026-08-01T10:00:00.000Z",
        "updatedAt": "2026-08-05T12:00:00.000Z"
    }
}
```

**Errors**

| Status | `type`            | When                                |
| ------ | ----------------- | ----------------------------------- |
| `400`  | `.../bad-request` | No update fields provided           |
| `404`  | `.../not-found`   | User not found                      |
| `409`  | `.../conflict`    | Email already taken by another user |

---

### `DELETE /api/users/:id`

Delete a user.

**Response** `200 OK`

```json
{
    "success": true,
    "message": "User deleted",
    "data": null
}
```

**Error** `404 Not Found`

```json
{
    "type": "https://api.bhaze.dev/errors/not-found",
    "title": "Not Found",
    "status": 404,
    "detail": "User not found",
    "instance": "/api/users/abc-123"
}
```

---

## Error Responses

All errors follow [RFC 7807 Problem Details](./contracts/error.md).

### Standard Error Format

```json
{
  "type": "https://api.bhaze.dev/errors/{error-type}",
  "title": "{Error Title}",
  "status": {http-status-code},
  "detail": "{human-readable explanation}",
  "instance": "{request-path}",
  "extensions": { ... }
}
```

### Error Types

| Status | `type`              | `title`               |
| ------ | ------------------- | --------------------- |
| 400    | `.../bad-request`   | Bad Request           |
| 401    | `.../unauthorized`  | Unauthorized          |
| 403    | `.../forbidden`     | Forbidden             |
| 404    | `.../not-found`     | Not Found             |
| 409    | `.../conflict`      | Conflict              |
| 422    | `.../unprocessable` | Unprocessable Entity  |
| 429    | `.../rate-limited`  | Too Many Requests     |
| 500    | `.../internal`      | Internal Server Error |
| 503    | `.../unavailable`   | Service Unavailable   |

### Validation Error

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
