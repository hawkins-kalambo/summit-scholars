import Link from "next/link";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { submitTutorApplication, uploadTutorDocument } from "./actions";
export const dynamic = "force-dynamic";
type TutorApplication = { id: string; subjects: string; qualifications: string; availability: string; status: string; decision_reason: string | null };
export default async function ApplyToTeachPage() {
  const account = await requireAccount("/login/student");
  if (account.roles.includes("tutor")) {
    return <main className="account-content narrow-content"><h1>You&rsquo;re already a tutor</h1><p>Your account already holds the tutor role. Visit your <Link href="/portal/tutor">tutor workspace</Link>.</p></main>;
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("tutor_applications").select("id,subjects,qualifications,availability,status,decision_reason").eq("applicant_id", account.user.id).maybeSingle();
  if (error) throw new Error("Unable to load your tutor application.");
  const application = data as TutorApplication | null;
  const documentsResult = application ? await db.from("tutor_application_documents").select("id,file_name").eq("application_id", application.id) : { data: [] as { id: string; file_name: string }[] };
  const documents = documentsResult.data ?? [];
  const canReapply = !application || application.status === "rejected";
  return <main className="account-content narrow-content">
    <h1>Apply to teach</h1>
    <p>Tell us about your qualifications and the subjects you can support. Applications are reviewed by our academic team.</p>
    {application && <section className="account-panel">
      <div className="section-title"><h2>Your application</h2><span className="status-badge">{application.status.replaceAll("_", " ")}</span></div>
      <dl className="detail-list"><dt>Subjects</dt><dd>{application.subjects}</dd><dt>Qualifications</dt><dd>{application.qualifications}</dd><dt>Availability</dt><dd>{application.availability}</dd></dl>
      {application.decision_reason && <p>Decision note: {application.decision_reason}</p>}
      <p><strong>Documents</strong></p>
      {documents.length ? <ul>{documents.map(doc => <li key={doc.id}>{doc.file_name}</li>)}</ul> : <p>No documents uploaded.</p>}
      {application.status === "submitted" && documents.length < 5 && <ManagedForm action={uploadTutorDocument} label="Upload document">
        <input type="hidden" name="applicationId" value={application.id}/>
        <label>Choose document (PDF, JPEG or PNG, up to 10 MB)<input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required/></label>
      </ManagedForm>}
      {application.status === "rejected" && <p>You can submit a new application below.</p>}
    </section>}
    {canReapply && <section className="account-panel"><h2>Submit your application</h2>
      <ManagedForm action={submitTutorApplication} label="Submit application">
        <label>Full name<input name="fullName" required minLength={2} maxLength={200} defaultValue={account.fullName}/></label>
        <label>Phone<input name="phone" type="tel" required maxLength={25}/></label>
        <label>Subjects you can teach<input name="subjects" required minLength={2} maxLength={500} placeholder="Mathematics, Physics"/></label>
        <label>Qualifications and experience<textarea name="qualifications" required minLength={10} maxLength={4000}/></label>
        <label>Availability<textarea name="availability" required minLength={2} maxLength={1000} placeholder="Weekday evenings, weekends"/></label>
      </ManagedForm>
    </section>}
  </main>;
}
