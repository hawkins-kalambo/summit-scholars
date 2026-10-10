"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { loginSchema } from "@/lib/auth/validation";

export type ApplyState = { error?: string; success?: string; email?: string };

export async function requestApplicationAccess(state: ApplyState, form: FormData): Promise<ApplyState> {
  if (!supabaseConfig()) return { error: "This isn't available yet. Please contact support." };
  const db = await createSupabaseServerClient();
  const code = form.get("code");

  if (typeof state.email === "string" && typeof code === "string" && code) {
    const parsed = z.string().trim().regex(/^\d{6}$/).safeParse(code);
    if (!parsed.success) return { ...state, error: "Enter the 6-digit code from your email." };
    const { error } = await db.auth.verifyOtp({ email: state.email, token: parsed.data, type: "email" });
    if (error) return { ...state, error: "That code did not match or has expired. Please try again." };
    redirect("/portal/applications/new");
  }

  const parsedEmail = loginSchema.shape.email.safeParse(form.get("email"));
  if (!parsedEmail.success) return { error: "Enter a valid email address." };
  const { error } = await db.auth.signInWithOtp({ email: parsedEmail.data, options: { shouldCreateUser: true } });
  if (error) {
    console.error("Application access code failed to send", { status: error.status, code: error.code });
    if (error.code === "over_email_send_rate_limit") return { error: "Too many attempts. Please wait a few minutes and try again." };
    return { error: "Could not send a code to that address. Please try again." };
  }
  return { email: parsedEmail.data, success: "Check your email for a 6-digit code." };
}
