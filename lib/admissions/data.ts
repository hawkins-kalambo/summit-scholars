import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/auth/session";
import { notFound, redirect } from "next/navigation";
import type { Catalogue } from "./validation";

export async function requireAdmissionsAccount() {
  const account = await requireAccount();
  if (account.status === "suspended") redirect("/portal");
  return account;
}
export async function requireAcademicManager() {
  const account = await requireAdmissionsAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "super_admin" || role === "academic_admin")) notFound();
  return account;
}
export async function getCatalogue() {
  const db = await createSupabaseServerClient();
  const results = await Promise.all([
    db.from("universities").select("*").order("name"),
    db.from("programmes").select("*").order("name"),
    db.from("academic_periods").select("*").order("registration_opens", { ascending: false }),
    db.from("courses").select("*").order("name"),
  ]);
  if (results.some(result => result.error)) throw new Error("We could not load the academic options. Please contact support.");
  return { universities: results[0].data, programmes: results[1].data, periods: results[2].data, courses: results[3].data } as Catalogue;
}
export async function getAdmissionsSettings() {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("organisation_settings").select("*").eq("id", true).single();
  if (error || !data) throw new Error("We could not load the admissions settings. Please contact support.");
  return data as { registration_open: boolean; privacy_notice: string; privacy_version: number; student_number_prefix: string; documents_required: boolean };
}
