import type { ReactNode } from "react";
import { requireAccount } from "@/lib/auth/session";
import { portals, portalLabels, canEnterPortal } from "@/lib/auth/portals";
import { roleLabels } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PortalShell, type NavItem } from "@/components/portal/shell";
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const db = await createSupabaseServerClient();
  const { data: organisation } = await db.from("organisation_settings").select("support_email").single();
  const supportEmail = organisation?.support_email ?? "summitscholarsbridge@gmail.com";
  const active = account.status === "active";
  const has = (roles: string[]) => active && account.roles.some(role => roles.includes(role));
  const academic = has(["super_admin", "academic_admin"]);
  const userManagement = has(["super_admin", "system_admin"]);
  const superAdmin = has(["super_admin"]);
  const auditAccess = has(["super_admin", "auditor"]);
  const staffAccess = has(["super_admin", "system_admin", "auditor"]);
  const navItems: NavItem[] = [
    ...portals.filter(portal => canEnterPortal(account.roles, account.status, portal)).map(portal => ({ href: "/portal/home/" + portal, label: portalLabels[portal] + " portal", icon: "home" as const })),
    { href: "/portal/profile", label: "My profile", icon: "profile" },
    { href: "/portal/applications", label: "Applications", icon: "applications" },
    ...(academic ? [{ href: "/portal/academics", label: "Academic configuration", icon: "academics" as const }, { href: "/portal/admin/enrolments", label: "Course enrolments", icon: "enrolments" as const }, { href: "/portal/admin/library", label: "Manage library", icon: "manageLibrary" as const }] : []),
    ...(account.roles.includes("student") ? [{ href: "/portal/library", label: "Library", icon: "library" as const }] : []),
    ...(staffAccess ? [{ href: "/portal/staff", label: "Staff access management", icon: "staff" as const }] : []),
    ...(userManagement ? [{ href: "/portal/admin/users", label: "User management", icon: "users" as const }, { href: "/portal/admin/universities", label: "Universities", icon: "universities" as const }] : []),
    ...(superAdmin ? [{ href: "/portal/admin/settings", label: "Organisation settings", icon: "settings" as const }, { href: "/portal/admin/notifications", label: "Email delivery queue", icon: "notifications" as const }] : []),
    ...(auditAccess ? [{ href: "/portal/admin/audit", label: "Audit history", icon: "audit" as const }] : []),
  ];
  const roleLine = account.roles.length ? account.roles.map(role => roleLabels[role]).join(" · ") : "No roles assigned";
  return <PortalShell navItems={navItems} fullName={account.fullName} roleLine={roleLine}>
    {account.status === "suspended"
      ? <main className="account-content"><h1>Account access paused</h1><p>Please contact support to discuss your account.</p><a href={"mailto:" + supportEmail}>Contact support</a></main>
      : children}
  </PortalShell>;
}
