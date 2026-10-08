import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { NotificationController } from "@controllers/notification.controller";
import { listNotificationsQuerySchema } from "@validators/notification.validator";

export const notificationRoutes = new Hono();

notificationRoutes.get(
    "/",
    zValidatorRfc7807("query", listNotificationsQuerySchema),
    NotificationController.getAll,
);
notificationRoutes.get("/unread-count", NotificationController.unreadCount);
notificationRoutes.post("/read-all", NotificationController.markAllRead);
notificationRoutes.post("/:id/read", NotificationController.markRead);
