"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { roles } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";

export async function requestStaffAccess(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({ email: z.string().email().max(254), role: z.enum(roles).exclude(["student"]), operation: z.enum(["grant", "revoke"]), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a valid email, staff role, operation and reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("request_staff_access", { p_email: input.data.email, p_role: input.data.role, p_operation: input.data.operation, p_reason: input.data.reason });
  if (error) return { error: error.code === "P0001" ? error.message : error.code === "23505" ? "A request for this account and role is already pending." : "Unable to create this request." };
  revalidatePath("/portal/staff");
  return { success: "Request saved for separate Super Administrator approval." };
}

export async function decideStaffAccess(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const input = z.object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(5).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Enter a decision and reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("decide_staff_access", { p_id: input.data.id, p_approve: input.data.decision === "approve", p_reason: input.data.reason });
  if (error) return { error: error.code === "P0001" ? error.message : "Unable to decide this request." };
  revalidatePath("/portal", "layout");
  return { success: "Decision recorded." };
}
