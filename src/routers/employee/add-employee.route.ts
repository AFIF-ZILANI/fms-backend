import { AddEmployee } from "@/controllers/employee/add-employee.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.post("/add", asyncHandler(AddEmployee));

export default router;
