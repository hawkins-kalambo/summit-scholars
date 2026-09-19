import Link from "next/link";
import { AuthShell, UnavailableNotice } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { supabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export default function RegisterPage() {
  const enabled = Boolean(supabaseConfig() && process.env.APP_URL);
  return <AuthShell portal="student" title="Create your student account" description="Registration is free. Verify your email to access your account; course admission is a separate review.">
    {!enabled && <UnavailableNotice />}
    <AuthForm mode="register" enabled={enabled} />
    <p className="auth-links">Already registered? <Link href="/login/student">Sign in</Link></p>
  </AuthShell>;
}
