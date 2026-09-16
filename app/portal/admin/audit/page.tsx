import Link from "next/link";
import { requireAdminArea, pageNumber } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminArea("audit"); const params = await searchParams; const page = pageNumber(params.page);
  const table = typeof params.table === "string" && /^[a-z_]{1,60}$/.test(params.table) ? params.table : "";
  const db = await createSupabaseServerClient();
  let query = db.from("audit_events").select("id,actor_id,action,table_name,record_id,reason,previous_value,new_value,created_at", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page-1)*25,page*25-1);
  if (table) query = query.eq("table_name",table);
  const { data, error, count } = await query; if (error) throw new Error("Audit history could not be loaded.");
  const link = (n: number) => "/portal/admin/audit?" + new URLSearchParams({ table, page: String(n) });
  return <main className="account-content"><Link href="/portal">Portal home</Link><h1>Audit history</h1><p>Read-only records of account, academic, admissions and library changes.</p><form className="admin-search"><label>Table name<input name="table" defaultValue={table} placeholder="library_resources" pattern="[a-z_]*"/></label><button className="btn teal">Filter</button></form>
    {!data?.length && <p>No matching events.</p>}{data?.map(event => <details className="account-panel" key={event.id}><summary>{event.action} ? {event.table_name} ? {new Date(event.created_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}</summary><p>Actor: {event.actor_id ?? "Database setup / system"}</p><p>Record: {event.record_id}</p><p>Reason: {event.reason ?? "Not recorded"}</p><h3>Before</h3><pre className="audit-json">{JSON.stringify(event.previous_value,null,2)}</pre><h3>After</h3><pre className="audit-json">{JSON.stringify(event.new_value,null,2)}</pre></details>)}
    <nav className="pagination" aria-label="Audit pages">{page>1 && <Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{(count ?? 0)>page*25 && <Link href={link(page+1)}>Next</Link>}</nav>
  </main>;
}
