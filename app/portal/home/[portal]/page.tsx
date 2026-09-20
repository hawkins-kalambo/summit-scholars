import { AdminOverview } from "@/components/admin/overview";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GraduationCap, BookOpen, ShieldCheck, ArrowRight, CalendarClock, Wallet } from "lucide-react";
import { requireAccount } from "@/lib/auth/session";
import { isPortal, canEnterPortal, portalLabels, portalRoles } from "@/lib/auth/portals";
import { roleLabels } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function PortalHome({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!isPortal(portal)) notFound();
  const account = await requireAccount("/login/" + portal);
  if (!canEnterPortal(account.roles, account.status, portal)) redirect("/portal");
  if (portal === "admin") return <AdminOverview />;
  if (portal === "finance") redirect("/portal/finance");
  const academic = account.roles.some(role => ["super_admin", "academic_admin"].includes(role));
  const access = account.roles.some(role => ["super_admin", "system_admin", "auditor"].includes(role));
  const title = <div className="dash-title"><div><span className="eyebrow">{portalLabels[portal]} portal</span><h1>Welcome, {account.fullName}.</h1><p>{account.user.email}</p></div></div>;

  if (portal === "student") {
    const db = await createSupabaseServerClient();
    const [enrolmentsResult, nextSessionResult, invoicesResult] = await Promise.all([
      account.studentNumber ? db.from("enrolments").select("status,courses(name,code)").eq("student_id", account.user.id).order("created_at") : Promise.resolve({ data: null }),
      account.studentNumber ? db.from("class_sessions").select("topic,venue,starts_at,meeting_link,courses(name)").eq("status", "scheduled").gt("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle() : Promise.resolve({ data: null }),
      account.studentNumber ? db.from("invoices").select("reference,total_amount,balance_amount,status,created_at").eq("student_id", account.user.id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    ]);
    const enrolments = (enrolmentsResult.data ?? []) as unknown as { status: string; courses: { name: string; code: string } | null }[];
    const nextSession = nextSessionResult.data as unknown as { topic: string; venue: string; starts_at: string; meeting_link: string | null; courses: { name: string } | null } | null;
    const invoices = (invoicesResult.data ?? []) as { reference: string; total_amount: number; balance_amount: number; status: string; created_at: string }[];
    const totalBalance = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_amount), 0);
    return <div className="dash">{title}
      <div className="stats">
        <div className="stat green"><i><GraduationCap size={21}/></i><div><strong>{account.studentNumber ?? "Pending"}</strong><span>Student number</span></div></div>
        <div className="stat"><i><BookOpen size={21}/></i><div><strong>{enrolments.length}</strong><span>Enrolled courses</span></div></div>
        <div className="stat gold"><i><ShieldCheck size={21}/></i><div><strong>{account.status === "active" ? "Active" : "Pending"}</strong><span>Account status</span></div></div>
        <div className="stat"><i><CalendarClock size={21}/></i><div><strong>{nextSession ? new Date(nextSession.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "None"}</strong><span>Next class</span></div></div>
        <div className="stat gold"><i><Wallet size={21}/></i><div><strong>MWK {totalBalance.toLocaleString("en-GB")}</strong><span>Balance due</span></div></div>
      </div>
      <div className="dashgrid">
        <div className="panel"><header><h2>Your courses</h2></header>
          {enrolments.length ? <div className="rows">{enrolments.map((enrolment, index) => <div key={index}><span>{enrolment.courses?.code ?? "—"}</span><span>{enrolment.courses?.name ?? "Unknown course"}</span><span>{enrolment.status}</span><span/></div>)}</div>
            : <p>No course registrations yet. Prepare your application to get started.</p>}
          <p><small>Assignments and results are not yet available and will appear here as those features launch.</small></p>
        </div>
        <div className="panel"><header><h2>Next class</h2></header>
          {nextSession ? <p>{nextSession.courses?.name ?? "Class"} · {nextSession.topic}<br/>{nextSession.venue} · {new Date(nextSession.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}{nextSession.meeting_link && <><br/><a href={nextSession.meeting_link} target="_blank" rel="noreferrer">Join meeting</a></>}</p> : <p>No upcoming classes scheduled.</p>}
        </div>
        <div className="panel"><header><h2>Billing</h2></header>
          {invoices.length ? <div className="rows">{invoices.map((invoice, index) => <div key={index}><span>{invoice.reference}</span><span>MWK {Number(invoice.total_amount).toLocaleString("en-GB")}</span><span>{invoice.status.replaceAll("_", " ")}</span><span>MWK {Number(invoice.balance_amount).toLocaleString("en-GB")} due</span></div>)}</div>
            : <p>No invoices yet.</p>}
        </div>
        <div className="panel"><header><h2>Quick actions</h2></header>
          <div className="quick">
            <Link href="/portal/applications"><span>My applications</span><ArrowRight size={16}/></Link>
            <Link href="/portal/library"><span>Student library</span><ArrowRight size={16}/></Link>
            <Link href="/portal/profile"><span>My profile</span><ArrowRight size={16}/></Link>
          </div>
        </div>
      </div>
    </div>;
  }
  return <div className="dash">{title}
    <div className="dashgrid">
      <div className="panel"><header><h2>Your workspaces</h2></header>
        <div className="workspace-grid">{account.roles.filter(role => portalRoles[portal].includes(role)).map(role => <Link className="account-panel" key={role} href={"/portal/" + role}><h2>{roleLabels[role]}</h2><p>Open your workspace</p></Link>)}</div>
      </div>
      {(academic || access) && <div className="panel"><header><h2>Quick actions</h2></header>
        <div className="quick">
          {academic && <Link href="/portal/academics"><span>Academic configuration</span><ArrowRight size={16}/></Link>}
          {access && <Link href="/portal/staff"><span>Staff access management</span><ArrowRight size={16}/></Link>}
        </div>
      </div>}
    </div>
  </div>;
}
