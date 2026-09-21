"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isGoogleCalendarConfigured, createMeetEvent, cancelMeetEvent } from "@/lib/calendar/google";
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
  const startsAt = new Date(input.data.startsAt).toISOString();
  const endsAt = new Date(input.data.endsAt).toISOString();
  let meetingLink = input.data.meetingLink || null;
  let googleEventId: string | null = null;
  if (isGoogleCalendarConfigured() && form.get("autoGenerateMeet") === "true") {
    try {
      const event = await createMeetEvent({ topic: input.data.topic, startsAt, endsAt });
      meetingLink = event.meetingLink;
      googleEventId = event.eventId;
    } catch {
      return { error: "Could not create the Google Meet link. Try again or enter a link manually." };
    }
  }
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("schedule_class_session", {
    p_course_id: input.data.courseId, p_topic: input.data.topic, p_venue: input.data.venue,
    p_starts_at: startsAt, p_ends_at: endsAt,
    p_meeting_link: meetingLink, p_reason: input.data.reason, p_google_event_id: googleEventId,
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
  let googleEventId: string | null = null;
  if (status === "cancelled") {
    const { data: session } = await db.from("class_sessions").select("google_event_id").eq("id", String(sessionId)).maybeSingle();
    googleEventId = (session as { google_event_id: string | null } | null)?.google_event_id ?? null;
  }
  const { error } = await db.rpc("confirm_class_session", {
    p_session_id: sessionId, p_status: status, p_actual_starts_at: actualStartsAt, p_actual_ends_at: actualEndsAt,
    p_attendance: attendance, p_reason: String(reason),
  });
  if (error) return failure(error);
  if (googleEventId) {
    // Best-effort: the class is already cancelled in our records either way.
    await cancelMeetEvent(googleEventId).catch(() => undefined);
  }
  revalidatePath("/portal/tutor");
  return { success: "Session updated." };
}
export async function saveTutorProfile(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireTutor();
  const input = z.object({
    displayName: z.string().trim().min(2).max(200), headline: z.string().trim().min(2).max(200),
    bio: z.string().trim().min(10).max(2000), subjects: z.string().trim().min(2).max(500),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in your display name, headline, bio and subjects." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("save_tutor_profile", {
    p_display_name: input.data.displayName, p_headline: input.data.headline, p_bio: input.data.bio,
    p_subjects: input.data.subjects, p_visible: form.get("visible") === "true",
  });
  if (error) return failure(error);
  revalidatePath("/portal/tutor");
  revalidatePath("/tutors");
  return { success: "Public profile saved." };
}
