// There is no registration page, so the first admin (and anyone locked out) gets in with this:
//   bun run auth:set-password someone@example.com
// Sets a random temporary password and forces a change at next login.
import prisma from "@lib/db";
import { AuthService } from "@services/auth.service";

const email = process.argv[2]?.trim();
if (!email) {
    console.error("Usage: bun run auth:set-password <email>");
    process.exit(1);
}

const profile = await prisma.profiles.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, role: true },
});
if (!profile || (profile.role !== "ADMIN" && profile.role !== "EMPLOYEE")) {
    console.error(`No admin or employee with email ${email}`);
    process.exit(1);
}

const password = await AuthService.issueTempPassword(profile.id);
console.log(`${profile.name} (${profile.role})\n  email:    ${email}\n  password: ${password}\n\nThey must change it at first login.`);
await prisma.$disconnect();
