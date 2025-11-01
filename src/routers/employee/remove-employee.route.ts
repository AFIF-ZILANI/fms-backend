import { RemoveEmployee } from "@/controllers/employee/remove-employee.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.delete("/remove", asyncHandler(RemoveEmployee));

export default router;
