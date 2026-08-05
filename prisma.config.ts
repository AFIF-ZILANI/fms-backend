import { readFileSync } from "node:fs";
import { defineConfig } from "prisma/config";

// ponytail: the Prisma CLI's bin shebang runs under plain node, which skips
// Bun's own .env auto-load — so DATABASE_URL is missing by the time this
// config evaluates unless we load it ourselves. Minimal inline parse, only
// fills vars not already set (CI providing DATABASE_URL directly wins).
// Upgrade path: drop this once the runtime floor guarantees Node's
// `--env-file` / `process.loadEnvFile`.
try {
    for (const line of readFileSync(".env", "utf-8").split("\n")) {
        const match = /^([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
        if (!match?.[1] || match[1] in process.env) continue;
        process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
    }
} catch {
    // no .env file — fine in environments that inject vars directly
}

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: process.env["DATABASE_URL"],
    },
});
