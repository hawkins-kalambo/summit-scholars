import Link from "next/link";
import { AuthShell, UnavailableNotice } from "@/components/auth/auth-shell";
import { ApplyFlow } from "./apply-flow";
import { supabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export default function ApplyPage() {
  const enabled = Boolean(supabaseConfig() && process.env.APP_URL);
  return <AuthShell portal="student" title="Start your application" description="Enter your email to begin — no password needed yet. If you're admitted, we'll email you a link to set one up.">
    {!enabled && <UnavailableNotice />}
    {enabled && <ApplyFlow/>}
    <p className="auth-links">Already have a password? <Link href="/login/student">Sign in</Link></p>
  </AuthShell>;
}
