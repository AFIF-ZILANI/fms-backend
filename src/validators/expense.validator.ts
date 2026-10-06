import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const expenseCategory = z.string().min(1, "Category is required");

const costType = z.enum(["DIRECT", "SHARED_PERIOD", "SHARED_CAPITAL"]);

export const createExpenseSchema = z
    .object({
        batch_id: z.string().uuid().optional(),
        category: expenseCategory,
        cost_type: costType,
        amount: z.coerce.number().positive("Amount must be positive"),
        date: z.coerce.date(),
        remarks: z.string().optional(),
    })
    // A DIRECT cost is one attributed to a batch; without one it belongs in a shared bucket. The
    // database has a CHECK for this too (Expense_direct_has_batch).
    .refine((d) => d.cost_type !== "DIRECT" || d.batch_id !== undefined, {
        message: "A DIRECT cost needs a batch",
        path: ["batch_id"],
    });

export const listExpensesQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    category: expenseCategory.optional(),
    cost_type: costType.optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema> & { recorded_by_id: string };
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
