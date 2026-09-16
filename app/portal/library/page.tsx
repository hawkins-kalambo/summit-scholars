import Link from "next/link";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pageNumber } from "@/lib/admin/access";
import { categories } from "@/lib/library/validation";
export const dynamic = "force-dynamic";
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const account = await requireAccount(); const params = await searchParams; const page = pageNumber(params.page);
  const category = typeof params.category === "string" && Object.hasOwn(categories,params.category) ? params.category : "";
  const q = typeof params.q === "string" ? params.q.slice(0,100) : "";
  const db = await createSupabaseServerClient();
  let query = db.from("library_resources").select("id,title,description,category,audience", { count: "exact" }).eq("status","published").order("created_at", { ascending: false }).order("id").range((page-1)*20,page*20-1);
  if (category) query = query.eq("category",category); if (q) query = query.ilike("title","%"+q+"%");
  const { data,error,count } = await query; if (error) throw new Error("The library is temporarily unavailable.");
  const link = (n: number) => "/portal/library?" + new URLSearchParams({ q, category, page: String(n) });
  return <main className="account-content"><Link href="/portal">Portal home</Link><h1>Student library</h1><p>Read past papers, notes and study materials in your portal.</p>
    {!account.studentNumber && !account.roles.some(role => ["super_admin","academic_admin"].includes(role)) && <p>Library access becomes available after your admission is approved.</p>}
    <form className="admin-search"><label>Search title<input name="q" defaultValue={q} maxLength={100}/></label><label>Category<select name="category" defaultValue={category}><option value="">All materials</option>{Object.entries(categories).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="btn teal">Search</button></form>
    <div className="workspace-grid">{data?.map(resource => <Link className="account-panel" key={resource.id} href={"/portal/library/"+resource.id}><span className="eyebrow">{categories[resource.category as keyof typeof categories]}</span><h2>{resource.title}</h2><p>{resource.description}</p><span>Read in portal</span></Link>)}</div>
    {!data?.length && <p>No materials available for your account with these filters.</p>}
    <nav className="pagination" aria-label="Library pages">{page>1 && <Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{(count ?? 0)>page*20 && <Link href={link(page+1)}>Next</Link>}</nav>
  </main>;
}
