"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function postAnnouncement(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({
    courseId: z.union([z.string().uuid(), z.literal("")]),
    title: z.string().trim().min(2).max(200),
    body: z.string().trim().min(5).max(4000),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in a title, the announcement text and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("post_announcement", {
    p_course_id: input.data.courseId || null, p_title: input.data.title, p_body: input.data.body, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/announcements");
  return { success: "Announcement posted." };
}
export async function deleteAnnouncement(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({ announcementId: z.string().uuid(), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Provide a reason for removing this announcement." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("delete_announcement", { p_id: input.data.announcementId, p_reason: input.data.reason });
  if (error) return failure(error);
  revalidatePath("/portal/announcements");
  return { success: "Announcement removed." };
}
