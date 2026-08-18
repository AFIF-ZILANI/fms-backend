import { z } from "zod";

/** Item category / unit are now database-backed lookup tables (ItemCategory,
 * Unit) rather than fixed enums -- any non-empty string is syntactically
 * valid here; an unknown code is caught by the database FK constraint via
 * handlePrismaWriteError, not by Zod. See lookup-factory.ts. */
export const unitSchema = z.string().min(1, "Unit is required");
export const resourceCategorySchema = z.string().min(1, "Category is required");
