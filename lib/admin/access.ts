import "server-only";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
export async function requireAdminArea(area: "users" | "library" | "audit" | "overview") {
  const account = await requireAccount("/login/admin");
  const allowed = area === "users" ? ["super_admin", "system_admin"] : area === "library" ? ["super_admin", "academic_admin"] : area === "audit" ? ["super_admin", "auditor"] : ["super_admin", "system_admin", "academic_admin"];
  if (account.status !== "active" || !account.roles.some(role => allowed.includes(role))) redirect("/portal");
  return account;
}
export function pageNumber(value: string | string[] | undefined) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1; }
