import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@lib/password";

export const loginSchema = z.object({
    email: z.string().email("Invalid email"),
    password: z.string().min(1, "Password is required"),
    // The phone has no cookie jar, so it gets the token in the response body.
    client: z.enum(["web", "mobile"]).default("web"),
});

export const changePasswordSchema = z.object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
        .max(128, "Password is too long"),
});

export const updateAccountSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required").max(120),
        mobile: z.string().trim().min(6, "Mobile is required").max(30),
        // "" clears it.
        address: z.string().trim().max(300),
    })
    .partial();

export const deactivateAccountSchema = z.object({
    password: z.string().min(1, "Enter your password to confirm"),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type DeactivateAccountInput = z.infer<typeof deactivateAccountSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
