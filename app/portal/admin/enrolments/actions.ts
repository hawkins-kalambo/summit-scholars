"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
export async function updateEnrolment(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdminArea("library");
  const input = z.object({ id: z.string().uuid(), expected: z.enum(["pending","active","withdrawn","completed"]), status: z.enum(["active","withdrawn","completed"]), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose an enrolment, status and reason." };
  const db = await createSupabaseServerClient(); const { error } = await db.rpc("change_enrolment_status", { p_id: input.data.id, p_expected: input.data.expected, p_status: input.data.status, p_reason: input.data.reason });
  if (error) return { error: error.code === "P0001" ? error.message : "Enrolment could not be updated." };
  revalidatePath("/portal", "layout"); return { success: "Enrolment updated." };
}
