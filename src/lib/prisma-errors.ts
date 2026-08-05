import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "./app-error";

/**
 * Converts a Prisma unique-constraint violation (P2002) into an RFC 7807
 * conflict. Rethrows anything else unchanged. Call from a service's catch
 * block instead of pre-checking uniqueness — pre-checking races two
 * concurrent creates; the DB constraint is the actual source of truth.
 */
export const handleUniqueConstraint = (err: unknown): never => {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict(`${conflictingFields(err.meta).join(", ")} already in use`);
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
