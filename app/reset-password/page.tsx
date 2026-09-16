import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { requireAccount } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export default async function ResetPasswordPage() {
  await requireAccount();
  return <AuthShell title="Choose a new password" description="Set a strong password for your account.">
    <AuthForm mode="reset" enabled />
  </AuthShell>;
}
