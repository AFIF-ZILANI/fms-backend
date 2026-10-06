import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { audit } from "@lib/audit";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { referenceSalaryFor } from "@lib/payroll-math";
import { completedMonths, proposeBonus } from "@lib/bonus-math";
import type {
    CreateBonusEventInput,
    GrantBonusesInput,
    ListBonusEventsQuery,
} from "@validators/bonus-event.validator";

const employeeFacts = {
    id: true,
    role: true,
    employment_status: true,
    religion: true,
    joining_date: true,
    reference_salary: true,
    roleRef: { select: { reference_salary: true } },
    profile: { select: { name: true } },
} as const;

async function loadEvent(id: string) {
    const event = await prisma.bonusEvent.findUnique({ where: { id } });
    if (!event) throw AppError.notFound("Bonus event");
    return event;
}

export const BonusEventService = {
    async getAll(query: ListBonusEventsQuery) {
        const [events, total] = await Promise.all([
            prisma.bonusEvent.findMany({
                include: { _count: { select: { bonuses: true } } },
                orderBy: { event_date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.bonusEvent.count(),
        ]);
        return { events, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const event = await prisma.bonusEvent.findUnique({
            where: { id },
            include: {
                bonuses: {
                    include: {
                        employee: { select: { id: true, profile: { select: { name: true } } } },
                        payout: { select: { id: true, status: true, paid_at: true } },
                    },
                    orderBy: { created_at: "asc" },
                },
            },
        });
        if (!event) throw AppError.notFound("Bonus event");
        return event;
    },

    /** Creates the event only. Nothing is proposed or granted until the owner asks. */
    async create(data: CreateBonusEventInput, actor_id: string) {
        try {
            return await prisma.$transaction(async (tx) => {
                const event = await tx.bonusEvent.create({
                    data: {
                        name: data.name,
                        event_date: data.event_date,
                        religion: data.religion ?? null,
                        multiplier: data.multiplier,
                        min_service_months: data.min_service_months,
                        prorate: data.prorate,
                        created_by_id: actor_id,
                    },
                });
                await audit(tx, {
                    table: "BonusEvent",
                    record_id: event.id,
                    action: "CREATE",
                    actor_id,
                    note: "Bonus event created",
                    after: { name: event.name, multiplier: event.multiplier.toString() },
                });
                return event;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * Pure computation, writes nothing: every non-terminated employee with what they would
     * get and whether they would be ticked. The owner decides; the system only proposes.
     */
    async proposal(id: string) {
        const event = await loadEvent(id);
        const [employees, granted] = await Promise.all([
            prisma.employees.findMany({
                where: { employment_status: { not: "TERMINATED" } },
                select: employeeFacts,
            }),
            prisma.bonus.findMany({ where: { event_id: id }, select: { employee_id: true, amount: true } }),
        ]);
        const grantedBy = new Map(granted.map((g) => [g.employee_id, g.amount]));

        const rows = employees.map((e) => {
            const r = referenceSalaryFor(e);
            const p = proposeBonus(
                event,
                {
                    employment_status: e.employment_status,
                    religion: e.religion,
                    joining_date: e.joining_date,
                    reference_salary: r,
                },
                event.event_date,
            );
            const already = grantedBy.get(e.id);
            return {
                employee_id: e.id,
                name: e.profile.name,
                role: e.role,
                employment_status: e.employment_status,
                // Sensitive: shown here (the proposal and the employee's own record), nowhere else.
                religion: e.religion,
                reference_salary: r,
                service_months: p.service_months,
                full_amount: p.full_amount,
                proposed_amount: already ?? p.proposed_amount,
                selected: already === undefined && p.selected,
                reason: already !== undefined ? "Already granted at this event" : p.reason,
                already_granted: already !== undefined,
            };
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        return { event, rows };
    },

    /**
     * Writes the Bonus rows the owner confirmed. Amounts are taken from the request (the owner
     * may adjust them); the reference salary and service months snapshotted beside each are
     * always computed here. One bonus per employee per event is a database rule.
     */
    async grant(id: string, data: GrantBonusesInput, actor_id: string) {
        const event = await loadEvent(id);
        const ids = data.bonuses.map((b) => b.employee_id);
        if (new Set(ids).size !== ids.length) {
            throw AppError.badRequest("An employee can only be listed once");
        }
        const employees = await prisma.employees.findMany({
            where: { id: { in: ids } },
            select: employeeFacts,
        });
        const byId = new Map(employees.map((e) => [e.id, e]));

        for (const b of data.bonuses) {
            const e = byId.get(b.employee_id);
            if (!e) throw AppError.notFound("Employee");
            if (e.employment_status === "TERMINATED") {
                throw AppError.badRequest(`${e.profile.name} is terminated and can't be granted a bonus`);
            }
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const created = [];
                for (const b of data.bonuses) {
                    const e = byId.get(b.employee_id)!;
                    const bonus = await tx.bonus.create({
                        data: {
                            event_id: event.id,
                            employee_id: e.id,
                            amount: new Prisma.Decimal(b.amount).toDecimalPlaces(0),
                            reference_salary: referenceSalaryFor(e),
                            service_months: completedMonths(e.joining_date, event.event_date),
                            ...(b.note !== undefined && { note: b.note }),
                        },
                    });
                    await audit(tx, {
                        table: "Bonus",
                        record_id: bonus.id,
                        action: "CREATE",
                        actor_id,
                        note: `Bonus granted at ${event.name}`,
                        after: { employee_id: e.id, amount: bonus.amount.toString() },
                    });
                    created.push(bonus);
                }
                return created;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
