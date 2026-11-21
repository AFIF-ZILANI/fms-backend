// Generates docs/endpoints.md: every route, who may call it, its status code and its inputs.
//
//   bun run docs:endpoints
//
// Everything comes from the source, so the table cannot drift from the code:
//   routes      src/routes/index.ts (mount prefixes) + each *.routes.ts
//   access      the real canAccess() in src/lib/permissions.ts, probed as WORKER and MANAGER
//   status      the sendSuccess(..., 201) / sendNoContent() call in the controller
//   inputs      the Zod schemas named in zValidatorRfc7807(...), read as text
// It reads files as text and never connects to the database.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { canAccess } from "../src/lib/permissions";
import type { AuthContext } from "../src/types/app";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(ROOT + p, "utf8");

// ── Routes ────────────────────────────────────────────────────────────────────

const index = read("src/routes/index.ts");
const routerFile = new Map<string, string>(); // imported router variable -> routes file stem
for (const m of index.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@routes\/([^"]+)"/g)) {
    for (const v of m[1]!.split(",")) routerFile.set(v.trim(), m[2]!);
}
const mounts = [...index.matchAll(/appRoutes\.route\("([^"]+)",\s*(\w+)\)/g)].map((m) => ({
    prefix: m[1]!,
    file: routerFile.get(m[2]!)!,
    router: m[2]!,
}));

type Route = {
    method: string;
    path: string; // relative to /api
    schemas: { json?: string; query?: string };
    handler?: { alias: string; name: string };
    deviceKey: boolean;
};

function routesOf(file: string, router: string, prefix: string): Route[] {
    const src = read(`src/routes/${file}.ts`);
    const re = new RegExp(
        `\\b${router}\\.(get|post|put|patch|delete)\\(\\s*"([^"]*)"([\\s\\S]*?)\\);`,
        "g",
    );
    return [...src.matchAll(re)].map((m) => {
        const args = m[3]!;
        const json = /zValidatorRfc7807\("json",\s*(\w+)\)/.exec(args)?.[1];
        const query = /zValidatorRfc7807\("query",\s*(\w+)\)/.exec(args)?.[1];
        const h = /(\w+)\.(\w+)\s*,?\s*$/.exec(args.trim());
        return {
            method: m[1]!.toUpperCase(),
            path: prefix + (m[2] === "/" ? "" : m[2]),
            schemas: { json, query },
            handler: h ? { alias: h[1]!, name: h[2]! } : undefined,
            deviceKey: /requireDevice/.test(args),
        };
    });
}

// ── Controllers: success message and status ───────────────────────────────────

function controllerFiles(routesSrc: string): Map<string, string> {
    // `import { FooController as C } from "@controllers/foo.controller"` -> C -> foo.controller
    const out = new Map<string, string>();
    for (const m of routesSrc.matchAll(
        /import\s*\{\s*(\w+)(?:\s+as\s+(\w+))?\s*\}\s*from\s*"@controllers\/([^"]+)"/g,
    )) {
        out.set(m[2] ?? m[1]!, m[3]!);
    }
    return out;
}

const humanize = (s: string) =>
    s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());

const GENERIC: Record<string, string> = {
    getAll: "List",
    getById: "Get one",
    create: "Create",
    update: "Update",
    remove: "Delete",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
};

function describe(route: Route, file: string): { status: number; what: string } {
    const name = route.handler?.name ?? "";
    const none = { status: 200, what: GENERIC[name] ?? (name ? humanize(name) : "") };
    if (!route.handler) return none;
    const file2 = controllerFiles(read(`src/routes/${file}.ts`)).get(route.handler.alias);
    if (!file2) return { status: route.handler.name === "create" ? 201 : 200, what: none.what }; // lookup factory
    const src = read(`src/controllers/${file2}.ts`);
    const start = src.search(new RegExp(`\\basync\\s+${route.handler.name}\\s*\\(`));
    if (start < 0) return none;
    const rest = src.slice(start + 1);
    const end = rest.search(/\n {4}(?:async\s+)?\w+\s*\(/);
    const body = end < 0 ? rest : rest.slice(0, end);
    if (/sendNoContent/.test(body)) return { status: 204, what: none.what };
    const call = /send(?:Success|List)\(([\s\S]*?)\);/.exec(body)?.[1] ?? "";
    const message = [...call.matchAll(/"([^"]+)"/g)].pop()?.[1];
    const status = /,\s*(201|204)\s*(?:,|$)/.exec(call.trim())?.[1];
    const sentence = message && /^[A-Z][^()]{2,80}$/.test(message) ? message : none.what;
    return { status: status ? Number(status) : 200, what: sentence };
}

// ── Inputs: top-level fields of a Zod schema ──────────────────────────────────

const decls = new Map<string, string>(); // const name -> its source text
for (const f of [
    ...readdirSync(ROOT + "src/validators").map((f) => `src/validators/${f}`),
    "src/lib/pagination.ts",
]) {
    if (f.endsWith(".test.ts")) continue;
    const src = read(f);
    const heads = [...src.matchAll(/^(?:export )?const (\w+)\s*=/gm)];
    heads.forEach((h, i) =>
        decls.set(h[1]!, src.slice(h.index, heads[i + 1]?.index ?? src.length)),
    );
}

function matching(s: string, open: number): number {
    // index of the bracket closing the one at `open`, skipping strings
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i]!;
        if (c === '"' || c === "'" || c === "`") {
            for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++;
        } else if ("({[".includes(c)) depth++;
        else if (")}]".includes(c) && --depth === 0) return i;
    }
    return s.length;
}

function entries(body: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < body.length; i++) {
        const c = body[i]!;
        if (c === '"' || c === "'" || c === "`") {
            let j = i + 1; // end of the string literal
            while (j < body.length && body[j] !== c) j += body[j] === "\\" ? 2 : 1;
            cur += body.slice(i, j + 1);
            i = j;
            continue;
        }
        if ("({[".includes(c)) depth++;
        if (")}]".includes(c)) depth--;
        if (c === "," && depth === 0) {
            out.push(cur);
            cur = "";
        } else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map((e) => e.trim()).filter(Boolean);
}

const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

type Fields = Map<string, boolean>; // field -> optional?

function objectFields(body: string, seen: Set<string>): Fields {
    const fields: Fields = new Map();
    for (const e of entries(body)) {
        const spread = /^\.\.\.(\w+)$/.exec(e);
        if (spread) {
            for (const [k, v] of fieldsOf(spread[1]!, seen) ?? []) fields.set(k, v);
            continue;
        }
        const key = /^(\w+)\s*:([\s\S]*)$/.exec(e);
        if (key) fields.set(key[1]!, /\.optional\(\)|\.nullish\(\)|\.default\(/.test(key[2]!));
        else if (/^\w+$/.test(e)) fields.set(e, false); // shorthand: `{ reason }`
    }
    return fields;
}

/** Evaluates `z.object({...})`, `{...}` or `other` followed by .extend/.merge/.omit/.pick/.partial chains. */
function fieldsOf(name: string, parents = new Set<string>()): Fields | null {
    const decl = decls.get(name);
    if (!decl || parents.has(name)) return null;
    const seen = new Set(parents).add(name);
    const rhs = stripComments(decl)
        .replace(/^[^=]*=\s*/, "")
        .trim();

    let fields: Fields | null;
    let pos: number;
    const obj = /^z\s*\.object\(/.exec(rhs);
    if (obj) {
        const open = obj[0].length - 1;
        pos = matching(rhs, open) + 1;
        const arg = rhs.slice(open + 1, pos - 1).trim();
        fields = arg.startsWith("{") ? objectFields(arg.slice(1, -1), seen) : fieldsOf(arg, seen);
    } else if (rhs.startsWith("{")) {
        pos = matching(rhs, 0) + 1;
        fields = objectFields(rhs.slice(1, pos - 1), seen);
    } else {
        const id = /^\w+/.exec(rhs);
        if (!id) return null;
        pos = id[0].length;
        fields = fieldsOf(id[0], seen);
    }
    if (!fields) return null;

    const out: Fields = new Map(fields);
    for (
        let call = /^\s*\.(\w+)\s*\(/.exec(rhs.slice(pos));
        call;
        call = /^\s*\.(\w+)\s*\(/.exec(rhs.slice(pos))
    ) {
        const open = pos + call[0].length - 1;
        const close = matching(rhs, open);
        const arg = rhs.slice(open + 1, close).trim();
        const keys = [...arg.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
        if (call[1] === "extend" && arg.startsWith("{"))
            for (const [k, v] of objectFields(arg.slice(1, -1), seen)) out.set(k, v);
        else if (call[1] === "merge") for (const [k, v] of fieldsOf(arg, seen) ?? []) out.set(k, v);
        else if (call[1] === "omit") keys.forEach((k) => out.delete(k));
        else if (call[1] === "pick")
            [...out.keys()].filter((k) => !keys.includes(k)).forEach((k) => out.delete(k));
        else if (call[1] === "partial") [...out.keys()].forEach((k) => out.set(k, true));
        pos = close + 1; // refine / superRefine / transform / ... don't change the fields
    }
    return out;
}

function inputs(r: Route): string {
    const parts: string[] = [];
    for (const [kind, name] of [
        ["body", r.schemas.json],
        ["query", r.schemas.query],
    ] as const) {
        if (!name) continue;
        const f = fieldsOf(name);
        if (!f || f.size === 0) {
            parts.push(`${kind}: \`${name}\``);
            continue;
        }
        const all = [...f.values()].every(Boolean);
        const list = [...f].map(([k, opt]) => `\`${k}${opt && !all ? "?" : ""}\``).join(", ");
        parts.push(`${kind}: ${all && kind === "body" ? "any of " : ""}${list}`);
    }
    return parts.join("<br>") || "—";
}

// ── Access ────────────────────────────────────────────────────────────────────

const authSrc = read("src/middlewares/authenticate.ts");
const PUBLIC = new Set(
    [...(/new Set\(\[([\s\S]*?)\]\)/.exec(authSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
        (m) => m[1],
    ),
);

const as = (employee_role: "WORKER" | "MANAGER") =>
    ({ role: "EMPLOYEE", employee_role, employee_id: "me" }) as unknown as AuthContext;

function access(r: Route): string {
    if (PUBLIC.has(`${r.method} /api${r.path}`)) return r.deviceKey ? "Device key" : "Public";
    if (r.path.startsWith("/auth/")) return "Anyone signed in";
    const own = r.path.replace(/:\w+/g, "me");
    const other = r.path.replace(/:\w+/g, "x");
    const none = () => undefined;
    const me = (n: string) => (n === "employee_id" ? "me" : undefined);
    if (canAccess(as("WORKER"), r.method, other, none)) return "Worker, Manager, Admin";
    if (canAccess(as("WORKER"), r.method, own, me)) return "Worker (own record), Manager, Admin";
    if (canAccess(as("MANAGER"), r.method, other, none)) return "Manager, Admin";
    if (canAccess(as("MANAGER"), r.method, own, me)) return "Manager, Admin"; // own-rule, manager sees any
    return "Admin";
}

// ── Output ────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\|/g, "\\|");
let total = 0;
const sections: string[] = [];
const toc: string[] = [];
for (const { prefix, file, router } of mounts) {
    const routes = routesOf(file, router, prefix);
    if (!routes.length) continue;
    total += routes.length;
    toc.push(
        `[\`/api${prefix}\`](#api${prefix.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")})`,
    );
    const rows = routes.map((r) => {
        const d = describe(r, file);
        return `| ${r.method} | \`/api${r.path}\` | ${access(r)} | ${d.status} | ${esc(inputs(r))} | ${esc(d.what)} |`;
    });
    sections.push(
        `### \`/api${prefix}\`\n\n| Method | Path | Access | Status | Input | What it does |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
    );
}

const doc = `# Endpoint index

Every route the API serves (${total + 1} in all), generated from the source by \`bun run docs:endpoints\`. Do not edit by hand: change the code and regenerate.

For what the fields mean, the error cases and worked examples, see [\`api.md\`](api.md). For conventions (envelope, pagination, errors, idempotency) see its section 1.

## How to read it

- **Access** is evaluated with the real \`canAccess()\` in [\`src/lib/permissions.ts\`](../src/lib/permissions.ts), so it is what the server enforces. Admins may call everything. An employee may call only what a rule grants, and the rule is for their level: *Worker* rules cover WORKER and MANAGER, *Manager* rules cover MANAGER only. Everything not listed there is **Admin** only (default deny). *Public* needs no session, *Device key* needs a paired scale device's token, and *Anyone signed in* covers the self-service \`/auth\` routes.
- **Status** is the success status the controller sends (\`200\` unless it says otherwise). Failures are RFC 7807 problem responses; see \`api.md\` section 1.3.
- **Input** lists the top-level fields of the Zod schema that validates the request. A trailing \`?\` marks an optional field, and *any of* means every field is optional (a partial update). A bare schema name means its shape isn't a plain object. List endpoints also take \`page\` and \`limit\`.
- \`:id\` and other \`:name\` segments are path parameters.

## Contents

[\`/health\`](#health) · ${toc.join(" · ")}

### \`/health\`

| Method | Path | Access | Status | Input | What it does |
| --- | --- | --- | --- | --- | --- |
| GET | \`/health\` | Public | 200 | — | Liveness check (outside \`/api\`) |

${sections.join("\n")}`;

writeFileSync(ROOT + "docs/endpoints.md", doc);
console.log(`docs/endpoints.md: ${total + 1} routes in ${sections.length + 1} groups`);
