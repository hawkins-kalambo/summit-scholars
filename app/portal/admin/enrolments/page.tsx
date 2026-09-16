import Link from "next/link";
import { requireAdminArea, pageNumber } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { updateEnrolment } from "./actions";
export const dynamic = "force-dynamic";
export default async function EnrolmentsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requireAdminArea("library"); const params=await searchParams; const page=pageNumber(params.page);
  const status=["pending","active","withdrawn","completed"].includes(String(params.status)) ? String(params.status) : "pending";
  const db=await createSupabaseServerClient();
  const { data,error,count }=await db.from("enrolments").select("id,student_id,course_id,period_id,application_id,status",{count:"exact"}).eq("status",status).order("created_at",{ascending:false}).order("id").range((page-1)*25,page*25-1);
  if(error) throw new Error("Enrolments could not be loaded.");
  const [courses,periods,applications]=await Promise.all([db.from("courses").select("id,name"),db.from("academic_periods").select("id,name"),data?.length ? db.from("applications").select("id,full_name").in("id",data.map(row=>row.application_id)) : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null })]);
  if(courses.error || periods.error || applications.error) throw new Error("Enrolment details could not be loaded.");
  const link=(n:number)=>"/portal/admin/enrolments?"+new URLSearchParams({status,page:String(n)});
  return <main className="account-content"><Link href="/portal/home/admin">Admin overview</Link><h1>Course enrolments</h1><p>Activate approved students for their courses, withdraw registrations or mark them completed. Course-restricted library materials require an active enrolment.</p><form className="admin-search"><label>Status<select name="status" defaultValue={status}>{["pending","active","withdrawn","completed"].map(value=><option key={value}>{value}</option>)}</select></label><button className="btn teal">Filter</button></form>
    {!data?.length && <p>No enrolments with this status.</p>}{data?.map(row=><section className="account-panel" key={row.id}><h2>{applications.data?.find(a=>a.id===row.application_id)?.full_name ?? row.student_id}</h2><p>{courses.data?.find(c=>c.id===row.course_id)?.name} ? {periods.data?.find(p=>p.id===row.period_id)?.name} ? {row.status}</p><p><Link href={"/portal/applications/"+row.application_id}>View application</Link></p>{row.status!=="completed" && <ManagedForm action={updateEnrolment} label="Update enrolment"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="expected" value={row.status}/><label>New status<select name="status">{(row.status==="pending" ? ["active","withdrawn"] : row.status==="active" ? ["withdrawn","completed"] : ["active"]).map(value=><option key={value}>{value}</option>)}</select></label><label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label></ManagedForm>}</section>)}
    <nav className="pagination" aria-label="Enrolment pages">{page>1 && <Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{(count ?? 0)>page*25 && <Link href={link(page+1)}>Next</Link>}</nav></main>;
}
