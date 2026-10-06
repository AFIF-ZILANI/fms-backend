import prisma from "@lib/db";
import type { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { generateTempPassword, hashPassword, verifyPassword } from "@lib/password";
import { signSession, type SessionClient } from "@lib/session";
import { audit } from "@lib/audit";

// ponytail: in-memory, per process -- fine for one server. Move to the DB if this ever runs behind a load balancer.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { fails: number; until: number }>();

// Verified against when the email is unknown, so a miss costs the same time as a wrong password.
let dummyHash: string | undefined;

const LOGIN_ROLES = ["ADMIN", "EMPLOYEE"] as const;

const meSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
    must_change_password: true,
    employees: { select: { id: true, role: true } },
} as const;

type Me = Prisma.ProfilesGetPayload<{ select: typeof meSelect }>;

function shapeMe(p: Me) {
    return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        employee_id: p.employees?.id ?? null,
        employee_role: p.employees?.role ?? null,
        must_change_password: p.must_change_password,
    };
}

export const AuthService = {
    async login(email: string, password: string, client: SessionClient) {
        const key = email.trim().toLowerCase();
        const state = failures.get(key);
        if (state && state.until > Date.now()) {
            throw AppError.tooManyRequests("Too many failed attempts, try again in 15 minutes");
        }

        const profile = await prisma.profiles.findFirst({
            where: { email: { equals: key, mode: "insensitive" } },
            select: { ...meSelect, is_active: true, password_hash: true, password_changed_at: true },
        });
        const canLogin =
            profile?.password_hash &&
            profile.is_active &&
            (LOGIN_ROLES as readonly string[]).includes(profile.role);

        dummyHash ??= await hashPassword("not-a-real-password");
        const matches = await verifyPassword(
            password,
            canLogin && profile?.password_hash ? profile.password_hash : dummyHash,
        );

        if (!canLogin || !profile || !matches) {
            const lockExpired = state !== undefined && state.until !== 0 && state.until <= Date.now();
            const fails = (lockExpired ? 0 : (state?.fails ?? 0)) + 1;
            failures.set(key, { fails, until: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
            throw AppError.unauthorized("Invalid email or password");
        }

        failures.delete(key);
        const token = await signSession(profile.id, profile.password_changed_at, client);
        return { token, profile: shapeMe(profile) };
    },

    async me(profileId: string) {
        const profile = await prisma.profiles.findUnique({
            where: { id: profileId },
            select: meSelect,
        });
        if (!profile) throw AppError.unauthorized();
        return shapeMe(profile);
    },

    /** Returns a fresh token: the old one dies with the password change. */
    async changePassword(
        profileId: string,
        current: string,
        next: string,
        client: SessionClient,
    ) {
        const profile = await prisma.profiles.findUnique({
            where: { id: profileId },
            select: { password_hash: true },
        });
        if (!profile?.password_hash || !(await verifyPassword(current, profile.password_hash))) {
            throw AppError.badRequest("Current password is incorrect");
        }
        if (current === next) {
            throw AppError.badRequest("New password must be different from the current one");
        }
        const changedAt = new Date();
        const password_hash = await hashPassword(next);
        await prisma.$transaction([
            prisma.profiles.update({
                where: { id: profileId },
                data: { password_hash, must_change_password: false, password_changed_at: changedAt },
            }),
            audit(prisma, {
                table: "Profiles",
                record_id: profileId,
                action: "UPDATE",
                actor_id: profileId,
                note: "Password changed",
            }),
        ]);
        return { token: await signSession(profileId, changedAt, client) };
    },

    /**
     * Sets a random temporary password and forces a change at next login.
     * Returns the plaintext -- the only time it exists. Pass `tx` to make it
     * part of the caller's transaction (hire, admin create).
     */
    async issueTempPassword(
        profileId: string,
        tx: Prisma.TransactionClient | typeof prisma = prisma,
    ) {
        const password = generateTempPassword();
        await tx.profiles.update({
            where: { id: profileId },
            data: {
                password_hash: await hashPassword(password),
                must_change_password: true,
                password_changed_at: new Date(),
            },
        });
        return password;
    },
};
