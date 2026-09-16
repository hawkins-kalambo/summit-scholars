import { AdminOverview } from "@/components/admin/overview";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { isPortal, canEnterPortal, portalLabels, portalRoles } from "@/lib/auth/portals";
import { roleLabels } from "@/lib/auth/roles";
export const dynamic = "force-dynamic";
export default async function PortalHome({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!isPortal(portal)) notFound();
  const account = await requireAccount("/login/" + portal);
  if (!canEnterPortal(account.roles, account.status, portal)) redirect("/portal");
  if (portal === "admin") return <AdminOverview />;
  const academic = account.roles.some(role => ["super_admin", "academic_admin"].includes(role));
  const access = account.roles.some(role => ["super_admin", "system_admin", "auditor"].includes(role));
  return <main className="account-content"><span className="eyebrow">{portalLabels[portal]} portal</span><h1>Welcome, {account.fullName}.</h1><p>{account.user.email}</p>
    {portal === "student" ? <section className="account-panel"><h2>{account.studentNumber ? "Your student account" : "Your application"}</h2>{account.studentNumber && <p>Student number: {account.studentNumber}</p>}<p>Prepare your application, upload documents and track your admission decision.</p><Link className="btn teal" href="/portal/applications">My applications</Link><p><Link className="btn outline-dark" href="/portal/library">Open student library</Link></p></section> : <>
      <div className="workspace-grid">{account.roles.filter(role => portalRoles[portal].includes(role)).map(role => <Link className="account-panel" key={role} href={"/portal/" + role}><h2>{roleLabels[role]}</h2><p>Open your workspace</p></Link>)}</div>
      {academic && <p><Link className="btn teal" href="/portal/academics">Academic configuration</Link></p>}
      {access && <p><Link className="btn outline-dark" href="/portal/staff">Staff access management</Link></p>}
    </>}
  </main>;
}
