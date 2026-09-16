"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applicationSchema, recordId, type FormResult } from "@/lib/admissions/validation";
import { requireAdmissionsAccount } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { detectDocumentType } from "@/lib/admissions/files";

function failure(error: { code?: string; message: string }): FormResult {
  if (error.code === "P0001") return { error: error.message };
  if (error.code === "23505") return { error: "An application for this intake already exists. Open it from your applications." };
  return { error: "We could not save this change. Please try again or contact admissions." };
}
export async function saveApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const parsed = applicationSchema.safeParse({ ...Object.fromEntries(form), courseIds: form.getAll("courseIds") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("save_application", {
    p_id: d.applicationId || null, p_revision: d.revision, p_university: d.universityId,
    p_programme: d.programmeId, p_period: d.periodId, p_year: d.year, p_phone: d.phone, p_mode: d.mode, p_courses: d.courseIds,
  });
  if (error) return failure(error);
  revalidatePath("/portal/applications");
  redirect("/portal/applications/" + data);
}
export async function submitApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const parsed = recordId.safeParse(form.get("applicationId"));
  if (!parsed.success) return { error: "Invalid application." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("submit_application", {
    p_id: parsed.data, p_revision: Number(form.get("revision")),
    p_consent: form.get("consent") === "on", p_privacy_version: Number(form.get("privacyVersion")),
  });
  if (error) return failure(error);
  revalidatePath("/portal/applications/" + parsed.data);
  return { success: "Application submitted. You can track its progress here." };
}
export async function cancelApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const parsed = recordId.safeParse(form.get("applicationId"));
  if (!parsed.success) return { error: "Invalid application." };
  if (form.get("confirmCancel") !== "on") return { error: "Confirm that you want to cancel this application." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("cancel_application", { p_id: parsed.data });
  if (error) return failure(error);
  revalidatePath("/portal/applications/" + parsed.data);
  return { success: "Application cancelled." };
}
export async function uploadDocument(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAdmissionsAccount();
  const id = recordId.safeParse(form.get("applicationId"));
  const file = form.get("document");
  if (!id.success || !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return { error: "Choose a PDF, JPEG or PNG file of up to 10 MB." };
  }
  const type = detectDocumentType(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  if (!type) return { error: "This file is not a supported PDF or image." };
  const db = await createSupabaseServerClient();
  const path = account.user.id + "/" + id.data + "/" + crypto.randomUUID() + "." + type.extension;
  const { error: uploadError } = await db.storage.from("application-documents").upload(path, file, { contentType: type.mime, upsert: false });
  if (uploadError) return { error: "The upload failed. Check the application is editable and try again." };
  const { error } = await db.rpc("attach_application_document", {
    p_application: id.data, p_path: path, p_name: file.name.slice(0,200), p_type: type.mime, p_size: file.size,
  });
  if (error) {
    await db.storage.from("application-documents").remove([path]);
    return failure(error);
  }
  revalidatePath("/portal/applications/" + id.data);
  return { success: "Document uploaded." };
}
export async function reviewApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const id = recordId.safeParse(form.get("applicationId"));
  if (!id.success) return { error: "Invalid application." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("review_application", { p_id: id.data, p_revision: Number(form.get("revision")), p_action: form.get("reviewAction"), p_note: form.get("note") });
  if (error) return failure(error);
  revalidatePath("/portal/applications/" + id.data);
  return { success: "Review recorded." };
}
export async function decideApplication(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const id = recordId.safeParse(form.get("applicationId"));
  if (!id.success) return { error: "Invalid application." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("decide_application", { p_id: id.data, p_revision: Number(form.get("revision")), p_decision: form.get("decision"), p_note: form.get("note") });
  if (error) return failure(error);
  revalidatePath("/portal/applications/" + id.data);
  revalidatePath("/portal");
  return { success: "Admission decision recorded." };
}
export async function removeDocument(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdmissionsAccount();
  const id = recordId.safeParse(form.get("documentId"));
  if (!id.success) return { error: "Invalid document." };
  const db = await createSupabaseServerClient();
  const { data, error: readError } = await db.from("application_documents").select("object_path,application_id").eq("id",id.data).maybeSingle();
  if (readError || !data) return { error: "Document unavailable." };
  const { error: storageError } = await db.storage.from("application-documents").remove([data.object_path]);
  if (storageError) return { error: "The document could not be removed. Check that the application is editable." };
  const { error } = await db.rpc("remove_application_document",{p_id:id.data});
  if (error) return failure(error);
  revalidatePath("/portal/applications/" + data.application_id);
  return { success: "Document removed." };
}
