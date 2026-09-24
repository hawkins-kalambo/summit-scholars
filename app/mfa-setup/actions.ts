"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";

export type MfaEnrollState = { error?: string; success?: string; factorId?: string; qrCode?: string; secret?: string };

export async function manageMfaEnrollment(state: MfaEnrollState, form: FormData): Promise<MfaEnrollState> {
  await requireAccount("/login", { enforceMfa: false });
  const db = await createSupabaseServerClient();
  const code = form.get("code");
  const factorId = form.get("factorId");
  if (typeof factorId === "string" && typeof code === "string" && code) {
    const parsed = z.string().trim().regex(/^\d{6}$/).safeParse(code);
    if (!parsed.success) return { ...state, factorId, error: "Enter the 6-digit code from your authenticator app." };
    const { data: challenge, error: challengeError } = await db.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) return { ...state, factorId, error: "Unable to verify. Please try again." };
    const { error: verifyError } = await db.auth.mfa.verify({ factorId, challengeId: challenge.id, code: parsed.data });
    if (verifyError) return { ...state, factorId, error: "That code did not match. Please try again." };
    revalidatePath("/mfa-setup");
    return { success: "Two-factor authentication is now enabled." };
  }
  // A hijacked (but not yet aal2) session must not be able to enroll a rogue
  // second factor while a real, verified one already exists.
  const { data: existingFactors } = await db.auth.mfa.listFactors();
  if (existingFactors?.totp?.some(factor => factor.status === "verified")) {
    const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") return { error: "Verify your current two-factor code, or remove it, before setting up a new one." };
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp" });
  if (error) return { error: "Unable to start two-factor setup. Please try again." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function unenrollMfa(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount("/login", { enforceMfa: false });
  const factorId = form.get("factorId");
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(form.get("code"));
  if (typeof factorId !== "string" || !code.success) return { error: "Enter the 6-digit code from your authenticator app to confirm removal." };
  const db = await createSupabaseServerClient();
  // Require proof of possession of the factor being removed, regardless of
  // the session's current aal -- otherwise a hijacked session could strip a
  // victim's 2FA outright without ever holding their authenticator device.
  const { data: challenge, error: challengeError } = await db.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) return { error: "Unable to verify. Please try again." };
  const { error: verifyError } = await db.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.data });
  if (verifyError) return { error: "That code did not match. Please try again." };
  const { error } = await db.auth.mfa.unenroll({ factorId });
  if (error) return { error: "Unable to remove two-factor authentication." };
  revalidatePath("/mfa-setup");
  return { success: "Two-factor authentication removed." };
}
