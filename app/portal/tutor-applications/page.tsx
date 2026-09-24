import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { reviewTutorApplication, decideTutorApplication, provisionTutorAccount } from "./actions";
export const dynamic = "force-dynamic";
type TutorApplication = {
  id: string; full_name: string; phone: string; subjects: string; qualifications: string; availability: string;
  status: string; reviewed_by: string | null; revision: number; created_at: string;
};
type ApprovedApplication = { id: string; full_name: string; subjects: string; decided_at: string };

export default async function TutorApplicationsPage() {
  const account = await requireAccount();
  const canReview = account.status === "active" && account.roles.some(role => role === "academic_admin" || role === "super_admin");
  const canProvision = account.status === "active" && account.roles.some(role => role === "system_admin" || role === "super_admin");
  if (!canReview && !canProvision) notFound();
  const db = await createSupabaseServerClient();
  const [reviewResult, approvedResult] = await Promise.all([
    canReview ? db.from("tutor_applications").select("*").in("status", ["submitted", "under_review"]).order("created_at") : { data: [] as TutorApplication[], error: null },
    canProvision ? db.from("tutor_applications").select("id,full_name,subjects,decided_at").eq("status", "approved").is("provisioned_at", null).order("decided_at") : { data: [] as ApprovedApplication[], error: null },
  ]);
  if (reviewResult.error || approvedResult.error) throw new Error("Unable to load tutor applications.");
  const applications = (reviewResult.data ?? []) as TutorApplication[];
  const awaitingProvisioning = (approvedResult.data ?? []) as ApprovedApplication[];
  const documentsResults = await Promise.all(applications.map(application => db.from("tutor_application_documents").select("id,file_name").eq("application_id", application.id)));
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Academics</span><h1>Tutor applications</h1><p>Review qualifications and recommend public applications to teach. A different administrator must decide than the one who reviewed, and a System Administrator provisions the account separately.</p></div></div>
    {canReview && <>
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
              <label>Decision<select name="decision"><option value="approve">Approve — recommend for the tutor role</option><option value="reject">Reject</option></select></label>
              <label>Decision note<textarea name="note" required minLength={5} maxLength={2000}/></label>
            </ManagedForm>)}
        </section>;
      })}
    </>}
    {canProvision && <div className="panel"><header><h2>Awaiting account provisioning</h2></header>
      <p><small>Approved applicants who don&rsquo;t yet hold the tutor role. Provisioning grants the role, activates the account, and emails the tutor to sign in.</small></p>
      {awaitingProvisioning.length ? awaitingProvisioning.map(application => <section className="account-card" key={application.id}>
        <p>{application.full_name} · {application.subjects}</p>
        <ManagedForm action={provisionTutorAccount} label="Provision account">
          <input type="hidden" name="id" value={application.id}/>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000} defaultValue="Approved tutor application; provisioning account."/></label>
        </ManagedForm>
      </section>) : <p>No approved applications awaiting provisioning.</p>}
    </div>}
  </div>;
}
