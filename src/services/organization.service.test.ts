import { describe, test, expect, afterAll } from "bun:test";
import prisma from "@lib/db";
import { OrganizationService, ItemOrganizationService } from "./organization.service";
import { ItemService } from "./item.service";
import { AppError } from "@lib/app-error";

const createdOrgIds: string[] = [];
const createdItemIds: string[] = [];
const createdLinkIds: string[] = [];

describe("OrganizationService", () => {
    afterAll(async () => {
        await prisma.itemOrganization.deleteMany({ where: { id: { in: createdLinkIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
        await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    });

    test("create then getById round-trips", async () => {
        const label = `AgroCorp ${crypto.randomUUID()}`;
        const org = await OrganizationService.create({ label_name: label });
        createdOrgIds.push(org!.id);

        const found = await OrganizationService.getById(org!.id);
        expect(found.label_name).toBe(label);
        expect(found.normalized_key).toBe(label.toLowerCase());
    });

    test("duplicate label throws a conflict", async () => {
        const label = `DupCorp ${crypto.randomUUID()}`;
        const first = await OrganizationService.create({ label_name: label });
        createdOrgIds.push(first!.id);

        await expect(
            OrganizationService.create({ label_name: label.toUpperCase() }),
        ).rejects.toMatchObject({ status: 409 });
    });

    test("getById on unknown id throws not-found", async () => {
        await expect(
            OrganizationService.getById("00000000-0000-0000-0000-000000000000"),
        ).rejects.toBeInstanceOf(AppError);
    });

    test("link an item to an organization, then remove it", async () => {
        const org = await OrganizationService.create({
            label_name: `LinkCorp ${crypto.randomUUID()}`,
        });
        createdOrgIds.push(org!.id);
        const item = await ItemService.create({
            name: `Linked Item ${crypto.randomUUID()}`,
            category: "MEDICINE",
            unit: "BOTTLE",
        });
        createdItemIds.push(item!.id);

        const link = await ItemOrganizationService.create({
            item_id: item!.id,
            organization_id: org!.id,
            role: "MANUFACTURER",
        });
        createdLinkIds.push(link.id);
        expect(link.item.id).toBe(item!.id);
        expect(link.organization.id).toBe(org!.id);

        await ItemOrganizationService.remove(link.id);
        await expect(ItemOrganizationService.remove(link.id)).rejects.toMatchObject({
            status: 404,
        });
    });

    test("duplicate item-org-role link throws a conflict", async () => {
        const org = await OrganizationService.create({
            label_name: `DupLink ${crypto.randomUUID()}`,
        });
        createdOrgIds.push(org!.id);
        const item = await ItemService.create({
            name: `Dup Link Item ${crypto.randomUUID()}`,
            category: "MEDICINE",
            unit: "BOTTLE",
        });
        createdItemIds.push(item!.id);

        const link = await ItemOrganizationService.create({
            item_id: item!.id,
            organization_id: org!.id,
            role: "IMPORTER",
        });
        createdLinkIds.push(link.id);

        await expect(
            ItemOrganizationService.create({
                item_id: item!.id,
                organization_id: org!.id,
                role: "IMPORTER",
            }),
        ).rejects.toMatchObject({ status: 409 });
    });
});
