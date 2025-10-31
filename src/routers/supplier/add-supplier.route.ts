import { AddSupplier } from "@/controllers/supplier/add-supplier.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router();

router.post("/add", asyncHandler(AddSupplier));

export default router;
