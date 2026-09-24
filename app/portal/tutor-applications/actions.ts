"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAcademicManager } from "@/lib/admissions/data";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordId, type FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function reviewTutorApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const id = recordId.safeParse(form.get("id"));
  const revision = Number(form.get("revision") ?? 0);
  const note = z.string().trim().min(5).max(2000).safeParse(form.get("note"));
  if (!id.success || !note.success) return { error: "Provide a review note." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("review_tutor_application", { p_id: id.data, p_revision: revision, p_note: note.data });
  if (error) return failure(error);
  revalidatePath("/portal/tutor-applications");
  return { success: "Application marked under review." };
}
export async function decideTutorApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const input = z.object({
    id: z.string().uuid(), revision: z.coerce.number().int().positive(),
    decision: z.enum(["approve", "reject"]), note: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose a decision and provide a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("decide_tutor_application", { p_id: input.data.id, p_revision: input.data.revision, p_decision: input.data.decision, p_note: input.data.note });
  if (error) return failure(error);
  revalidatePath("/portal/tutor-applications");
  return { success: input.data.decision === "approve" ? "Recommended for the tutor role. A System Administrator must now provision the account." : "Decision recorded." };
}
export async function provisionTutorAccount(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdminArea("users");
  const input = z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Provide a reason for provisioning this account." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("provision_tutor_account", { p_id: input.data.id, p_reason: input.data.reason });
  if (error) return failure(error);
  revalidatePath("/portal/tutor-applications");
  return { success: "Account provisioned. The tutor has been emailed to sign in." };
}
