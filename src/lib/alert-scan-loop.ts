import env from "@config/env";
import { AlertService } from "@services/alert.service";

/**
 * Runs the alert reconciliation on a timer.
 *
 * Without this, every alert the system raises -- probation ending, last month's
 * payroll not generated, wages unpaid past day 5 -- only appears when somebody
 * happens to open the Alerts page. A reminder that waits to be asked for isn't
 * a reminder.
 *
 * ponytail: setInterval in-process, not a cron dependency. It is one timer in a
 * single-instance server; the day this runs on more than one instance, the scans
 * will overlap and want a real scheduler with a lock.
 */
export function startAlertScanLoop() {
    const intervalMs = env.ALERT_SCAN_INTERVAL_MS;
    if (intervalMs <= 0) {
        console.log("[alerts] periodic scan disabled (ALERT_SCAN_INTERVAL_MS=0)");
        return;
    }

    let running = false;
    const scan = async () => {
        // A slow scan must not stack up behind itself.
        if (running) return;
        running = true;
        try {
            await AlertService.runScan();
        } catch (err) {
            // Never let a failed scan take the server down -- it is a background
            // reminder, not part of serving a request.
            console.error("[alerts] scan failed", err);
        } finally {
            running = false;
        }
    };

    // The first scan waits one interval rather than firing at boot: a restart
    // loop would otherwise hammer the database with scans.
    const timer = setInterval(() => void scan(), intervalMs);
    // Don't hold the process open on its own account.
    timer.unref?.();
    const every =
        intervalMs < 60_000
            ? `${Math.round(intervalMs / 1000)}s`
            : `${Math.round(intervalMs / 60_000)} min`;
    console.log(`[alerts] periodic scan every ${every}`);
}
