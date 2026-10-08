import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
    status: z.enum(["all", "unread"]).default("all"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
