import { z } from "zod";

/** Units enum, shared across Item/Purchase/Sale validators. */
export const unitSchema = z.enum([
    "BIRD",
    "KG",
    "LITER",
    "BAG",
    "BOX",
    "UNIT",
    "SACHETS",
    "BOTTLE",
    "ML",
    "L",
    "G",
    "PCS",
    "VIAL",
    "DOSE",
    "OTHER",
]);

/** Item category enum, shared across Item/StockUnit validators. */
export const resourceCategorySchema = z.enum([
    "FEED",
    "MEDICINE",
    "VACCINE",
    "SUPPLEMENT",
    "BIOSECURITY",
    "CHICKS",
    "HUSK",
    "EQUIPMENT",
    "UTILITIES",
    "SALARY",
    "TRANSPORTATION",
    "MAINTENANCE",
    "CLEANING_SUPPLIES",
    "OTHER",
]);
