import type { Prisma } from "../../prisma/generated/prisma/client";
import prisma from "@lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
    table: string;
    record_id: string;
    action: "CREATE" | "UPDATE" | "DELETE";
    actor_id: string;
    /** What happened, in words -- the action enum is only create/update/delete. */
    note: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
};

/**
 * One row in the permanent record of who did a sensitive thing. Never put a
 * secret in `before`/`after`: no passwords (temporary or otherwise), no tokens,
 * no full account numbers -- log the last four digits instead.
 *
 * Pass the caller's `tx` so the record commits or rolls back with the change.
 */
export function audit(db: Db, e: AuditEntry) {
    return db.auditLog.create({
        data: {
            table_name: e.table,
            record_id: e.record_id,
            action: e.action,
            changed_by_id: e.actor_id,
            note: e.note,
            ...(e.before !== undefined && { before_data: e.before }),
            ...(e.after !== undefined && { after_data: e.after }),
        },
    });
}

export const last4 = (n: string) => n.slice(-4);
