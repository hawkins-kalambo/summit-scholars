import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmissionsSettings, getCatalogue, requireAdmissionsAccount } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordId, type Application } from "@/lib/admissions/validation";
import { ApplicationForm } from "@/components/admissions/application-form";
import { ManagedForm } from "@/components/admissions/managed-form";
import { cancelApplication, decideApplication, removeDocument, reviewApplication, submitApplication, uploadDocument } from "../actions";

export const dynamic = "force-dynamic";
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAdmissionsAccount();
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("applications").select("*").eq("id",id).maybeSingle();
  if (error) throw new Error("We could not load the application.");
  if (!data) notFound();
  const application = data as Application;
  const [catalogue, settings, courses, documents, history] = await Promise.all([
    getCatalogue(), getAdmissionsSettings(),
    db.from("application_courses").select("course_id").eq("application_id",id),
    db.from("application_documents").select("id,file_name,size_bytes").eq("application_id",id).order("created_at"),
    db.from("application_history").select("id,event,note,created_at").eq("application_id",id).order("created_at", { ascending:false }),
  ]);
  if (courses.error || documents.error || history.error) throw new Error("We could not load application details.");
  const selected = (courses.data ?? []).map(row => String(row.course_id));
  const own = application.applicant_id === account.user.id;
  const editable = own && ["draft","information_required"].includes(application.status);
  const canReview = !own && account.status === "active" && account.roles.some(role => ["super_admin","admissions_officer"].includes(role));
  const canApprove = !own && account.status === "active" && account.roles.some(role => ["super_admin","academic_admin"].includes(role));
  const fields = <><input type="hidden" name="applicationId" value={id}/><input type="hidden" name="revision" value={application.revision}/></>;
  return <main className="account-content">
    <Link href="/portal/applications">← Applications</Link>
    <div className="section-title"><h1>{application.full_name}</h1><span className="status-badge">{application.status.replaceAll("_"," ")}</span></div>
    <p className="reference">Reference: {id}</p>
    {application.status === "approved" && <p className="form-success">Admission approved. Your account is active; admissions will confirm your course arrangements.</p>}
    <div className="application-columns"><div>
      <section className="account-panel"><h2>Application details</h2>
        {editable ? <ApplicationForm key={application.revision} catalogue={catalogue} application={application} selectedCourses={selected}/>
          : <dl className="detail-list"><dt>University</dt><dd>{catalogue.universities.find(row => row.id===application.university_id)?.name ?? "University on record"}</dd><dt>Programme</dt><dd>{catalogue.programmes.find(row => row.id===application.programme_id)?.name ?? "Programme on record"}</dd><dt>Intake</dt><dd>{catalogue.periods.find(row => row.id===application.period_id)?.name ?? "Intake on record"}</dd><dt>Year</dt><dd>{application.year_of_study}</dd><dt>Phone</dt><dd>{application.phone}</dd><dt>Learning mode</dt><dd>{application.learning_mode.replaceAll("_"," ")}</dd><dt>Courses</dt><dd><ul>{selected.map(courseId => <li key={courseId}>{catalogue.courses.find(row => row.id===courseId)?.name ?? "Course on record"}</li>)}</ul></dd></dl>}
      </section>
      <section className="account-panel"><h2>Supporting documents</h2><p>PDF, JPEG or PNG; up to 10 MB per file and five files per application.</p>
        {(documents.data ?? []).length === 0 && <p>No documents uploaded.</p>}
        <ul className="document-list">{(documents.data ?? []).map(document => <li key={document.id}><a href={"/portal/applications/" + id + "/documents/" + document.id}>{document.file_name}</a><small>{Math.ceil(document.size_bytes/1024)} KB</small>{editable && <ManagedForm action={removeDocument} label="Remove"><input type="hidden" name="documentId" value={document.id}/></ManagedForm>}</li>)}</ul>
        {editable && <ManagedForm action={uploadDocument} label="Upload document">{fields}<label>Choose document<input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required/></label></ManagedForm>}
      </section>
      {editable && <section className="account-panel"><h2>Submit for review</h2>
        {!settings.registration_open && <p className="form-notice">Applications are currently closed. You can keep preparing your draft.</p>}
        {settings.documents_required && <p>A supporting document is required for submission.</p>}
        <div className="privacy-notice">{settings.privacy_notice || "The admissions privacy notice has not yet been published."}</div>
        <ManagedForm action={submitApplication} label="Submit application" disabled={!settings.registration_open || settings.privacy_notice.length<20}>
          {fields}<input type="hidden" name="privacyVersion" value={settings.privacy_version}/>
          <label className="check-label"><input type="checkbox" name="consent" required/>I have read the privacy notice and consent to the use of my information for this application.</label>
        </ManagedForm>
      </section>}
      {own && !["approved","rejected","cancelled"].includes(application.status) && <details className="account-panel"><summary>Cancel application</summary><ManagedForm action={cancelApplication} label="Cancel this application">{fields}<label className="check-label"><input type="checkbox" name="confirmCancel" required/>I want to cancel this application.</label></ManagedForm></details>}
    </div><aside>
      {canReview && ["submitted","under_review","waitlisted"].includes(application.status) && <section className="account-panel"><h2>Admissions review</h2><ManagedForm action={reviewApplication} label="Record review">
        {fields}<label>Action<select name="reviewAction">{["submitted","waitlisted"].includes(application.status) ? <option value="begin_review">Begin review</option> : <><option value="request_information">Request more information</option><option value="waitlist">Place on waitlist</option><option value="recommend_approval">Recommend approval</option><option value="recommend_rejection">Recommend rejection</option></>}</select></label>
        <label>Message visible to the applicant<textarea name="note" minLength={5} maxLength={2000} required/></label>
      </ManagedForm></section>}
      {canApprove && application.status==="under_review" && application.recommendation && <section className="account-panel"><h2>Academic decision</h2><p>Admissions recommends: {application.recommendation}.</p>
        {application.reviewed_by===account.user.id ? <p>A different staff member must make the final decision.</p> : <ManagedForm action={decideApplication} label={application.recommendation==="approve" ? "Approve admission" : "Reject application"}>
          {fields}<input type="hidden" name="decision" value={application.recommendation}/>
          <label>Decision message visible to the applicant<textarea name="note" minLength={5} maxLength={2000} required/></label>
        </ManagedForm>}
      </section>}
      <section className="account-panel"><h2>Application history</h2><ol className="history-list">{(history.data ?? []).map(event => <li key={event.id}><strong>{event.event.replaceAll("_"," ")}</strong><time>{new Date(event.created_at).toLocaleString("en-GB", { timeZone:"Africa/Blantyre" })}</time>{event.note && <p>{event.note}</p>}</li>)}</ol></section>
      {application.consent_notice && <details className="account-panel"><summary>Privacy notice accepted at submission</summary><p className="privacy-notice">{application.consent_notice}</p></details>}
    </aside></div>
  </main>;
}
