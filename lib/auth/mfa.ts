import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "./roles";

export const MFA_REQUIRED_ROLES: readonly Role[] = ["super_admin", "system_admin", "finance_officer", "finance_administrator"];

export async function enforceMfaForSensitiveRoles(roles: readonly Role[]) {
  if (!roles.some(role => MFA_REQUIRED_ROLES.includes(role))) return;
  const db = await createSupabaseServerClient();
  const { data: aal, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  // Fail closed: a lookup error must not silently skip enforcement for these
  // roles. Throw rather than redirect here, since redirecting to a page that
  // performs the same lookup could loop if the failure isn't transient.
  if (error || !aal) throw new Error("Unable to verify two-factor status. Please try again.");
  if (aal.nextLevel !== "aal2") redirect("/mfa-setup?required=1");
  if (aal.currentLevel !== "aal2") redirect("/mfa-challenge");
}
