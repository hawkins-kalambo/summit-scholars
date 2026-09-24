import Link from "next/link";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { submitTutorApplication, uploadTutorDocument } from "./actions";
export const dynamic = "force-dynamic";
type TutorApplication = { id: string; subjects: string; qualifications: string; availability: string; status: string; decision_reason: string | null };
type TutorDocument = { id: string; file_name: string; document_category: string };
type Vacancy = { id: string; title: string; subjects: string; description: string; closes_at: string | null };
const categoryLabels: Record<string, string> = { cover_letter: "Cover letter", cv: "CV / résumé", certificate: "Certificate", id_document: "ID document", other: "Other" };

export default async function ApplyToTeachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requireAccount("/login/student");
  if (account.roles.includes("tutor")) {
    return <main className="account-content narrow-content"><h1>You&rsquo;re already a tutor</h1><p>Your account already holds the tutor role. Visit your <Link href="/portal/tutor">tutor workspace</Link>.</p></main>;
  }
  const params = await searchParams;
  const vacancyId = typeof params.vacancy === "string" ? params.vacancy : null;
  const db = await createSupabaseServerClient();
  const [applicationResult, vacancyResult] = await Promise.all([
    db.from("tutor_applications").select("id,subjects,qualifications,availability,status,decision_reason").eq("applicant_id", account.user.id).maybeSingle(),
    vacancyId ? db.from("tutor_vacancies").select("id,title,subjects,description,closes_at").eq("id", vacancyId).eq("is_open", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (applicationResult.error) throw new Error("Unable to load your tutor application.");
  const application = applicationResult.data as TutorApplication | null;
  const vacancy = vacancyResult.data as Vacancy | null;
  const documentsResult = application ? await db.from("tutor_application_documents").select("id,file_name,document_category").eq("application_id", application.id) : { data: [] as TutorDocument[] };
  const documents = documentsResult.data ?? [];
  const canReapply = !application || application.status === "rejected";
  return <main className="account-content narrow-content">
    <h1>Apply to teach</h1>
    {!application && !vacancy && <section className="account-panel">
      <p>This application link isn&rsquo;t tied to an open position, or that position has since closed.</p>
      <p><Link href="/vacancies">Browse our open tutor positions</Link>.</p>
    </section>}
    {application && <section className="account-panel">
      <div className="section-title"><h2>Your application</h2><span className="status-badge">{application.status.replaceAll("_", " ")}</span></div>
      <dl className="detail-list"><dt>Subjects</dt><dd>{application.subjects}</dd><dt>Qualifications</dt><dd>{application.qualifications}</dd><dt>Availability</dt><dd>{application.availability}</dd></dl>
      {application.decision_reason && <p>Decision note: {application.decision_reason}</p>}
      <p><strong>Documents</strong></p>
      {documents.length ? <ul>{documents.map(doc => <li key={doc.id}>{categoryLabels[doc.document_category] ?? doc.document_category}: {doc.file_name}</li>)}</ul> : <p>No documents uploaded.</p>}
      {application.status === "submitted" && documents.length < 8 && <ManagedForm action={uploadTutorDocument} label="Upload document">
        <input type="hidden" name="applicationId" value={application.id}/>
        <label>Document type<select name="category" required defaultValue="">
          <option value="" disabled>Choose a type</option>
          <option value="cover_letter">Cover letter</option>
          <option value="cv">CV / résumé</option>
          <option value="certificate">Certificate</option>
          <option value="id_document">ID document</option>
          <option value="other">Other</option>
        </select></label>
        <label>Choose file (PDF, JPEG or PNG, up to 10 MB)<input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required/></label>
      </ManagedForm>}
      {application.status === "rejected" && vacancy && <p>You can submit a new application below.</p>}
    </section>}
    {canReapply && vacancy && <section className="account-panel">
      <h2>{vacancy.title}</h2>
      <p>{vacancy.description}</p>
      <p><strong>Subjects:</strong> {vacancy.subjects}</p>
      {vacancy.closes_at && <p><small>Applications close {new Date(vacancy.closes_at).toLocaleDateString("en-GB")}.</small></p>}
      <ManagedForm action={submitTutorApplication} label="Submit application">
        <input type="hidden" name="vacancyId" value={vacancy.id}/>
        <label>Full name<input name="fullName" required minLength={2} maxLength={200} defaultValue={account.fullName}/></label>
        <label>Phone<input name="phone" type="tel" required maxLength={25}/></label>
        <label>Subjects you can teach<input name="subjects" required minLength={2} maxLength={500} placeholder="Mathematics, Physics"/></label>
        <label>Qualifications and experience<textarea name="qualifications" required minLength={10} maxLength={4000}/></label>
        <label>Availability<textarea name="availability" required minLength={2} maxLength={1000} placeholder="Weekday evenings, weekends"/></label>
        <p><small>Once submitted, you can upload your cover letter, CV, certificates and ID document.</small></p>
      </ManagedForm>
    </section>}
  </main>;
}
