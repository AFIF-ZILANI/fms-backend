export enum EmployeeRole {
    WORKER = "WORKER",
    MANAGER = "MANAGER",
    INTERN = "INTERN",
}
export enum ContactMethod {
    WHATSAPP = "WHATSAPP",
    EMAIL = "EMAIL",
    IMO = "IMO",
    TELEGRAM = "TELEGRAM",
}

export enum SupplierRole {
    SALES_MAN = "SALES_MAN",
    OWNER = "OWNER",
    DISTRIBUTOR = "DISTRIBUTOR",
    DEALER = "DEALER",
    WHOLESALER = "WHOLESALER",
    RETAILER = "RETAILER",
    MANUFACTURER = "MANUFACTURER",
    IMPORTER = "IMPORTER",
    REPRESENTATIVE = "REPRESENTATIVE",
}

export enum BirdBreed {
    CLASSIC = "CLASSIC",
    HIBREED = "HIBREED",
    PAKISTHANI = "PAKISTHANI",
    KEDERNATH = "KEDERNATH",
    FAOMI = "FAOMI",
    TIGER = "TIGER",
}

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
    role:
        | "SALES_MAN"
        | "OWNER"
        | "DISTRIBUTOR"
        | "DEALER"
        | "WHOLESALER"
        | "RETAILER"
        | "MANUFACTURER"
        | "IMPORTER"
        | "REPRESENTATIVE";
    type:
        | "MEDICINE"
        | "FEED"
        | "HUSK"
        | "HARDWARE"
        | "MEDICAL_EQUIPMENT"
        | "LAB_EQUIPMENT"
        | "OFFICE_SUPPLIES"
        | "CLEANING_SUPPLIES"
        | "IT_HARDWARE"
        | "SOFTWARE"
        | "IT_EQUEPMENT"
        | "INTERNET"
        | "ELECTRICAL_EQUIPMENT"
        | "OTHER";
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
