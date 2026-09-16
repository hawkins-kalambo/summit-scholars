import Link from "next/link";
import { requireAdminArea, pageNumber } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { categories } from "@/lib/library/validation";
import { saveResource, publishResource } from "./actions";
export const dynamic = "force-dynamic";
type Resource = { id: string; title: string; description: string; category: keyof typeof categories; course_id: string | null; audience: string; content_text: string | null; object_path: string | null; status: string; revision: number };
function ResourceForm({ courses, resource }: { courses: { id: string; name: string }[]; resource?: Resource }) {
  return <ManagedForm action={saveResource} label={resource ? "Save changes as draft" : "Save draft"}>
    <input type="hidden" name="id" value={resource?.id ?? ""}/><input type="hidden" name="revision" value={resource?.revision ?? 0}/>
    <label>Title<input name="title" required minLength={2} maxLength={200} defaultValue={resource?.title}/></label>
    <label>Description<textarea name="description" maxLength={2000} defaultValue={resource?.description ?? ""}/></label>
    <label>Category<select name="category" defaultValue={resource?.category ?? "study_notes"}>{Object.entries(categories).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Course<select name="course_id" defaultValue={resource?.course_id ?? ""}><option value="">General library</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
    <label>Student access<select name="audience" defaultValue={resource?.audience ?? "all_students"}><option value="all_students">All approved students</option><option value="course_students">Active enrolments in the selected course</option></select></label>
    {!resource && <label>Upload PDF or image (maximum 10 MiB)<input name="file" type="file" accept="application/pdf,image/png,image/jpeg"/></label>}
    {!resource?.object_path ? <label>{resource ? "Study notes" : "Or paste study notes"}<textarea name="content_text" rows={8} maxLength={100000} defaultValue={resource?.content_text ?? ""}/></label> : <><input type="hidden" name="content_text" value=""/><p>To replace this file, create a new resource and archive this version.</p></>}
    <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
  </ManagedForm>;
}
export default async function LibraryAdmin({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requireAdminArea("library"); const params = await searchParams; const page = pageNumber(params.page);
  const status = ["draft","published","archived"].includes(String(params.status)) ? String(params.status) : "";
  const db = await createSupabaseServerClient();
  let query = db.from("library_resources").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page-1)*20,page*20-1);
  if (status) query = query.eq("status",status);
  const [resources,courses] = await Promise.all([query,db.from("courses").select("id,name").order("name")]);
  if (resources.error || courses.error) throw new Error("Library management unavailable. Apply the Admin and Library migration first.");
  const link = (n: number) => "/portal/admin/library?" + new URLSearchParams({ status, page: String(n) });
  return <main className="account-content"><Link href="/portal/home/admin">Admin overview</Link><h1>Library management</h1><p>Upload past papers, textbooks and study materials, or paste notes for students to read in the portal.</p>
    <p>Files are private. The reader has no download or print controls; viewing cannot prevent screenshots or determined copying. Upload materials you are permitted to share.</p>
    <details className="account-panel"><summary>Add a resource</summary><ResourceForm courses={courses.data ?? []}/></details>
    <form className="admin-search"><label>Publication status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><button className="btn teal">Filter</button></form>
    {!resources.data?.length && <p>No resources on this page.</p>}
    {(resources.data as Resource[]).map(resource => <section className="account-panel" key={resource.id}><h2>{resource.title}</h2><p>{categories[resource.category]} ? {resource.status} ? {resource.audience === "all_students" ? "All approved students" : "Course enrolments"}</p><p><Link href={"/portal/library/"+resource.id}>Preview resource</Link></p>
      <details><summary>Edit details</summary><ResourceForm courses={courses.data ?? []} resource={resource}/></details>
      <details><summary>Publish or withdraw</summary><ManagedForm action={publishResource} label="Update publication"><input type="hidden" name="id" value={resource.id}/><input type="hidden" name="revision" value={resource.revision}/><label>Status<select name="status" defaultValue={resource.status}><option value="draft">Draft (hidden)</option><option value="published">Published</option><option value="archived">Archived (hidden)</option></select></label><label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label></ManagedForm></details>
    </section>)}
    <nav className="pagination" aria-label="Library management pages">{page>1 && <Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{(resources.count ?? 0)>page*20 && <Link href={link(page+1)}>Next</Link>}</nav>
  </main>;
}
