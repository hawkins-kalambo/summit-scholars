"use client";
import { useActionState } from "react";
import { requestApplicationAccess, type ApplyState } from "./actions";

export function ApplyFlow() {
  const [state, action, pending] = useActionState<ApplyState, FormData>(requestApplicationAccess, {});
  return <form action={action} className="auth-form">
    <fieldset disabled={pending}>
      {!state.email
        ? <label htmlFor="email">Email address<input id="email" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
        : <label htmlFor="code">6-digit code<input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus/>
          <small>Sent to {state.email}.</small></label>}
      <button className="btn teal" type="submit">{pending ? "Please wait…" : state.email ? "Verify and continue" : "Send code"}</button>
    </fieldset>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.success && <p className="form-success" role="status">{state.success}</p>}
  </form>;
}
