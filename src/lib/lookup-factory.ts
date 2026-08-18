import type { Context } from "hono";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { generateCode } from "@lib/code-gen";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import type { CreateLookupInput, UpdateLookupInput, ListLookupQuery } from "@validators/lookup.validator";

type LookupRow = {
    id: string;
    code: string;
    label: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
};

/**
 * Minimal shape every lookup delegate (ItemCategory, Unit,
 * ExpenseCategoryLookup, SupplierSupplyCategory) satisfies -- all four
 * models are structurally identical, so `prisma.itemCategory` etc. match
 * this without a cast. If a future Prisma version's generated delegate
 * type stops structurally matching at a call site, wrap that one
 * instantiation with `as unknown as LookupDelegate` rather than loosening
 * this type for every caller.
 */
type LookupDelegate = {
    findMany(args: {
        where?: { is_active?: boolean };
        orderBy?: { label: "asc" };
        skip?: number;
        take?: number;
    }): Promise<LookupRow[]>;
    count(args: { where?: { is_active?: boolean } }): Promise<number>;
    findUnique(args: { where: { id: string } }): Promise<LookupRow | null>;
    create(args: { data: { code: string; label: string } }): Promise<LookupRow>;
    update(args: {
        where: { id: string };
        data: { code?: string; label?: string; is_active?: boolean };
    }): Promise<LookupRow>;
};

export function createLookupService(delegate: LookupDelegate, resourceName: string) {
    return {
        async getAll(query: ListLookupQuery) {
            const where = query.active !== undefined ? { is_active: query.active === "true" } : {};
            const [rows, total] = await Promise.all([
                delegate.findMany({ where, orderBy: { label: "asc" }, ...toSkipTake(query) }),
                delegate.count({ where }),
            ]);
            return { rows, meta: buildMeta(total, query) };
        },

        async create(label: string) {
            const code = generateCode(label);
            if (!code) throw AppError.badRequest("Label must contain at least one letter or number");
            try {
                return await delegate.create({ data: { code, label } });
            } catch (err) {
                return handlePrismaWriteError(err);
            }
        },

        async update(id: string, label: string) {
            const existing = await delegate.findUnique({ where: { id } });
            if (!existing) throw AppError.notFound(resourceName);
            const code = generateCode(label);
            if (!code) throw AppError.badRequest("Label must contain at least one letter or number");
            try {
                return await delegate.update({ where: { id }, data: { code, label } });
            } catch (err) {
                return handlePrismaWriteError(err);
            }
        },

        async setActive(id: string, is_active: boolean) {
            const existing = await delegate.findUnique({ where: { id } });
            if (!existing) throw AppError.notFound(resourceName);
            return delegate.update({ where: { id }, data: { is_active } });
        },
    };
}

type LookupService = ReturnType<typeof createLookupService>;

export function createLookupController(service: LookupService) {
    return {
        async getAll(c: Context) {
            return withHandler(c, async () => {
                const query = getValid<ListLookupQuery>(c, "query");
                const { rows, meta } = await service.getAll(query);
                return sendList(c, rows, meta, "Fetched successfully");
            });
        },

        async create(c: Context) {
            return withHandler(c, async () => {
                const body = getValid<CreateLookupInput>(c, "json");
                const row = await service.create(body.label);
                return sendSuccess(c, row, "Created", 201);
            });
        },

        async update(c: Context) {
            return withHandler(c, async () => {
                const body = getValid<UpdateLookupInput>(c, "json");
                const row = await service.update(c.req.param("id") ?? "", body.label);
                return sendSuccess(c, row, "Updated");
            });
        },

        async deactivate(c: Context) {
            return withHandler(c, async () => {
                const row = await service.setActive(c.req.param("id") ?? "", false);
                return sendSuccess(c, row, "Deactivated");
            });
        },

        async reactivate(c: Context) {
            return withHandler(c, async () => {
                const row = await service.setActive(c.req.param("id") ?? "", true);
                return sendSuccess(c, row, "Reactivated");
            });
        },
    };
}
