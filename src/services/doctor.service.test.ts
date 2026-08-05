import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { DoctorService } from "./doctor.service";
import { AppError } from "@lib/app-error";

const mobile = () => `+880${Math.floor(1e9 + Math.random() * 8e9)}`;
const createdIds: string[] = [];

describe("DoctorService", () => {
    afterAll(async () => {
        await prisma.doctors.deleteMany({ where: { id: { in: createdIds } } });
        await prisma.profiles.deleteMany({
            where: { doctors: { id: { in: createdIds } } },
        });
    });

    test("create then getById round-trips", async () => {
        const doctor = await DoctorService.create({
            name: "Dr. Rahman",
            mobile: mobile(),
            specialty: "Poultry pathology",
            degrees: ["DVM"],
        });
        createdIds.push(doctor!.id);

        const found = await DoctorService.getById(doctor!.id);
        expect(found.profile.name).toBe("Dr. Rahman");
        expect(found.profile.role).toBe("DOCTOR");
        expect(found.specialty).toBe("Poultry pathology");
        expect(found.degrees).toEqual(["DVM"]);
    });

    test("duplicate mobile throws a conflict", async () => {
        const sharedMobile = mobile();
        const first = await DoctorService.create({ name: "First", mobile: sharedMobile });
        createdIds.push(first!.id);

        await expect(
            DoctorService.create({ name: "Second", mobile: sharedMobile }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            DoctorService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("listing includes created doctor", async () => {
        const doctor = await DoctorService.create({ name: "Listed", mobile: mobile() });
        createdIds.push(doctor!.id);

        const { doctors } = await DoctorService.getAll({ page: 1, limit: 100 });
        expect(doctors.some((d) => d.id === doctor!.id)).toBe(true);
    });
});
