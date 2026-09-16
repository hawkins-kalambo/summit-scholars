import Link from "next/link";
import { requireAdmissionsAccount } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Application } from "@/lib/admissions/validation";

export const dynamic = "force-dynamic";
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const account = await requireAdmissionsAccount();
  const query = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const db = await createSupabaseServerClient();
  const { data, error, count } = await db.from("applications").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page-1)*20, page*20-1);
  if (error) throw new Error("We could not load applications. Please try again.");
  const applications = data as Application[];
  const staff = account.status === "active" && account.roles.some(role => ["super_admin", "academic_admin", "admissions_officer", "auditor"].includes(role));
  return <main className="account-content"><div className="section-title"><div><span className="eyebrow">Admissions</span><h1>{staff ? "Applications" : "My applications"}</h1></div>
    {account.roles.includes("student") && <Link className="btn teal" href="/portal/applications/new">Start an application</Link>}</div>
    <p>{staff ? "Open an application to review its details, documents and history." : "Save a draft, add supporting documents and track your admission decision."}</p>
    {applications.length === 0 ? <section className="account-panel"><h2>No applications yet</h2><p>Your applications will appear here.</p></section>
      : <div className="record-list">{applications.map(application => <Link className="account-panel" key={application.id} href={"/portal/applications/" + application.id}><div className="section-title"><h2>{application.full_name}</h2><span className="status-badge">{application.status.replaceAll("_"," ")}</span></div><p>{new Date(application.created_at).toLocaleDateString("en-GB")} · {application.learning_mode === "online" ? "Online" : "Face-to-face"}</p><span>View application →</span></Link>)}</div>}
    <nav className="pagination-links" aria-label="Application pages">{page > 1 && <Link href={"/portal/applications?page=" + (page-1)}>Previous</Link>}<span>Page {page}</span>{page*20 < (count ?? 0) && <Link href={"/portal/applications?page=" + (page+1)}>Next</Link>}</nav>
  </main>;
}
