import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { submitAssignment } from "./actions";
export const dynamic = "force-dynamic";
type Assignment = { id: string; title: string; description: string; max_score: number; due_at: string; courses: { name: string; code: string } | null };
type Submission = { id: string; file_name: string; submitted_at: string; is_late: boolean; score: number | null; score_status: string; grading_note: string | null; review_note: string | null };

export default async function AssignmentsPage() {
  await requireAccount();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("assignments").select("id,title,description,max_score,due_at,courses(name,code)").order("due_at");
  if (error) throw new Error("Unable to load assignments.");
  const assignments = (data ?? []) as unknown as Assignment[];
  const submissionResults = await Promise.all(assignments.map(assignment => db.rpc("my_assignment_submission", { p_assignment_id: assignment.id })));
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Student</span><h1>Assignments</h1><p>Submit your work and track feedback for each course you&rsquo;re enrolled in.</p></div></div>
    {!assignments.length && <p>No assignments have been set for your courses yet.</p>}
    <div className="dashgrid">
      {assignments.map((assignment, index) => {
        const submission = ((submissionResults[index].data ?? [])[0] ?? null) as Submission | null;
        const overdue = !submission && new Date(assignment.due_at) < new Date();
        return <div className="panel" key={assignment.id}>
          <header><h2>{assignment.title}</h2><span className="status-badge">{assignment.courses?.code ?? ""}</span></header>
          <p>{assignment.description}</p>
          <p><small>{assignment.courses?.name} · Due {new Date(assignment.due_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })} · Max score {assignment.max_score}</small></p>
          {submission ? <>
            <p>Submitted: {submission.file_name} ({new Date(submission.submitted_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}){submission.is_late && <> · <span className="status-badge">Late</span></>}</p>
            {submission.score_status === "approved"
              ? <p><strong>Score: {submission.score} / {assignment.max_score}</strong>{submission.grading_note && <><br/>{submission.grading_note}</>}</p>
              : <p><small>Awaiting grading/review.{submission.review_note && <> Tutor note: {submission.review_note}</>}</small></p>}
            {submission.score_status === "pending" && <details><summary>Replace submission</summary><ManagedForm action={submitAssignment} label="Submit">
              <input type="hidden" name="assignmentId" value={assignment.id}/>
              <label>Choose file (PDF, JPEG or PNG, up to 10 MB)<input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required/></label>
            </ManagedForm></details>}
          </> : <>
            {overdue && <p className="status-badge">Past due &mdash; still accepted, will be marked late</p>}
            <ManagedForm action={submitAssignment} label="Submit assignment">
              <input type="hidden" name="assignmentId" value={assignment.id}/>
              <label>Choose file (PDF, JPEG or PNG, up to 10 MB)<input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required/></label>
            </ManagedForm>
          </>}
        </div>;
      })}
    </div>
  </div>;
}
