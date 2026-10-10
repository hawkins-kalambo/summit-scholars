"use server";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { detectDocumentType } from "@/lib/admissions/files";
import { recordId, type FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function submitAssignment(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAccount();
  const id = recordId.safeParse(form.get("assignmentId"));
  const file = form.get("document");
  if (!id.success || !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return { error: "Choose a PDF, JPEG or PNG file of up to 10 MB." };
  }
  const type = detectDocumentType(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  if (!type) return { error: "This file is not a supported PDF or image." };
  const db = await createSupabaseServerClient();
  const path = account.user.id + "/" + id.data + "/" + crypto.randomUUID() + "." + type.extension;
  const { error: uploadError } = await db.storage.from("assignment-submissions").upload(path, file, { contentType: type.mime, upsert: false });
  if (uploadError) return { error: "The upload failed. Check you are enrolled in this course and try again." };
  const { error } = await db.rpc("submit_assignment", { p_assignment_id: id.data, p_path: path, p_name: file.name.slice(0, 200), p_type: type.mime, p_size: file.size });
  if (error) {
    await db.storage.from("assignment-submissions").remove([path]);
    return failure(error);
  }
  revalidatePath("/portal/assignments");
  return { success: "Assignment submitted." };
}
