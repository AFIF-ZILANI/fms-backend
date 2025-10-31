import { Router } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { addAdmin } from "@/controllers/admin/add-admin.controller";

const router = Router();

router.post("/add", asyncHandler(addAdmin));

export default router;
