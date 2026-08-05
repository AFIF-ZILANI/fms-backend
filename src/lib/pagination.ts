import { z } from "zod";
import type { Meta } from "./response";

export const paginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const toSkipTake = ({ page, limit }: PaginationQuery) => ({
    skip: (page - 1) * limit,
    take: limit,
});

export const buildMeta = (total: number, { page, limit }: PaginationQuery): Meta => ({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
});
