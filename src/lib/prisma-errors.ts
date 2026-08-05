import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "./app-error";

/**
 * Converts known Prisma write failures into RFC 7807 responses instead of
 * leaking a raw 500:
 *  - P2002 (unique constraint) -> 409 conflict
 *  - P2003 (foreign key constraint) -> 400 bad request, the referenced id
 *    doesn't exist (e.g. a client-supplied purchase_item_id/stock_unit_id)
 * Rethrows anything else unchanged. Call from a service's catch block
 * instead of pre-checking existence/uniqueness -- pre-checking races
 * concurrent writes; the DB constraint is the actual source of truth.
 */
export const handlePrismaWriteError = (err: unknown): never => {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
            throw AppError.conflict(`${conflictingFields(err.meta).join(", ")} already in use`);
        }
        if (err.code === "P2003") {
            throw AppError.badRequest(
                `${foreignKeyField(err.meta)} does not reference an existing record`,
            );
        }
    }
    throw err;
};

/**
 * P2002's field list moves depending on how the query ran: the classic
 * engine puts it at `meta.target`, but `@prisma/adapter-pg` nests it at
 * `meta.driverAdapterError.cause.constraint.fields` instead. Check both.
 */
const conflictingFields = (meta: Record<string, unknown> | undefined): string[] => {
    if (Array.isArray(meta?.["target"])) return meta["target"] as string[];
    const driverFields = (
        meta?.["driverAdapterError"] as
            | { cause?: { constraint?: { fields?: string[] } } }
            | undefined
    )?.cause?.constraint?.fields;
    return driverFields ?? ["field"];
};

/**
 * Same driver-adapter nesting as P2002, different constraint shape: the
 * classic engine's `meta.field_name` and the adapter's
 * `meta.driverAdapterError.cause.constraint.index` both hold a Postgres FK
 * constraint name like "StockUnit_purchase_item_id_fkey" -- strip Prisma's
 * own `{Table}_{field}_fkey` naming convention down to just the field.
 */
const foreignKeyField = (meta: Record<string, unknown> | undefined): string => {
    const driverIndex = (
        meta?.["driverAdapterError"] as { cause?: { constraint?: { index?: string } } } | undefined
    )?.cause?.constraint?.index;
    const constraintName =
        (typeof meta?.["field_name"] === "string" ? meta["field_name"] : undefined) ?? driverIndex;
    if (!constraintName) return "referenced field";
    const match = /_([a-z_]+)_fkey/.exec(constraintName);
    return match?.[1] ?? constraintName;
};
