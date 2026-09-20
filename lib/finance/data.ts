import "server-only";
import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";

export async function requireFinance() {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "finance_officer" || role === "finance_administrator" || role === "super_admin")) notFound();
  return account;
}
