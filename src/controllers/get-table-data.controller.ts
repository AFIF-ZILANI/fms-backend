import type { Request, Response } from "express";
import { prisma } from "@/utils/db";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";
import type { IItem, StockSummary, UrgentItem } from "@/types";

export async function findTableData(req: Request, res: Response) {
    const category = req.query.category?.toString().trim() || "";
    const skipValue = req.query.skip?.toString().trim() || "";
    const skip = Number.parseInt(skipValue) || 0;
    const item = req.query.item?.toString().trim() || "";

    console.log("Category:", category);
    console.log("CASE: ", category.toUpperCase());
    console.log("Skip Value: ", skip);
    console.log("Items: ", item);

    let data: any[] = [];

    switch (category.toUpperCase()) {
        case "SUPPLIER":
            data = await prisma.supplier.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    mobile: true,
                    company: true,
                    rating: true,
                    role: true,
                    type: true,
                    online_contact: true,
                    address: true,
                    avatar: {
                        select: {
                            image_url: true,
                            public_id: true,
                        },
                    },
                },
                take: 20,
                skip,
                orderBy: {
                    name: "asc",
                },
            });
            break;

        case "DOCTOR":
            // Add doctor logic here
            break;

        case "EMPLOYEE":
            data = await prisma.employee.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    mobile: true,
                    rating: true,
                    role: true,
                    salary: true,
                    online_contact: true,
                    address: true,
                    avatar: {
                        select: {
                            image_url: true,
                            public_id: true,
                        },
                    },
                },
                take: 20,
                skip,
                orderBy: {
                    name: "asc",
                },
            });
            break;

        case "ADMIN":
            // Add admin logic here
            break;

        case "BATCH":
            data = await prisma.batch.findMany({
                select: {
                    id: true,
                    batch_id: true,
                    farm_code: true,
                    sector_code: true,
                    product_code: true,
                    breed: true,
                    start_date: true,
                    expected_end_date: true,
                    supplier: {
                        select: {
                            name: true,
                            id: true,
                        },
                    },
                    is_from_registerd_supplier: true,
                    house_no: true,
                    received_quantity: true,
                },
            });
            break;
        case "INVENTORY":
            console.log("[Hello]");
            const stocks: IItem[] = await prisma.item.findMany({
                select: {
                    id: true,
                    name: true,
                    category: true,
                    unit_name: true,
                    description: true,
                    stock_quantity: true,
                    reorder_level: true,
                    unit_price: true,
                    is_consumable: true,
                    created_at: true,
                    updated_at: true,
                    supplier: {
                        select: {
                            name: true,
                            id: true,
                        },
                    },
                },
            });

            if (!stocks || stocks.length === 0) {
                throwError({
                    message: "No inventory data found",
                    statusCode: 404,
                });
            }

            if (item === "detail-stock-ledger") {
                data = stocks;
            } else if (item === "urgent-reorder-list") {
                const urgentItems: UrgentItem[] = stocks
                    .filter((i) => i.stock_quantity <= i.reorder_level)
                    .map((i) => {
                        const shortfall = Math.max(
                            i.reorder_level - i.stock_quantity,
                            0
                        );
                        const buffer = Math.ceil(i.reorder_level * 0.2); // 20% safety margin
                        const suggested_order = shortfall + buffer;

                        return {
                            id: i.id,
                            name: i.name,
                            category: i.category,
                            stock_quantity: i.stock_quantity,
                            unit_name: i.unit_name,
                            reorder_level: i.reorder_level,
                            supplier: i.supplier
                                ? { id: i.supplier.id, name: i.supplier.name }
                                : undefined,
                            unit_price: i.unit_price,
                            shortfall,
                            suggested_order,
                        };
                    });

                data = urgentItems;
            } else if (item === "stock-summary") {
                const summary: StockSummary = {
                    total_stock_value: stocks.reduce(
                        (sum, i) => sum + i.stock_quantity * i.unit_price,
                        0
                    ),
                    total_items_in_stock: stocks.filter(
                        (i) => i.stock_quantity > 0
                    ).length,
                    low_stock_alerts: stocks.filter(
                        (i) => i.stock_quantity <= i.reorder_level
                    ).length,
                    critical_items: stocks.filter(
                        (i) => i.stock_quantity <= i.reorder_level / 2
                    ).length,
                    total_purchases: 0, // replace with actual purchase sum later
                    total_sales: 0, // replace with actual sales sum later
                };

                data = [summary];
            } else {
                throwError({
                    message: "Invalid item type for inventory category",
                    statusCode: 400,
                });
            }
            console.log("[Data]", data);
            break;
        case "PHERMASIST":
            // probably "PHARMACIST"
            // Add pharmacist logic here
            break;

        default:
            throwError({
                message: "Invalid category type",
                statusCode: 400,
            });
    }

    if (!data || data.length === 0) {
        throwError({
            message: "No data found",
            statusCode: 404,
            data: { is_found: false },
        });
    }

    console.log(data);

    return sendSuccessResponse({
        response: res,
        data: data,
        message: `Found ${category.toLowerCase()} list`,
    });
}
