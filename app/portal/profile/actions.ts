"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";

export async function updateProfile(_state: FormResult, form: FormData): Promise<FormResult> {
  const account = await requireAccount();
  const name = z.string().trim().min(2, "Enter your full name.").max(120).safeParse(form.get("fullName"));
  if (!name.success) return { error: name.error.issues[0].message };
  const phoneRaw = String(form.get("phone") ?? "").trim();
  const phone = phoneRaw === "" ? null : phoneRaw;
  if (phone !== null && !/^[+0-9 ()-]{7,20}$/.test(phone)) return { error: "Enter a valid phone number." };
  const db = await createSupabaseServerClient();
  const { error } = await db.from("profiles").update({ full_name: name.data, phone }).eq("id", account.user.id);
  if (error) return { error: "Unable to save your profile. Please try again." };
  revalidatePath("/portal", "layout");
  return { success: "Profile updated." };
}

export async function changePassword(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireAccount();
  const password = z.string().min(12, "Use at least 12 characters.").max(128).safeParse(form.get("password"));
  if (!password.success) return { error: password.error.issues[0].message };
  const db = await createSupabaseServerClient();
  const { error } = await db.auth.updateUser({ password: password.data });
  if (error) return { error: "Unable to update your password. Please try again." };
  return { success: "Password updated." };
}
