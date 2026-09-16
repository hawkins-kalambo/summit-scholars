import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { defaultPortal } from "@/lib/auth/portals";
export const dynamic = "force-dynamic";
export default async function PortalPage() {
  const account = await requireAccount();
  const portal = defaultPortal(account.roles, account.status);
  if (portal) redirect("/portal/home/" + portal);
  return <main className="account-content"><h1>Account access unavailable</h1><p>Contact support to check your account status and assigned roles.</p></main>;
}
