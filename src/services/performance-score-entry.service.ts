import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { FIXED_CRITERION_POINTS, type FixedCriterion } from "@lib/performance-criteria";
import type {
    CreateScoreEntryInput,
    ListScoreEntriesQuery,
    VoidScoreEntryInput,
} from "@validators/performance-score-entry.validator";

/** Points at or below this need written notice to the employee first. */
const NOTICE_REQUIRED_AT = -4;
/** Ceiling on the OTHER escape hatch, per employee per month, summed absolute. */
const OTHER_MONTHLY_CAP = 5;

const monthBounds = (date: Date) => ({
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
});

export const PerformanceScoreEntryService = {
    async getAll(query: ListScoreEntriesQuery) {
        const dateRange = {
            ...(query.date_from !== undefined && { gte: query.date_from }),
            ...(query.date_to !== undefined && { lte: query.date_to }),
        };
        const where = {
            ...(query.employee_id !== undefined && { employee_id: query.employee_id }),
            ...(query.status !== undefined && { status: query.status }),
            ...(Object.keys(dateRange).length > 0 && { incident_date: dateRange }),
        };
        const [entries, total] = await Promise.all([
            prisma.performanceScoreEntry.findMany({
                where,
                // The field app's score history names who gave each entry. Joining
                // client-side isn't an option: given_by_id is any Profile, so an
                // Admin scoring a Manager would resolve to no name at all.
                include: {
                    given_by: { select: { id: true, name: true, role: true } },
                    approved_by: { select: { id: true, name: true } },
                },
                orderBy: { incident_date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.performanceScoreEntry.count({ where }),
        ]);
        return { entries, meta: buildMeta(total, query) };
    },

    /**
     * Snapshots the criterion's fixed point value at entry time -- the client
     * only controls the point count for the OTHER escape hatch (the validator
     * bounds it to ±1-5).
     *
     * The four rules docs/employee-payroll-design.md marks "enforced in app
     * logic now" are checked here rather than in the validator, because each
     * needs to read something the payload doesn't carry.
     */
    async create(data: CreateScoreEntryInput) {
        const employee = await prisma.employees.findUnique({
            where: { id: data.employee_id },
            select: { id: true, profile_id: true },
        });
        if (!employee) throw AppError.notFound("Employee");

        // 1. Nobody scores themselves. One comparison, and the single abuse the
        //    model can't survive -- so it lands ahead of the wider role work.
        if (employee.profile_id === data.given_by_id) {
            throw AppError.badRequest("An employee cannot score themselves");
        }

        const points =
            data.criterion === "OTHER"
                ? (data.points as number)
                : FIXED_CRITERION_POINTS[data.criterion as FixedCriterion];

        // 2. Written notice before anything at -4 or worse.
        if (points <= NOTICE_REQUIRED_AT && !data.notice_doc_url) {
            throw AppError.badRequest(
                `An entry of ${points} requires written notice to the employee first`,
            );
        }

        const { start, end } = monthBounds(data.incident_date);

        // 3. A generated payroll locks its month -- pay already calculated can't
        //    be re-based after the fact.
        const locked = await prisma.payrollRecord.findUnique({
            where: { employee_id_month: { employee_id: data.employee_id, month: start } },
        });
        if (locked) {
            throw AppError.badRequest(
                "Payroll for that month is already generated; the month is locked",
            );
        }

        // 4. OTHER is capped at ±5 per employee per month, summed absolute, so the
        //    escape hatch can't quietly become the main route.
        if (data.criterion === "OTHER") {
            const existing = await prisma.performanceScoreEntry.findMany({
                where: {
                    employee_id: data.employee_id,
                    criterion: "OTHER",
                    status: { not: "VOIDED" },
                    incident_date: { gte: start, lt: end },
                },
                select: { points: true },
            });
            const used = existing.reduce((sum, e) => sum + Math.abs(e.points), 0);
            if (used + Math.abs(points) > OTHER_MONTHLY_CAP) {
                throw AppError.badRequest(
                    `OTHER entries are capped at ±${OTHER_MONTHLY_CAP} per month; ${used} already used`,
                );
            }
        }

        // Approval is an admin's act. Until it is stamped from the session, at least refuse a
        // profile that isn't one.
        if (data.approved_by_id !== undefined) {
            const approver = await prisma.admins.findUnique({
                where: { profile_id: data.approved_by_id },
            });
            if (!approver) throw AppError.badRequest("approved_by_id must be an admin");
        }

        try {
            return await prisma.performanceScoreEntry.create({
                data: {
                    employee_id: data.employee_id,
                    given_by_id: data.given_by_id,
                    criterion: data.criterion,
                    points,
                    reason: data.reason,
                    incident_date: data.incident_date,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                    ...(data.approved_by_id !== undefined && {
                        approved_by_id: data.approved_by_id,
                    }),
                    ...(data.notice_doc_url !== undefined && {
                        notice_doc_url: data.notice_doc_url,
                    }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Entries are never deleted. A wrong one is voided, with the reason kept,
     *  leaving both the entry and the correction on record. */
    async void(id: string, data: VoidScoreEntryInput) {
        const entry = await prisma.performanceScoreEntry.findUnique({ where: { id } });
        if (!entry) throw AppError.notFound("Score entry");
        if (entry.status === "VOIDED") throw AppError.badRequest("Entry is already voided");

        const { start } = monthBounds(entry.incident_date);
        const locked = await prisma.payrollRecord.findUnique({
            where: { employee_id_month: { employee_id: entry.employee_id, month: start } },
        });
        if (locked) {
            throw AppError.badRequest(
                "Payroll for that month is already generated; the month is locked",
            );
        }

        return prisma.performanceScoreEntry.update({
            where: { id },
            data: { status: "VOIDED", void_reason: data.void_reason },
        });
    },

    /** The employee disputes an entry. The Owner resolves it in writing --
     *  tracked as a status here; the 7-day window isn't automated yet. */
    async dispute(id: string) {
        const entry = await prisma.performanceScoreEntry.findUnique({ where: { id } });
        if (!entry) throw AppError.notFound("Score entry");
        if (entry.status !== "ACTIVE") {
            throw AppError.badRequest("Only an active entry can be disputed");
        }
        return prisma.performanceScoreEntry.update({
            where: { id },
            data: { status: "DISPUTED" },
        });
    },

    /** The employee confirms they were shown the entry -- what starts the
     *  7-day dispute clock. */
    async acknowledge(id: string) {
        const entry = await prisma.performanceScoreEntry.findUnique({ where: { id } });
        if (!entry) throw AppError.notFound("Score entry");
        return prisma.performanceScoreEntry.update({
            where: { id },
            data: { acknowledged_at: new Date() },
        });
    },
};
