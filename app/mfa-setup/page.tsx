import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { EnrollmentFlow } from "./enrollment-flow";
import { unenrollMfa } from "./actions";
export const dynamic = "force-dynamic";
export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccount("/login", { enforceMfa: false });
  const params = await searchParams;
  const db = await createSupabaseServerClient();
  const { data: factors } = await db.auth.mfa.listFactors();
  const verifiedFactor = factors?.totp?.find(factor => factor.status === "verified");
  const required = params.required === "1";
  return <main className="account-content narrow-content">
    <h1>Two-factor authentication</h1>
    {required && !verifiedFactor && <p className="form-notice" role="status">Your role requires two-factor authentication. Set it up below to continue.</p>}
    {verifiedFactor ? <section className="account-panel">
      <h2>Enabled</h2>
      <p>Two-factor authentication is active on your account. Enter a current code to remove it.</p>
      <ManagedForm action={unenrollMfa} label="Remove two-factor authentication">
        <input type="hidden" name="factorId" value={verifiedFactor.id}/>
        <label>Authentication code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></label>
      </ManagedForm>
    </section> : <section className="account-panel">
      <h2>Set up an authenticator app</h2>
      <p>Use an app like Google Authenticator, Authy or 1Password to scan the code and generate 6-digit verification codes.</p>
      <EnrollmentFlow/>
    </section>}
  </main>;
}
