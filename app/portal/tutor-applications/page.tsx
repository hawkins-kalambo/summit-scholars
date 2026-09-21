import { requireAcademicManager } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { reviewTutorApplication, decideTutorApplication } from "./actions";
export const dynamic = "force-dynamic";
type TutorApplication = {
  id: string; full_name: string; phone: string; subjects: string; qualifications: string; availability: string;
  status: string; reviewed_by: string | null; revision: number; created_at: string;
};

export default async function TutorApplicationsPage() {
  const account = await requireAcademicManager();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("tutor_applications").select("*").in("status", ["submitted", "under_review"]).order("created_at");
  if (error) throw new Error("Unable to load tutor applications.");
  const applications = (data ?? []) as TutorApplication[];
  const documentsResults = await Promise.all(applications.map(application => db.from("tutor_application_documents").select("id,file_name").eq("application_id", application.id)));
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Academics</span><h1>Tutor applications</h1><p>Review qualifications and decide public applications to teach. A different administrator must decide than the one who reviewed.</p></div></div>
    {!applications.length && <p>No applications awaiting review.</p>}
    {applications.map((application, index) => {
      const documents = documentsResults[index].data ?? [];
      return <section className="account-panel" key={application.id}>
        <div className="section-title"><h2>{application.full_name}</h2><span className="status-badge">{application.status.replaceAll("_", " ")}</span></div>
        <dl className="detail-list">
          <dt>Phone</dt><dd>{application.phone}</dd>
          <dt>Subjects</dt><dd>{application.subjects}</dd>
          <dt>Qualifications</dt><dd>{application.qualifications}</dd>
          <dt>Availability</dt><dd>{application.availability}</dd>
          <dt>Documents</dt><dd>{documents.length ? <ul>{documents.map(doc => <li key={doc.id}>{doc.file_name}</li>)}</ul> : "None uploaded"}</dd>
        </dl>
        {application.status === "submitted" && <ManagedForm action={reviewTutorApplication} label="Begin review">
          <input type="hidden" name="id" value={application.id}/><input type="hidden" name="revision" value={application.revision}/>
          <label>Review note<textarea name="note" required minLength={5} maxLength={2000}/></label>
        </ManagedForm>}
        {application.status === "under_review" && (application.reviewed_by === account.user.id
          ? <p><small>A different academic administrator must decide this application.</small></p>
          : <ManagedForm action={decideTutorApplication} label="Record decision">
            <input type="hidden" name="id" value={application.id}/><input type="hidden" name="revision" value={application.revision}/>
            <label>Decision<select name="decision"><option value="approve">Approve — grant tutor role</option><option value="reject">Reject</option></select></label>
            <label>Decision note<textarea name="note" required minLength={5} maxLength={2000}/></label>
          </ManagedForm>)}
      </section>;
    })}
  </div>;
}
