"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAcademicManager } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordId, type FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : error.code === "23505" ? "This code is already in use." : "The academic record could not be saved. Check the fields and try again." };
}
export async function saveAcademicRecord(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const kind = z.enum(["university","programme","period","course"]).safeParse(form.get("kind"));
  if (!kind.success) return { error: "Choose a valid record type." };
  const name = z.string().trim().min(2).max(200).safeParse(form.get("name"));
  if (!name.success) return { error: "Enter a name between 2 and 200 characters." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("configure_academics", { p_kind: kind.data, p_data: {
    reason: form.get("reason"), id: form.get("id") || null, name: name.data, code: String(form.get("code") ?? "").trim().toUpperCase(),
    university_id: form.get("university_id"), active: form.get("active")==="on",
    registration_opens: form.get("registration_opens"), registration_closes: form.get("registration_closes"),
    description: String(form.get("description") ?? "").slice(0,2000), level: Number(form.get("level") ?? 1),
  }});
  if (error) return failure(error);
  revalidatePath("/portal/academics");
  return { success: kind.data === "course" ? "Course saved as a draft. Super Administrator approval is required to publish it." : "Academic record saved." };
}
export async function publishCourse(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const id = recordId.safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid course." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("publish_course", { p_reason: form.get("reason"), p_id: id.data, p_published: form.get("published")==="true" });
  if (error) return failure(error);
  revalidatePath("/portal/academics");
  return { success: "Course publication updated." };
}
export async function assignTutor(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const input = z.object({
    courseId: z.string().uuid(), tutorId: z.string().uuid(), assign: z.enum(["true", "false"]),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose a course, tutor and reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("assign_course_tutor", {
    p_course_id: input.data.courseId, p_tutor_id: input.data.tutorId,
    p_assign: input.data.assign === "true", p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/academics");
  return { success: "Tutor assignment updated." };
}
export async function saveAdmissionsSettings(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAcademicManager();
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("configure_admissions", {
    p_reason: form.get("reason"), p_open: form.get("registrationOpen")==="on", p_notice: String(form.get("privacyNotice") ?? ""),
    p_prefix: String(form.get("studentPrefix") ?? "").trim().toUpperCase(), p_documents: form.get("documentsRequired")==="on",
  });
  if (error) return failure(error);
  revalidatePath("/portal/academics");
  return { success: "Admissions settings saved." };
}
