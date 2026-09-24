import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ChallengeForm } from "./challenge-form";
export const dynamic = "force-dynamic";
export default async function MfaChallengePage() {
  await requireAccount("/login", { enforceMfa: false });
  const db = await createSupabaseServerClient();
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel === "aal2" || aal.nextLevel !== "aal2") redirect("/portal");
  const { data: factors } = await db.auth.mfa.listFactors();
  const factor = factors?.totp.find(candidate => candidate.status === "verified");
  if (!factor) redirect("/mfa-setup");
  return <AuthShell title="Verify it&rsquo;s you" description="Enter the 6-digit code from your authenticator app.">
    <ChallengeForm factorId={factor.id}/>
  </AuthShell>;
}
