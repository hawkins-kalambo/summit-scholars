import type { ReactNode } from "react";
import { requireAccount } from "@/lib/auth/session";
import { portals, portalLabels, canEnterPortal } from "@/lib/auth/portals";
import { roleLabels } from "@/lib/auth/roles";
import { MFA_REQUIRED_ROLES } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PortalShell, type NavGroup } from "@/components/portal/shell";
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const active = account.status === "active";
  const db = await createSupabaseServerClient();
  const { data: organisation } = await db.from("organisation_settings").select("support_email").single();
  const supportEmail = organisation?.support_email ?? "summitscholarsbridge@gmail.com";
  const has = (roles: readonly string[]) => active && account.roles.some(role => roles.includes(role));
  const academic = has(["super_admin", "academic_admin"]);
  const userManagement = has(["super_admin", "system_admin"]);
  const superAdmin = has(["super_admin"]);
  const auditAccess = has(["super_admin", "auditor"]);
  const staffAccess = has(["super_admin", "system_admin", "auditor"]);
  const tutorApplications = academic || has(["system_admin"]);
  const navGroups: NavGroup[] = [
    { label: "Workspace", items: [
      ...portals.filter(portal => canEnterPortal(account.roles, account.status, portal)).map(portal => ({ href: "/portal/home/" + portal, label: portalLabels[portal] + " portal", icon: "home" as const })),
      { href: "/portal/profile", label: "My profile", icon: "profile" as const },
      { href: "/portal/applications", label: "Applications", icon: "applications" as const },
      ...(account.roles.includes("student") ? [{ href: "/portal/library", label: "Library", icon: "library" as const }] : []),
      ...(active && account.roles.includes("tutor") ? [{ href: "/portal/tutor", label: "Tutor workspace", icon: "tutor" as const }] : []),
    ] },
    { label: "Academics", items: academic ? [
      { href: "/portal/academics", label: "Academic configuration", icon: "academics" as const },
      { href: "/portal/admin/enrolments", label: "Course enrolments", icon: "enrolments" as const },
      { href: "/portal/admin/library", label: "Manage library", icon: "manageLibrary" as const },
      { href: "/portal/admin/attendance-risk", label: "Attendance risk", icon: "attendanceRisk" as const },
    ] : [] },
    { label: "Tutor recruitment", items: tutorApplications ? [{ href: "/portal/tutor-applications", label: "Tutor applications", icon: "recruitment" as const }] : [] },
    { label: "Finance", items: has(["finance_officer", "finance_administrator"]) ? [{ href: "/portal/finance", label: "Finance", icon: "finance" as const }] : [] },
    { label: "People & access", items: [
      ...(staffAccess ? [{ href: "/portal/staff", label: "Staff access management", icon: "staff" as const }] : []),
      ...(userManagement ? [{ href: "/portal/admin/users", label: "User management", icon: "users" as const }, { href: "/portal/admin/universities", label: "Universities", icon: "universities" as const }] : []),
    ] },
    { label: "Administration", items: [
      ...(superAdmin ? [{ href: "/portal/admin/settings", label: "Organisation settings", icon: "settings" as const }, { href: "/portal/admin/notifications", label: "Email delivery queue", icon: "notifications" as const }] : []),
      ...(auditAccess ? [{ href: "/portal/admin/audit", label: "Audit history", icon: "audit" as const }] : []),
    ] },
    { label: "Security", items: has(MFA_REQUIRED_ROLES) ? [{ href: "/mfa-setup", label: "Two-factor authentication", icon: "security" as const }] : [] },
  ];
  const roleLine = account.roles.length ? account.roles.map(role => roleLabels[role]).join(" · ") : "No roles assigned";
  return <PortalShell navGroups={navGroups} fullName={account.fullName} roleLine={roleLine}>
    {account.status === "suspended"
      ? <main className="account-content"><h1>Account access paused</h1><p>Please contact support to discuss your account.</p><a href={"mailto:" + supportEmail}>Contact support</a></main>
      : children}
  </PortalShell>;
}
