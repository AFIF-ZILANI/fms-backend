import type { Application, Request, Response, NextFunction } from "express";
import express from "express";
import cors from "cors";
// import morgan from "morgan";
import { AppError } from "@/utils/error";

// Import your routes
import AddAdminRouter from "./routers/admin/add-admin.route";
import addEmployeeRouter from "./routers/employee/add-employee.route";
import addSupplierRouter from "./routers/supplier/add-supplier.route";
import { ENV } from "./config/env";
import { asyncHandler } from "./utils/asyncHandler";
import { findSupplier } from "./controllers/supplier/search-supplier.controller";
import { findTableData } from "./controllers/get-table-data.controller";
import AddBatchRouter from "./routers/batch/add-batch.route";
import RemoveSuppliersRouter from "./routers/supplier/remove-suppliers.route";
import RemoveTemtAvatarRouter from "./routers/remove-avatar.route";
import AddEmployeeRouter from "./routers/employee/add-employee.route";
import RemoveBatchRouter from "./routers/batch/remove-batch.route";
import RemoveEmployeeRouter from "./routers/employee/remove-employee.route";
import helmet from "helmet";

// Initialize Express app
const app: Application = express();

// Base API path
const BASE_API_PATH = `/api/${ENV.API_VERSION}`;

// Global middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
// app.use(morgan("dev"));

// Health check
app.get("/health", (_req: Request, res: Response) => {
    res.json({ success: true, message: "Server is healthy" });
});

// Mount routes

//admin routes
app.use(`${BASE_API_PATH}/admin`, AddAdminRouter);

//employee routes
app.use(`${BASE_API_PATH}/employee`, addEmployeeRouter);

// supplier routes
app.use(`${BASE_API_PATH}/supplier`, addSupplierRouter);
app.get(`${BASE_API_PATH}/suppliers`, asyncHandler(findSupplier));
app.use(`${BASE_API_PATH}/suppliers`, RemoveSuppliersRouter);

// batch routes
app.use(`${BASE_API_PATH}/batches`, AddBatchRouter);
app.use(`${BASE_API_PATH}/batches`, RemoveBatchRouter);

// employee routes
app.use(`${BASE_API_PATH}/employee`, AddEmployeeRouter);
app.use(`${BASE_API_PATH}/employee`, RemoveEmployeeRouter);

//other routes
app.get(`${BASE_API_PATH}/get-table-data`, asyncHandler(findTableData));
app.use(`${BASE_API_PATH}/avatar`, RemoveTemtAvatarRouter);

// Error handler
// Error handler (after routes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: err.message,
            data: err.data,
        });
    }

    // fallback
    console.error(err);
    return res.status(500).json({
        success: false,
        error: "Internal Server Error",
    });
});

export default app;
