import { Hono } from "hono";
import { UploadController } from "@controllers/upload.controller";

export const uploadRoutes = new Hono();

uploadRoutes.get("/signature", UploadController.signature);
