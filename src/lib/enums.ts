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
