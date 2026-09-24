"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultPortal } from "@/lib/auth/portals";
import type { AuthResult } from "@/lib/auth/validation";

export async function verifyMfaChallenge(_state: AuthResult, form: FormData): Promise<AuthResult> {
  const account = await requireAccount("/login", { enforceMfa: false });
  const factorId = form.get("factorId");
  const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.").safeParse(form.get("code"));
  if (typeof factorId !== "string" || !code.success) return { error: "Enter the 6-digit code from your authenticator app." };
  const db = await createSupabaseServerClient();
  const { data: challenge, error: challengeError } = await db.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) return { error: "Unable to verify. Please try again." };
  const { error } = await db.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.data });
  if (error) return { error: "That code did not match. Please try again." };
  const portal = defaultPortal(account.roles, account.status);
  redirect(portal ? "/portal/home/" + portal : "/portal");
}
