import Link from "next/link";
import type { ReactNode } from "react";
import { requireAccount } from "@/lib/auth/session";
import { portals, portalLabels, canEnterPortal } from "@/lib/auth/portals";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const db = await createSupabaseServerClient();
  const { data: organisation } = await db.from("organisation_settings").select("organisation_name,support_email").single();
  const supportEmail = organisation?.support_email ?? "summitscholarsbridge@gmail.com";
  const academic = account.status==="active" && account.roles.some(role => ["super_admin","academic_admin"].includes(role));
  return <div className="account-page">
    <header className="account-header"><Link href="/">▲ {organisation?.organisation_name ?? "Summit ScholarsBridge"}</Link><form action={signOut}><button className="btn outline-dark">Sign out</button></form></header>
    <nav className="account-navigation" aria-label="Account navigation">{portals.filter(portal => canEnterPortal(account.roles, account.status, portal)).map(portal => <Link key={portal} href={"/portal/home/" + portal}>{portalLabels[portal]} portal</Link>)}<Link href="/portal/applications">Applications</Link>{academic && <Link href="/portal/academics">Academic configuration</Link>}{account.status === "active" && account.roles.some(role => ["super_admin", "system_admin", "auditor"].includes(role)) && <Link href="/portal/staff">Staff access management</Link>}{account.roles.includes("student") && <Link href="/portal/library">Library</Link>}{academic && <Link href="/portal/admin/library">Manage library</Link>}{account.status === "active" && account.roles.some(role => ["super_admin", "auditor"].includes(role)) && <Link href="/portal/admin/audit">Audit history</Link>}</nav>
    {account.status === "suspended"
      ? <main className="account-content"><h1>Account access paused</h1><p>Please contact support to discuss your account.</p><a href={"mailto:" + supportEmail}>Contact support</a></main>
      : children}
  </div>;
}
