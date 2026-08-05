import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { ExpenseController } from "@controllers/expense.controller";
import { createExpenseSchema, listExpensesQuerySchema } from "@validators/expense.validator";

export const expenseRoutes = new Hono();

expenseRoutes.get(
    "/",
    zValidatorRfc7807("query", listExpensesQuerySchema),
    ExpenseController.getAll,
);
expenseRoutes.get("/:id", ExpenseController.getById);
expenseRoutes.post("/", zValidatorRfc7807("json", createExpenseSchema), ExpenseController.create);
