"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
export async function changeStatus(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdminArea("users");
  const input = z.object({ id: z.string().uuid(), action: z.enum(["suspend", "restore"]), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose an account, action and reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("change_account_status", { p_id: input.data.id, p_suspend: input.data.action === "suspend", p_reason: input.data.reason });
  if (error) return { error: error.code === "P0001" ? error.message : "Account status could not be updated." };
  revalidatePath("/portal", "layout");
  return { success: "Account status updated and recorded in the audit history." };
}
