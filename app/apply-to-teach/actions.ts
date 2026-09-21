"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { detectDocumentType } from "@/lib/admissions/files";
import { recordId, type FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function submitTutorApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount("/login/student");
  const input = z.object({
    fullName: z.string().trim().min(2).max(200), phone: z.string().trim().max(25),
    subjects: z.string().trim().min(2).max(500), qualifications: z.string().trim().min(10).max(4000),
    availability: z.string().trim().min(2).max(1000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in your name, phone, subjects, qualifications and availability." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("submit_tutor_application", {
    p_full_name: input.data.fullName, p_phone: input.data.phone, p_subjects: input.data.subjects,
    p_qualifications: input.data.qualifications, p_availability: input.data.availability,
  });
  if (error) return failure(error);
  revalidatePath("/apply-to-teach");
  return { success: "Application submitted. We will review it and contact you." };
}
export async function uploadTutorDocument(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAccount("/login/student");
  const id = recordId.safeParse(form.get("applicationId"));
  const file = form.get("document");
  if (!id.success || !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return { error: "Choose a PDF, JPEG or PNG file of up to 10 MB." };
  }
  const type = detectDocumentType(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  if (!type) return { error: "This file is not a supported PDF or image." };
  const db = await createSupabaseServerClient();
  const path = account.user.id + "/" + id.data + "/" + crypto.randomUUID() + "." + type.extension;
  const { error: uploadError } = await db.storage.from("tutor-application-documents").upload(path, file, { contentType: type.mime, upsert: false });
  if (uploadError) return { error: "The upload failed. Check the application is still editable and try again." };
  const { error } = await db.rpc("attach_tutor_application_document", { p_application: id.data, p_path: path, p_name: file.name.slice(0, 200), p_type: type.mime, p_size: file.size });
  if (error) {
    await db.storage.from("tutor-application-documents").remove([path]);
    return failure(error);
  }
  revalidatePath("/apply-to-teach");
  return { success: "Document uploaded." };
}
