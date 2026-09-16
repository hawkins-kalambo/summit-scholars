"use client";
import { useActionState, type ReactNode } from "react";
import type { FormResult } from "@/lib/admissions/validation";
export function ManagedForm({ action, children, label, disabled = false }: {
 action: (previous: FormResult, form: FormData) => Promise<FormResult>; children: ReactNode; label: string; disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="auth-form">
    <fieldset disabled={pending || disabled}>{children}<button className="btn teal" type="submit">{pending ? "Saving…" : label}</button></fieldset>
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
    {state.success && <p role="status" className="form-success">{state.success}</p>}
  </form>;
}
