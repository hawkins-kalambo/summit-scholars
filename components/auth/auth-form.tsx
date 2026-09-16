"use client";

import { useActionState } from "react";
import { login, register, requestPasswordReset, resetPassword } from "@/app/auth/actions";
import type { AuthResult } from "@/lib/auth/validation";

import type { Portal } from "@/lib/auth/portals";

type Mode = "login" | "register" | "forgot" | "reset";
const actions = { login, register, forgot: requestPasswordReset, reset: resetPassword };
const labels = { login: "Sign in", register: "Create account", forgot: "Send reset link", reset: "Save new password" };

export function AuthForm({ mode, enabled, portal }: { mode: Mode; enabled: boolean; portal?: Portal }) {
  const [state, action, pending] = useActionState<AuthResult, FormData>(actions[mode], {});
  return <form action={action} className="auth-form">
    <fieldset disabled={pending || !enabled}>
      {mode === "login" && <input type="hidden" name="portal" value={portal ?? "student"} />}
      {mode === "register" && <label htmlFor="fullName">Full name
        <input id="fullName" name="fullName" autoComplete="name" required minLength={2} maxLength={120} />
      </label>}
      {mode !== "reset" && <label htmlFor="email">Email address
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>}
      {mode !== "forgot" && <label htmlFor="password">{mode === "reset" ? "New password" : "Password"}
        <input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={128} aria-describedby={mode === "login" ? undefined : "password-help"} />
        {mode !== "login" && <small id="password-help">Use at least 12 characters.</small>}
      </label>}
      <button className="btn teal" type="submit">{pending ? "Please wait…" : labels[mode]}</button>
    </fieldset>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.success && <p className="form-success" role="status">{state.success}</p>}
  </form>;
}
