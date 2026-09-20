"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function scheduleSession(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireTutor();
  const input = z.object({
    courseId: z.string().uuid(), topic: z.string().trim().min(2).max(200), venue: z.string().trim().min(2).max(200),
    startsAt: z.string().min(1), endsAt: z.string().min(1), meetingLink: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in the topic, venue, start, end and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("schedule_class_session", {
    p_course_id: input.data.courseId, p_topic: input.data.topic, p_venue: input.data.venue,
    p_starts_at: new Date(input.data.startsAt).toISOString(), p_ends_at: new Date(input.data.endsAt).toISOString(),
    p_meeting_link: input.data.meetingLink || null, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/tutor");
  return { success: "Class scheduled." };
}
export async function confirmSession(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireTutor();
  const sessionId = form.get("sessionId");
  const status = form.get("status");
  const reason = form.get("reason");
  if (!z.string().uuid().safeParse(sessionId).success || !["completed", "cancelled", "no_show"].includes(String(status))
    || !z.string().trim().min(5).max(2000).safeParse(reason).success) return { error: "Choose a session, an outcome and provide a reason." };
  let actualStartsAt: string | null = null;
  let actualEndsAt: string | null = null;
  const attendance: { student_id: string; status: string }[] = [];
  if (status === "completed") {
    const start = form.get("actualStart");
    const end = form.get("actualEnd");
    if (!start || !end) return { error: "Provide the actual start and end time for a completed class." };
    actualStartsAt = new Date(String(start)).toISOString();
    actualEndsAt = new Date(String(end)).toISOString();
    for (const [key, value] of form.entries()) {
      if (key.startsWith("attendance_")) attendance.push({ student_id: key.slice("attendance_".length), status: String(value) });
    }
  }
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("confirm_class_session", {
    p_session_id: sessionId, p_status: status, p_actual_starts_at: actualStartsAt, p_actual_ends_at: actualEndsAt,
    p_attendance: attendance, p_reason: String(reason),
  });
  if (error) return failure(error);
  revalidatePath("/portal/tutor");
  return { success: "Session updated." };
}
