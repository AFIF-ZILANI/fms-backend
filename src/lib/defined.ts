/**
 * Drops keys whose value is `undefined`.
 *
 * Prisma treats an explicit `undefined` the same as an absent key, but under
 * `exactOptionalPropertyTypes` TypeScript refuses to pass one, so a payload
 * spread straight from a Zod schema with optional fields won't type-check.
 */
export function defined<T extends object>(obj: T) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
        [K in keyof T]: Exclude<T[K], undefined>;
    };
}
