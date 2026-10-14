"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be sent. Please try again." };
}
export async function startThread(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({ target: z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose who to message." };
  const [courseId, otherId] = input.data.target.split(":");
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("start_message_thread", { p_course_id: courseId, p_other_id: otherId });
  if (error) return failure(error);
  redirect("/portal/messages/" + data);
}
export async function sendMessage(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({ threadId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a message." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("send_message", { p_thread_id: input.data.threadId, p_body: input.data.body });
  if (error) return failure(error);
  revalidatePath("/portal/messages/" + input.data.threadId);
  return {};
}
