import { z } from "zod";

/** Item category / unit are now database-backed lookup tables (ItemCategory,
 * Unit) rather than fixed enums -- any non-empty string is syntactically
 * valid here; an unknown code is caught by the database FK constraint via
 * handlePrismaWriteError, not by Zod. See lookup-factory.ts. */
export const unitSchema = z.string().min(1, "Unit is required");
export const resourceCategorySchema = z.string().min(1, "Category is required");

/** Item.unit is restricted to the 6 canonical base units -- every other unit code converts to
 * one of these via Unit.base_unit/fixed_factor, so an item's own base unit can never itself be
 * a "derived" unit. */
export const ITEM_BASE_UNITS = ["ML", "G", "UNIT", "DOSE", "PCS", "METER"] as const;
export const itemBaseUnitSchema = z.enum(ITEM_BASE_UNITS);

/** Units valid as an ItemUnit conversion under ANY base-unit family, not just one (Container can
 * package a liquid or a solid). An allowlist rather than "base_unit is null" -- a handful of Unit
 * rows (e.g. BIRD) have no base_unit for unrelated legacy reasons and must NOT be treated as generic. */
export const GENERIC_ITEM_UNITS = new Set(["CONTAINER"]);
