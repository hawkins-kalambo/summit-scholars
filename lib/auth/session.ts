import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { supabaseConfig } from "../supabase/config";
import { isRole, type Role } from "./roles";
import { enforceMfaForSensitiveRoles } from "./mfa";

// enforceMfa defaults to true so every caller -- every page and every Server
// Action, not just the portal layout -- is protected without remembering to
// opt in. Only the MFA enrollment/challenge flow itself opts out, since it
// would otherwise be unable to complete the very requirement it enforces.
export async function requireAccount(loginPath = "/login", options: { enforceMfa?: boolean } = {}) {
  if (!supabaseConfig()) redirect(loginPath);
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email_confirmed_at) redirect(loginPath);
  const [profileResult, rolesResult] = await Promise.all([
    supabase.from("profiles").select("full_name, account_status, student_number, phone").eq("id", user.id).single(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (profileResult.error || rolesResult.error || !profileResult.data) {
    throw new Error("Unable to load your account. Please try again or contact support.");
  }
  const assignedRoles: Role[] = (rolesResult.data ?? []).map((row) => row.role).filter(isRole);
  if (options.enforceMfa !== false && String(profileResult.data.account_status) === "active") {
    await enforceMfaForSensitiveRoles(assignedRoles);
  }
  return { user, fullName: String(profileResult.data.full_name), status: String(profileResult.data.account_status), roles: assignedRoles, studentNumber: profileResult.data.student_number ? String(profileResult.data.student_number) : null, phone: profileResult.data.phone ? String(profileResult.data.phone) : null };
}
