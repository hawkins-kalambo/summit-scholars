import { getAdmissionsSettings, getCatalogue, requireAcademicManager } from "@/lib/admissions/data";
import { ManagedForm } from "@/components/admissions/managed-form";
import { publishCourse, saveAcademicRecord, saveAdmissionsSettings } from "./actions";
import type { University } from "@/lib/admissions/validation";

export const dynamic = "force-dynamic";
type Entity = { id: string; name: string; code?: string; university_id?: string; active?: boolean; description?: string; level?: number; registration_opens?: string; registration_closes?: string };
function AcademicForm({ kind, universities, entity }: { kind: string; universities: University[]; entity?: Entity }) {
  return <ManagedForm action={saveAcademicRecord} label={entity ? "Save changes" : "Create record"}>
    <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={entity?.id ?? ""}/>
    <label>Name<input name="name" defaultValue={entity?.name ?? ""} minLength={2} maxLength={200} required/></label>
    {kind!=="period" && <label>Internal code<input name="code" defaultValue={entity?.code ?? ""} minLength={2} maxLength={40} required/></label>}
    {kind!=="university" && (entity ? <input type="hidden" name="university_id" value={entity.university_id}/> : <label>University<select name="university_id" required><option value="">Choose university</option>{universities.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>)}
    {kind==="period" && <><label>Registration opens<input type="date" name="registration_opens" defaultValue={entity?.registration_opens} required/></label><label>Registration closes<input type="date" name="registration_closes" defaultValue={entity?.registration_closes} required/></label><small>Registration dates use Malawi time.</small></>}
    {kind==="course" ? <><label>Level<input type="number" name="level" min={1} max={10} defaultValue={entity?.level ?? 1} required/></label><label>Description<textarea name="description" maxLength={2000} defaultValue={entity?.description ?? ""}/></label></> : <label className="check-label"><input type="checkbox" name="active" defaultChecked={entity?.active ?? true}/>Active</label>}
    <label>Reason for this change<textarea name="reason" minLength={5} maxLength={2000} required/></label>
  </ManagedForm>;
}
export default async function AcademicSettingsPage() {
  const account = await requireAcademicManager();
  const [catalogue,settings] = await Promise.all([getCatalogue(),getAdmissionsSettings()]);
  const superAdmin = account.roles.includes("super_admin");
  const groups = [
    { title:"Universities",kind:"university",rows:catalogue.universities },
    { title:"Programmes",kind:"programme",rows:catalogue.programmes },
    { title:"Registration intakes",kind:"period",rows:catalogue.periods },
    { title:"Courses",kind:"course",rows:catalogue.courses },
  ];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Academics</span><h1>Academic configuration</h1><p>Manage the academic options students can request. Course changes return a course to draft until approved for publication.</p></div></div>
    <div className="dashgrid">
      {superAdmin && <div className="panel"><header><h2>Admissions settings</h2></header><ManagedForm action={saveAdmissionsSettings} label="Save admissions settings">
        <label className="check-label"><input name="registrationOpen" type="checkbox" defaultChecked={settings.registration_open}/>Accept applications</label>
        <label>Approved privacy notice<textarea name="privacyNotice" rows={8} maxLength={20000} defaultValue={settings.privacy_notice}/></label>
        <p>Publish your organisation’s approved wording. Each applicant’s accepted version is preserved.</p>
        <label>Student number prefix<input name="studentPrefix" minLength={2} maxLength={10} pattern="[A-Za-z0-9]{2,10}" defaultValue={settings.student_number_prefix} required/></label>
        <label className="check-label"><input name="documentsRequired" type="checkbox" defaultChecked={settings.documents_required}/>Require a supporting document</label>
        <label>Reason for changing these settings<textarea name="reason" minLength={5} maxLength={2000} required/></label>
      </ManagedForm></div>}
      {groups.map(group=><div className="panel" key={group.kind}><header><h2>{group.title}</h2></header>
        <details><summary>Create {group.kind}</summary><AcademicForm kind={group.kind} universities={catalogue.universities}/></details>
        <div className="academic-records">{group.rows.map(row=><details key={row.id}><summary>{row.name} {"published" in row ? (row.published ? "· Published" : "· Draft") : row.active ? "· Active" : "· Inactive"}</summary>
          <AcademicForm kind={group.kind} universities={catalogue.universities} entity={row}/>
          {group.kind==="course" && superAdmin && "published" in row && <ManagedForm action={publishCourse} label={row.published ? "Unpublish course" : "Approve and publish"}>
            <label>Approval reason<textarea name="reason" minLength={5} maxLength={2000} required/></label><input type="hidden" name="id" value={row.id}/><input type="hidden" name="published" value={row.published ? "false" : "true"}/>
          </ManagedForm>}
        </details>)}</div>
      </div>)}
    </div>
  </div>;
}
