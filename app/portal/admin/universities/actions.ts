"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : error.code === "23505" ? "This code is already in use." : "The record could not be saved. Check the fields and try again." };
}
export async function saveAcademicStructure(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdminArea("structure");
  const kind = z.enum(["campus", "faculty", "department"]).safeParse(form.get("kind"));
  if (!kind.success) return { error: "Choose a valid record type." };
  const name = z.string().trim().min(2).max(200).safeParse(form.get("name"));
  if (!name.success) return { error: "Enter a name between 2 and 200 characters." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("configure_academic_structure", { p_kind: kind.data, p_data: {
    reason: form.get("reason"), id: form.get("id") || null, name: name.data, code: String(form.get("code") ?? "").trim().toUpperCase(),
    university_id: form.get("university_id") || null, faculty_id: form.get("faculty_id") || null, active: form.get("active") === "on",
  } });
  if (error) return failure(error);
  revalidatePath("/portal/admin/universities");
  return { success: kind.data === "campus" ? "Campus saved." : kind.data === "faculty" ? "Faculty saved." : "Department saved." };
}
