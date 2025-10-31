import { RemoveSuppliers } from "@/controllers/supplier/remove-supplier.controller";
import { asyncHandler } from "@/utils/asyncHandler";
import { Router } from "express";

const router = Router()

router.delete("/remove", asyncHandler(RemoveSuppliers))
export default router;