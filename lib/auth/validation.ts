import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(128),
});
export const registrationSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
export type AuthResult = { error?: string; success?: string };
