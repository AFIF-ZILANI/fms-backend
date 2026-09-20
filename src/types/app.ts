import type { Env } from "hono";

export type DeviceContext = { device_id: string; profile_id: string };

/** `device` is set by the requireDevice middleware on ingest routes -- the
 * identity a phone proved, which is where recorded_by_id comes from. */
export type AppEnv = Env & {
    Variables: {
        device?: DeviceContext;
    };
};
