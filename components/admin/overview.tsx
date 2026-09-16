import Link from "next/link";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function AdminOverview() {
  const account = await requireAdminArea("overview"); const db = await createSupabaseServerClient();
  const superAdmin = account.roles.includes("super_admin");
  const users = superAdmin || account.roles.includes("system_admin");
  const academics = superAdmin || account.roles.includes("academic_admin");
  const metrics: { label: string; value: number | null; href: string }[] = [];
  if (users) {
    const [profiles,requests] = await Promise.all([db.from("profiles").select("id", { count: "exact", head: true }), db.from("staff_access_requests").select("id", { count: "exact", head: true }).eq("status","pending")]);
    metrics.push({ label: "Accounts", value: profiles.error ? null : profiles.count, href: "/portal/admin/users" }, { label: "Pending access requests", value: requests.error ? null : requests.count, href: "/portal/staff" });
  }
  if (academics) {
    const [applications,library] = await Promise.all([db.from("applications").select("id", { count: "exact", head: true }).in("status",["submitted","under_review"]),db.from("library_resources").select("id", { count: "exact", head: true }).eq("status","published")]);
    metrics.push({ label: "Applications awaiting review", value: applications.error ? null : applications.count, href: "/portal/applications" }, { label: "Published library resources", value: library.error ? null : library.count, href: "/portal/admin/library" });
  }
  const links = [
    ...(users ? [{ href: "/portal/admin/users", title: "User management", description: "Find accounts, inspect roles, suspend and restore access." }, { href: "/portal/staff", title: "Staff access approvals", description: "Request and approve staff role grants and removals." }] : []),
    ...(academics ? [{ href: "/portal/applications", title: "Admissions", description: "Review applications and approve admissions decisions." }, { href: "/portal/academics", title: "Academic configuration", description: "Manage universities, programmes, intakes, courses and admissions settings." }, { href: "/portal/admin/enrolments", title: "Course enrolments", description: "Activate approved students, withdraw or complete registrations." }, { href: "/portal/admin/library", title: "Library management", description: "Upload materials, paste notes, preview and publish for students." }] : []),
    ...(superAdmin ? [{ href: "/portal/admin/settings", title: "Organisation settings", description: "Manage your organisation name, support contact and check integration configuration." }, { href: "/portal/admin/audit", title: "Audit history", description: "Inspect who changed records, when, and why." }, { href: "/portal/admin/notifications", title: "Email delivery queue", description: "Monitor queued, sent and review-required notifications." }] : []),
  ];
  return <main className="account-content"><span className="eyebrow">Administration</span><h1>Welcome, {account.fullName}.</h1><p>Manage Summit ScholarsBridge from one place.</p><div className="admin-metrics">{metrics.map(metric => <Link className="account-panel" key={metric.label} href={metric.href}><strong>{metric.value ?? "Unavailable"}</strong><span>{metric.label}</span></Link>)}</div>
    {metrics.some(metric=>metric.value===null) && <p role="status">Some data is unavailable. Check the connection and apply the Admin and Library database migration.</p>}
    <div className="workspace-grid">{links.map(link => <Link className="account-panel" key={link.href} href={link.href}><h2>{link.title}</h2><p>{link.description}</p><span>Open section</span></Link>)}</div>
  </main>;
}
