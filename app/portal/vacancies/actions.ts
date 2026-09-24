"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This could not be saved. Check the fields and try again." };
}
async function requireVacancyManager() {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "academic_admin" || role === "system_admin" || role === "super_admin")) {
    return null;
  }
  return account;
}
export async function createVacancy(_state: FormResult, form: FormData): Promise<FormResult> {
  if (!(await requireVacancyManager())) return { error: "Academic or System Administrator permission required." };
  const input = z.object({
    title: z.string().trim().min(2).max(200), subjects: z.string().trim().min(2).max(500),
    description: z.string().trim().min(10).max(4000), closesAt: z.string().trim().max(10).optional(),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in the title, subjects, description and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("create_vacancy", {
    p_title: input.data.title, p_subjects: input.data.subjects, p_description: input.data.description,
    p_closes_at: input.data.closesAt || null, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/vacancies");
  revalidatePath("/vacancies");
  return { success: "Vacancy posted." };
}
export async function updateVacancy(_state: FormResult, form: FormData): Promise<FormResult> {
  if (!(await requireVacancyManager())) return { error: "Academic or System Administrator permission required." };
  const input = z.object({
    id: z.string().uuid(), title: z.string().trim().min(2).max(200), subjects: z.string().trim().min(2).max(500),
    description: z.string().trim().min(10).max(4000), closesAt: z.string().trim().max(10).optional(),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Fill in the title, subjects, description and a reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("update_vacancy", {
    p_id: input.data.id, p_title: input.data.title, p_subjects: input.data.subjects, p_description: input.data.description,
    p_is_open: form.get("isOpen") === "true", p_closes_at: input.data.closesAt || null, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/vacancies");
  revalidatePath("/vacancies");
  return { success: "Vacancy updated." };
}
