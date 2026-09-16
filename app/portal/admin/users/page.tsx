import Link from "next/link";
import { requireAdminArea, pageNumber } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { roleLabels, type Role } from "@/lib/auth/roles";
import { changeStatus } from "./actions";
export const dynamic = "force-dynamic";
type Row = { id: string; full_name: string; email: string; account_status: string; student_number: string | null; roles: Role[]; total_count: number };
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requireAdminArea("users"); const params = await searchParams;
  const page = pageNumber(params.page); const q = typeof params.q === "string" ? params.q.slice(0,100) : "";
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("admin_directory", { p_search: q, p_page: page });
  if (error) throw new Error("Account directory unavailable. Check that the Admin and Library migration is applied.");
  const rows = (data ?? []) as Row[];
  const link = (n: number) => "/portal/admin/users?" + new URLSearchParams({ q, page: String(n) });
  return <main className="account-content"><Link href="/portal/home/admin">Admin overview</Link><h1>User management</h1><p>Search accounts, inspect assigned roles, and suspend or restore access. Restoring an applicant does not approve their admission.</p>
    <form className="admin-search"><label>Search name or email<input name="q" defaultValue={q} maxLength={100}/></label><button className="btn teal">Search</button></form>
    <p><Link href="/portal/staff">Request or approve staff role changes</Link></p>
    {rows.length === 0 && <p>No matching accounts on this page.</p>}
    {rows.map(row => <section className="account-panel" key={row.id}><h2>{row.full_name}</h2><p>{row.email} ? {row.account_status}</p><p>{row.roles.map(role => roleLabels[role]).join(", ")}</p>{row.student_number && <p>Student number: {row.student_number}</p>}
      {row.id !== account.user.id && (!row.roles.some(role => ["system_admin","super_admin"].includes(role)) || account.roles.includes("super_admin")) && <details><summary>{row.account_status === "suspended" ? "Restore account access" : "Suspend account access"}</summary><ManagedForm action={changeStatus} label={row.account_status === "suspended" ? "Restore access" : "Suspend access"}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="action" value={row.account_status === "suspended" ? "restore" : "suspend"}/><label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label></ManagedForm></details>}
    </section>)}
    <nav className="pagination" aria-label="Account pages">{page>1 && <Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{Number(rows[0]?.total_count ?? 0)>page*25 && <Link href={link(page+1)}>Next</Link>}</nav>
  </main>;
}
