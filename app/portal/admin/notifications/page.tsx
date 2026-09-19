import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminArea, pageNumber } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
type Row = { id: string; subject: string; status: string; attempts: number; created_at: string; total_count: number };
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const account = await requireAdminArea("overview"); if (!account.roles.includes("super_admin")) redirect("/portal");
  const page = pageNumber((await searchParams).page); const db = await createSupabaseServerClient(); const { data,error } = await db.rpc("admin_notifications", { p_page: page });
  if (error) throw new Error("Email queue unavailable. Check the Admin and Library migration."); const rows = (data ?? []) as Row[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Administration</span><h1>Email delivery queue</h1><p>Notifications are sent by the scheduled dispatcher. Items requiring review must be checked against Resend delivery records before retrying.</p></div></div>
    {!rows.length && <p>No email notifications on this page.</p>}{rows.map(row=><section className="account-panel" key={row.id}><h2>{row.subject}</h2><p>{row.status.replaceAll("_"," ")} · {row.attempts} attempts</p><p>Reference: {row.id}</p><p>{new Date(row.created_at).toLocaleString("en-GB",{timeZone:"Africa/Blantyre"})}</p></section>)}
    <nav className="pagination" aria-label="Notification pages">{page>1 && <Link href={"?page="+(page-1)}>Previous</Link>}<span>Page {page}</span>{Number(rows[0]?.total_count ?? 0)>page*25 && <Link href={"?page="+(page+1)}>Next</Link>}</nav>
  </div>;
}
