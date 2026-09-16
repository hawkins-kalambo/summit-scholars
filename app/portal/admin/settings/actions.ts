"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
export async function saveOrganisation(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.includes("super_admin")) return { error: "Super Administrator access required." };
  const input = z.object({ name: z.string().trim().min(2).max(200), email: z.string().email().max(254), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a valid name, support email and reason." };
  const db = await createSupabaseServerClient(); const { error } = await db.rpc("configure_organisation", { p_name: input.data.name, p_email: input.data.email, p_reason: input.data.reason });
  if (error) return { error: "Organisation settings could not be saved." };
  revalidatePath("/portal", "layout"); return { success: "Organisation settings saved." };
}
