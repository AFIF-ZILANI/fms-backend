import type { Env } from "hono";

export type DeviceContext = { device_id: string; profile_id: string };

/** The logged-in person, set by the authenticate middleware. `employee_role`
 * is the Employees.role code (WORKER, MANAGER, ...) -- null for admins. */
export type AuthContext = {
    profile_id: string;
    role: "ADMIN" | "EMPLOYEE" | "CUSTOMER" | "SUPPLIER" | "DOCTOR";
    employee_role: string | null;
};

/** `device` is set by the requireDevice middleware on ingest routes -- the
 * identity a phone proved. `auth` is set by authenticate on everything else. */
export type AppEnv = Env & {
    Variables: {
        device?: DeviceContext;
        auth?: AuthContext;
    };
};
