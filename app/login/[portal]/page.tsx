import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell, UnavailableNotice } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { supabaseConfig } from "@/lib/supabase/config";
import { isPortal, portalLabels } from "@/lib/auth/portals";
export const dynamic = "force-dynamic";
export default async function PortalLogin({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!isPortal(portal)) notFound();
  const enabled = Boolean(supabaseConfig());
  return <AuthShell portal={portal} title={portalLabels[portal] + " sign in"} description={portal === "student" ? "Sign in to apply and access your student account." : "Sign in with your assigned " + (portal === "admin" ? "administrator" : "staff or tutor") + " account."}>
    {!enabled && <UnavailableNotice />}
    <AuthForm mode="login" enabled={enabled} portal={portal} />
    <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link>{portal === "student" && <Link href="/register">Create a student account</Link>}</div>
    <p className="auth-links"><Link href="/login">Choose a different portal</Link></p>
  </AuthShell>;
}
