"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { loginSchema, registrationSchema, type AuthResult } from "@/lib/auth/validation";

import { isRole } from "@/lib/auth/roles";
import { isPortal, canEnterPortal } from "@/lib/auth/portals";

export async function login(_previous: AuthResult, form: FormData): Promise<AuthResult> {
  if (!supabaseConfig()) return { error: "Sign-in is not available yet. Please contact support." };
  const portal = form.get("portal");
  if (!isPortal(portal)) return { error: "Choose a valid sign-in portal." };
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) return { error: "Unable to sign in. Check your email, password, and email verification." };
    const [profile, assignments] = await Promise.all([
      supabase.from("profiles").select("account_status").eq("id", data.user.id).single(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    ]);
    const roles = (assignments.data ?? []).map(row => row.role).filter(isRole);
    if (!data.user.email_confirmed_at || profile.error || assignments.error || !canEnterPortal(roles, profile.data?.account_status ?? "", portal)) {
      await supabase.auth.signOut({ scope: "local" });
      return { error: "This account cannot access this portal. Choose the correct portal or contact your administrator." };
    }
  } catch {
    return { error: "Sign-in is temporarily unavailable. Please try again." };
  }
  redirect("/portal/home/" + portal);
}

export async function register(_previous: AuthResult, form: FormData): Promise<AuthResult> {
  if (!supabaseConfig()) return { error: "Registration is not available yet. Please contact support." };
  const parsed = registrationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const appUrl = process.env.APP_URL;
  if (!appUrl) return { error: "Registration is temporarily unavailable. Please contact support." };
  try {
    const origin = new URL(appUrl).origin;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        emailRedirectTo: origin + "/auth/confirm",
      },
    });
    if (error) return { error: "Unable to create the account. Please try again later or contact support." };
  } catch {
    return { error: "Registration is temporarily unavailable. Please try again." };
  }
  return { success: "Check your inbox for a verification link. If you already have an account, sign in or use password recovery." };
}

export async function requestPasswordReset(_previous: AuthResult, form: FormData): Promise<AuthResult> {
  if (!supabaseConfig() || !process.env.APP_URL) return { error: "Password recovery is temporarily unavailable." };
  const parsed = loginSchema.shape.email.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: new URL("/auth/confirm", process.env.APP_URL).href,
    });
    if (error) return { error: "Password recovery is temporarily unavailable. Please try again later." };
  } catch {
    return { error: "Password recovery is temporarily unavailable. Please try again later." };
  }
  return { success: "If an account exists for this address, you will receive a password reset link." };
}

export async function resetPassword(_previous: AuthResult, form: FormData): Promise<AuthResult> {
  const parsed = registrationSchema.shape.password.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { error: "Your reset link has expired. Request another link." };
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    if (error) return { error: "Unable to update your password. Use a different password or request a new link." };
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) return { success: "Password updated. Please sign out from your account before using a shared device." };
  } catch {
    return { error: "Unable to update your password. Please try again." };
  }
  redirect("/login?password=updated");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Sign-out failed. Please try again.");
  redirect("/login");
}
