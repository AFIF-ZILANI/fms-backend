import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { NotificationDraft } from "@lib/notification-messages";
import type { ListNotificationsQuery } from "@validators/notification.validator";

export const NotificationService = {
    /**
     * Tells one person something happened. Best effort by design: it is called after the real work has
     * succeeded (a task assigned, a payslip generated), and a notification that fails to save must never
     * undo or fail that work -- so it logs and moves on, and never throws.
     */
    async notify(profileId: string, draft: NotificationDraft): Promise<void> {
        try {
            await prisma.notifications.create({
                data: {
                    profile_id: profileId,
                    kind: draft.kind,
                    title: draft.title,
                    ...(draft.body !== undefined && { body: draft.body }),
                    ...(draft.related_id !== undefined && { related_id: draft.related_id }),
                },
            });
        } catch (err) {
            console.error("[notifications] could not save", draft.kind, err);
        }
    },

    /** Same, addressed by employee. `exceptProfileId` skips the person who did the thing themselves. */
    async notifyEmployee(
        employeeId: string,
        draft: NotificationDraft,
        exceptProfileId?: string,
    ): Promise<void> {
        try {
            const employee = await prisma.employees.findUnique({
                where: { id: employeeId },
                select: { profile_id: true },
            });
            if (!employee || employee.profile_id === exceptProfileId) return;
            await this.notify(employee.profile_id, draft);
        } catch (err) {
            console.error("[notifications] could not address", draft.kind, err);
        }
    },

    /** The caller's own notifications, newest first. */
    async list(profileId: string, query: ListNotificationsQuery) {
        const where = {
            profile_id: profileId,
            ...(query.status === "unread" && { read_at: null }),
        };
        const [notifications, total] = await Promise.all([
            prisma.notifications.findMany({
                where,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.notifications.count({ where }),
        ]);
        return { notifications, meta: buildMeta(total, query) };
    },

    async unreadCount(profileId: string) {
        return prisma.notifications.count({ where: { profile_id: profileId, read_at: null } });
    },

    /** Someone else's notification is a 404, not a 403: it should not even be known to exist. */
    async markRead(id: string, profileId: string) {
        const found = await prisma.notifications.findFirst({
            where: { id, profile_id: profileId },
        });
        if (!found) throw AppError.notFound("Notification");
        if (found.read_at) return found;
        return prisma.notifications.update({ where: { id }, data: { read_at: new Date() } });
    },

    async markAllRead(profileId: string) {
        const { count } = await prisma.notifications.updateMany({
            where: { profile_id: profileId, read_at: null },
            data: { read_at: new Date() },
        });
        return { updated: count };
    },
};
