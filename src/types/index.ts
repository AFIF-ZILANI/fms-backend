import type {
    BirdBreed,
    ContactMethod,
    EmployeeRole,
    // ResourceCategory,
    SupplierRole,
    SupplierSupplyCategory,
    // Unit,
} from "./enum.type";
import { ResourceCategory, Unit } from "@prisma/client";

interface User {
    id?: string;
    name: string;
    email?: string;
    photo?: {
        public_id: string;
        image_url: string;
    };
    mobile: string;
    address?: string;
    rating?: number;
    online_contact: ContactMethod[];
}

export interface IAdmin {
    id?: string;
    name: string;
    email: string;
    photo?: {
        public_id: string;
        image_url: string;
    };
    mobile: string;
}

export interface IEmployee extends User {
    salary: number;
    joined_date: Date;
    role: EmployeeRole;
}

export interface ISupplier extends User {
    company: string;
    role: SupplierRole;
    type: SupplierSupplyCategory;
}

export interface ICustomer extends User {
    company: string;
    is_registered: boolean;
}

export interface IDoctor extends User {
    specality?: string;
    position?: string;
    degree: string[];
}

export interface IBatch {
    id: string;
    batch_name: string;
    start_date: Date;
    expected_end_date: Date;
    breed: BirdBreed;
    received_quantity: number;
    supplier_id: string;
    house_no: 1 | 2;
}

export interface IAvatar {
    id: string;
    public_id: string;
    image_url: string;
    createdAt: Date;
}

export interface StockSummary {
    total_stock_value: number;
    total_items_in_stock: number;
    low_stock_alerts: number;
    total_purchases: number;
    total_sales: number;
    critical_items: number;
}
export interface IItem {
    id: string;
    name: string;
    description: string | null;
    category: ResourceCategory;
    unit_name: Unit;
    unit_price: number;
    stock_quantity: number;
    supplier: {
        id: string;
        name: string;
    } | null;
    reorder_level: number;
    is_consumable: boolean;
    created_at?: Date;
    updated_at?: Date;
}

export interface UrgentItem {
    id: string;
    name: string;
    category: ResourceCategory;
    unit_name: Unit;
    unit_price: number;
    stock_quantity: number;
    reorder_level: number;
    shortfall: number;
    suggested_order: number;
}
