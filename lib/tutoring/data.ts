import "server-only";
import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";

export async function requireTutor() {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.includes("tutor")) notFound();
  return account;
}
