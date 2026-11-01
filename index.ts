import { app } from "./src/App";
import env from "./src/config/env";
import { startAlertScanLoop } from "./src/lib/alert-scan-loop";
import { FarmSettingsService } from "./src/services/farm-settings.service";

// Before serving: every farm-day calculation reads the start hour from memory.
await FarmSettingsService.load();

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

startAlertScanLoop();
