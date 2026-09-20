import Link from "next/link";
import { AuthShell, UnavailableNotice } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { supabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export default function ForgotPasswordPage() {
  const enabled = Boolean(supabaseConfig() && process.env.APP_URL);
  return <AuthShell title="Reset your password" description="Enter your account email and we’ll send a recovery link.">
    {!enabled && <UnavailableNotice />}
    <AuthForm mode="forgot" enabled={enabled} />
    <p className="auth-links"><Link href="/login/student">Back to sign in</Link></p>
  </AuthShell>;
}
