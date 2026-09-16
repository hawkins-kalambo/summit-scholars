"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { librarySchema } from "@/lib/library/validation";
import { detectDocumentType } from "@/lib/admissions/files";
import type { FormResult } from "@/lib/admissions/validation";
export async function saveResource(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAdminArea("library");
  const input = librarySchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: input.error.issues[0].message };
  const id = form.get("id") || null;
  if (id && !z.string().uuid().safeParse(id).success) return { error: "Invalid resource." };
  const revision = Number(form.get("revision") ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) return { error: "Invalid resource revision." };
  const file = form.get("file"); let objectPath: string | null = null; let mime: string | null = null; let size: number | null = null;
  try {
    if (!id && file instanceof File && file.size > 0) {
      if (input.data.content_text.trim()) return { error: "Choose a file or pasted notes, not both." };
      if (file.size > 10485760) return { error: "Files must be no larger than 10 MiB." };
      const bytes = new Uint8Array(await file.arrayBuffer()); const type = detectDocumentType(bytes);
      if (!type) return { error: "Upload a PDF, PNG or JPEG file." };
      mime = type.mime; size = file.size; objectPath = account.user.id + "/" + crypto.randomUUID();
      const storage = createServiceClient();
      const { error } = await storage.storage.from("library-materials").upload(objectPath,bytes,{ contentType: mime, upsert: false });
      if (error) return { error: "Upload failed. Check the private storage configuration." };
    }
    if (!id && !objectPath && !input.data.content_text.trim()) return { error: "Upload a file or paste study notes." };
    const db = await createSupabaseServerClient();
    const { error } = await db.rpc("save_library_resource", { p_id: id, p_revision: revision, p_data: { ...input.data, object_path: objectPath, mime_type: mime, size_bytes: size }, p_reason: input.data.reason });
    if (error) {
      if (objectPath && error.code && /^[0-9A-Z]{5}$/.test(error.code)) await createServiceClient().storage.from("library-materials").remove([objectPath]);
      return { error: error.code === "P0001" ? error.message : "Resource could not be saved. Check the fields and database setup." };
    }
  } catch { return { error: "Library storage is temporarily unavailable. Please try again." }; }
  revalidatePath("/portal", "layout"); return { success: "Saved as a draft. Preview it, then publish when ready." };
}
export async function publishResource(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAdminArea("library");
  const input = z.object({ id: z.string().uuid(), status: z.enum(["draft","published","archived"]), revision: z.coerce.number().int().positive(), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose a resource, status and reason." };
  const db = await createSupabaseServerClient(); const { error } = await db.rpc("publish_library_resource", { p_id: input.data.id, p_revision: input.data.revision, p_status: input.data.status, p_reason: input.data.reason });
  if (error) return { error: error.code === "P0001" ? error.message : "Publication could not be updated." };
  revalidatePath("/portal", "layout"); return { success: "Library publication updated." };
}
