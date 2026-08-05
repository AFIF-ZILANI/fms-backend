import { app } from "./src/app";
import env from "./src/config/env";

const port = Number(env.PORT);

// Bun-native server (primary)
if (typeof Bun !== "undefined") {
    Bun.serve({
        fetch: app.fetch,
        port,
    });
    console.log(`[Bun] Server running on http://localhost:${port}`);
}
// Node.js fallback via @hono/node-server
else {
    const { serve } = await import("@hono/node-server");
    serve({ fetch: app.fetch, port }, () => {
        console.log(`[Node] Server running on http://localhost:${port}`);
    });
}
