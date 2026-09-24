import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { createVacancy, updateVacancy } from "./actions";
export const dynamic = "force-dynamic";
type Vacancy = { id: string; title: string; subjects: string; description: string; is_open: boolean; closes_at: string | null };

export default async function VacanciesAdminPage() {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "academic_admin" || role === "system_admin" || role === "super_admin")) notFound();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("tutor_vacancies").select("id,title,subjects,description,is_open,closes_at").order("created_at", { ascending: false });
  if (error) throw new Error("Unable to load vacancies.");
  const vacancies = (data ?? []) as Vacancy[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Tutor recruitment</span><h1>Vacancies</h1><p>Only open vacancies are shown on the public site and accept applications.</p></div></div>
    <div className="dashgrid">
      <div className="panel"><header><h2>Post a vacancy</h2></header>
        <ManagedForm action={createVacancy} label="Post vacancy">
          <label>Title<input name="title" required minLength={2} maxLength={200} placeholder="Mathematics Tutor – Secondary Level"/></label>
          <label>Subjects<input name="subjects" required minLength={2} maxLength={500} placeholder="Mathematics, Physics"/></label>
          <label>Description<textarea name="description" required minLength={10} maxLength={4000}/></label>
          <label>Closes on (optional)<input type="date" name="closesAt"/></label>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
        </ManagedForm>
      </div>
      {vacancies.map(vacancy => <div className="panel" key={vacancy.id}><header><h2>{vacancy.title}</h2><span className="status-badge">{vacancy.is_open ? "Open" : "Closed"}</span></header>
        <ManagedForm action={updateVacancy} label="Save changes">
          <input type="hidden" name="id" value={vacancy.id}/>
          <label>Title<input name="title" required minLength={2} maxLength={200} defaultValue={vacancy.title}/></label>
          <label>Subjects<input name="subjects" required minLength={2} maxLength={500} defaultValue={vacancy.subjects}/></label>
          <label>Description<textarea name="description" required minLength={10} maxLength={4000} defaultValue={vacancy.description}/></label>
          <label>Closes on (optional)<input type="date" name="closesAt" defaultValue={vacancy.closes_at ?? ""}/></label>
          <label className="check-label"><input type="checkbox" name="isOpen" value="true" defaultChecked={vacancy.is_open}/>Open for applications</label>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
        </ManagedForm>
      </div>)}
    </div>
  </div>;
}
