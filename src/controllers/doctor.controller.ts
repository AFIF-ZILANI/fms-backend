import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { DoctorService } from "@services/doctor.service";
import type { CreateDoctorInput, ListDoctorsQuery } from "@validators/doctor.validator";

export const DoctorController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListDoctorsQuery>(c, "query");
            const { doctors, meta } = await DoctorService.getAll(query);
            return sendList(c, doctors, meta, "Doctors fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const doctor = await DoctorService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, doctor, "Doctor fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const body = getValid<CreateDoctorInput>(c, "json");
            const doctor = await DoctorService.create(body);
            return sendSuccess(c, doctor, "Doctor created", 201);
        });
    },
};
