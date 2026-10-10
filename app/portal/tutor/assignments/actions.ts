"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
export async function createAssignment(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireTutor();
  const input = z.object({
    courseId: z.string().uuid(), title: z.string().trim().min(2).max(200), description: z.string().trim().min(10).max(4000),
    maxScore: z.coerce.number().positive(), dueAt: z.string().min(1), reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in the title, description, maximum score, due date and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("create_assignment", {
    p_course_id: input.data.courseId, p_title: input.data.title, p_description: input.data.description,
    p_max_score: input.data.maxScore, p_due_at: new Date(input.data.dueAt).toISOString(), p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/tutor/assignments");
  return { success: "Assignment created." };
}
export async function gradeSubmission(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireTutor();
  const input = z.object({
    submissionId: z.string().uuid(), score: z.coerce.number().min(0), note: z.string().trim().min(5).max(2000), reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a score, feedback and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("grade_assignment_submission", {
    p_submission_id: input.data.submissionId, p_score: input.data.score, p_note: input.data.note, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/tutor/assignments");
  return { success: "Grade recorded. An academic administrator must approve it before the student sees it." };
}
