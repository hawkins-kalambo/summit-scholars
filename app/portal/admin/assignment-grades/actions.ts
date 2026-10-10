"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function decideAssignmentGrade(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "academic_admin" || role === "super_admin")) return { error: "Academic administration permission required." };
  const input = z.object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose a decision and provide a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("approve_assignment_grade", { p_submission_id: input.data.id, p_approve: input.data.decision === "approve", p_reason: input.data.reason });
  if (error) return failure(error);
  revalidatePath("/portal/admin/assignment-grades");
  return { success: "Decision recorded." };
}
