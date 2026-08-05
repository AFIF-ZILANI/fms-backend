# Bhaze Template

A production-ready API template built with **Bun**, **Hono**, **Prisma**, and **Zod**.

## Features

- **Bun-native** — uses `Bun.serve()`, `.env` auto-loading, `bun:test`
- **Hono** — lightweight, fast web framework with middleware stack
- **Prisma** — type-safe ORM with PostgreSQL
- **Zod** — runtime validation for env, request bodies, and query params
- **RFC 7807** — standardised error responses (Problem Details for HTTP APIs)
- **Security** — CORS, CSRF, rate limiting, secure headers, timeout
- **Developer experience** — path aliases, Prettier, strict TypeScript

## Quick Start

```bash
# Clone the template
bun create bhaze my-project
cd my-project

# Install dependencies
bun install

# Set up environment
cp .env.example .env   # edit DATABASE_URL

# Generate Prisma client
bun run db:generate

# Start dev server
bun run dev
```

## Project Structure

```
src/
├── config/
│   └── env.ts              # Environment validation (Zod)
├── controllers/
│   └── user.controller.ts  # Request handlers
├── lib/
│   ├── app-error.ts        # RFC 7807 AppError class
│   ├── db.ts               # Prisma singleton
│   ├── helper.ts           # withHandler() wrapper
│   └── response.ts         # Response contract (sendSuccess, sendError)
├── routes/
│   ├── index.ts            # Route aggregator
│   └── user.routes.ts      # User CRUD routes
├── services/
│   └── user.service.ts     # Business logic
├── types/
│   ├── app.ts              # Hono environment types
│   └── index.ts            # Public type exports
├── validators/
│   └── user.validator.ts   # Zod schemas
└── App.ts                  # Hono app setup (middleware, error handling)
```

## Scripts

| Command               | Description                      |
| --------------------- | -------------------------------- |
| `bun run dev`         | Start dev server with hot reload |
| `bun run start`       | Start production server          |
| `bun run db:generate` | Generate Prisma client           |
| `bun run db:migrate`  | Run Prisma migrations            |
| `bun run db:push`     | Push schema to database          |
| `bun run format`      | Format code with Prettier        |
| `bun run typecheck`   | Run TypeScript type checker      |
