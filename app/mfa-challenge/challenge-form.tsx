"use client";
import { useActionState } from "react";
import { verifyMfaChallenge } from "./actions";
import type { AuthResult } from "@/lib/auth/validation";

export function ChallengeForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState<AuthResult, FormData>(verifyMfaChallenge, {});
  return <form action={action} className="auth-form">
    <fieldset disabled={pending}>
      <input type="hidden" name="factorId" value={factorId}/>
      <label>Authentication code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus/></label>
      <button className="btn teal" type="submit">{pending ? "Verifying…" : "Verify"}</button>
    </fieldset>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
  </form>;
}
