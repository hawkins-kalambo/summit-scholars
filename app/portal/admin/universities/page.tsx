import Link from "next/link";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { saveAcademicStructure } from "./actions";
export const dynamic = "force-dynamic";
type University = { id: string; name: string; code: string; active: boolean };
type StructureEntity = { id: string; name: string; code: string; active: boolean; university_id?: string; faculty_id?: string };
function StructureForm({ kind, universities, faculties, entity }: { kind: "campus" | "faculty" | "department"; universities: University[]; faculties: StructureEntity[]; entity?: StructureEntity }) {
  return <ManagedForm action={saveAcademicStructure} label={entity ? "Save changes" : "Create record"}>
    <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={entity?.id ?? ""}/>
    <label>Name<input name="name" defaultValue={entity?.name ?? ""} minLength={2} maxLength={200} required/></label>
    <label>Internal code<input name="code" defaultValue={entity?.code ?? ""} minLength={2} maxLength={40} required/></label>
    {kind === "department"
      ? (entity ? <input type="hidden" name="faculty_id" value={entity.faculty_id}/> : <label>Faculty<select name="faculty_id" required><option value="">Choose faculty</option>{faculties.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>)
      : (entity ? <input type="hidden" name="university_id" value={entity.university_id}/> : <label>University<select name="university_id" required><option value="">Choose university</option>{universities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>)}
    <label className="check-label"><input type="checkbox" name="active" defaultChecked={entity?.active ?? true}/>Active</label>
    <label>Reason for this change<textarea name="reason" minLength={5} maxLength={2000} required/></label>
  </ManagedForm>;
}
export default async function UniversityStructurePage() {
  await requireAdminArea("structure");
  const db = await createSupabaseServerClient();
  const [universities, campuses, faculties, departments] = await Promise.all([
    db.from("universities").select("id,name,code,active").order("name"),
    db.from("campuses").select("*").order("name"),
    db.from("faculties").select("*").order("name"),
    db.from("departments").select("*").order("name"),
  ]);
  if (universities.error || campuses.error || faculties.error || departments.error) throw new Error("Unable to load the academic structure. Apply the academic structure migration first.");
  const universityRows = (universities.data ?? []) as University[];
  const facultyRows = (faculties.data ?? []) as StructureEntity[];
  const groups = [
    { title: "Campuses", kind: "campus" as const, rows: (campuses.data ?? []) as StructureEntity[] },
    { title: "Faculties", kind: "faculty" as const, rows: facultyRows },
    { title: "Departments", kind: "department" as const, rows: (departments.data ?? []) as StructureEntity[] },
  ];
  const universityName = (id?: string) => universityRows.find(row => row.id === id)?.name ?? "Unknown university";
  const facultyName = (id?: string) => facultyRows.find(row => row.id === id)?.name ?? "Unknown faculty";
  return <main className="account-content"><Link href="/portal/home/admin">Admin overview</Link><h1>Universities</h1>
    <p>Manage each university&rsquo;s campuses, faculties and departments. Programmes and courses are managed separately under Academic configuration.</p>
    {!universityRows.length && <p>Add a university under Academic configuration before configuring its structure.</p>}
    {universityRows.length > 0 && groups.map(group => <section className="account-panel" key={group.kind}><h2>{group.title}</h2>
      <details><summary>Create {group.kind}</summary><StructureForm kind={group.kind} universities={universityRows} faculties={facultyRows}/></details>
      {!group.rows.length && <p>None yet.</p>}
      <div className="academic-records">{group.rows.map(row => <details key={row.id}><summary>{row.name} ({row.code}) · {row.active ? "Active" : "Inactive"} · {group.kind === "department" ? facultyName(row.faculty_id) : universityName(row.university_id)}</summary>
        <StructureForm kind={group.kind} universities={universityRows} faculties={facultyRows} entity={row}/>
      </details>)}</div>
    </section>)}
  </main>;
}
