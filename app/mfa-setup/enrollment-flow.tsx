"use client";
import { useActionState } from "react";
import { manageMfaEnrollment, type MfaEnrollState } from "./actions";

export function EnrollmentFlow() {
  const [state, action, pending] = useActionState<MfaEnrollState, FormData>(manageMfaEnrollment, {});
  if (state.success) return <p className="form-success" role="status">{state.success}</p>;
  return <form action={action} className="auth-form">
    <fieldset disabled={pending}>
      {state.factorId && <input type="hidden" name="factorId" value={state.factorId}/>}
      {state.qrCode && <div>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI QR code, not an optimizable remote image */}
        <img src={state.qrCode} alt="Scan this QR code with your authenticator app" width={200} height={200}/>
        <p><small>Or enter this key manually: <code>{state.secret}</code></small></p>
      </div>}
      {state.factorId && <label>Enter the 6-digit code<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus/></label>}
      <button className="btn teal" type="submit">{pending ? "Please wait…" : state.factorId ? "Verify and enable" : "Start setup"}</button>
    </fieldset>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
  </form>;
}
