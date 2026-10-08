import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AppError } from "@lib/app-error";
import { NotificationService } from "@services/notification.service";
import type { ListNotificationsQuery } from "@validators/notification.validator";
import type { AuthContext } from "../types/app";

/** Everything here is about the caller's own notifications; there is no way to name someone else's. */
const me = (c: Context): string => {
    const auth = c.get("auth") as AuthContext | undefined;
    if (!auth) throw AppError.unauthorized("Authentication required");
    return auth.profile_id;
};

export const NotificationController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListNotificationsQuery>(c, "query");
            const { notifications, meta } = await NotificationService.list(me(c), query);
            return sendList(c, notifications, meta, "Notifications fetched successfully");
        });
    },

    async unreadCount(c: Context) {
        return withHandler(c, async () => {
            const count = await NotificationService.unreadCount(me(c));
            return sendSuccess(c, { count }, "Unread count fetched successfully");
        });
    },

    async markRead(c: Context) {
        return withHandler(c, async () => {
            const n = await NotificationService.markRead(c.req.param("id") ?? "", me(c));
            return sendSuccess(c, n, "Notification marked read");
        });
    },

    async markAllRead(c: Context) {
        return withHandler(c, async () => {
            const result = await NotificationService.markAllRead(me(c));
            return sendSuccess(c, result, "All notifications marked read");
        });
    },
};
