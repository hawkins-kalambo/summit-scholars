import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { createAssignment, gradeSubmission } from "./actions";
export const dynamic = "force-dynamic";
type Course = { course_id: string; name: string; code: string; student_count: number };
type Assignment = { id: string; title: string; description: string; max_score: number; due_at: string };
type Submission = { id: string; student_id: string; full_name: string; file_name: string; submitted_at: string; is_late: boolean; score: number | null; score_status: string; grading_note: string | null; review_note: string | null };

function CreateAssignmentForm({ courseId }: { courseId: string }) {
  return <ManagedForm action={createAssignment} label="Create assignment">
    <input type="hidden" name="courseId" value={courseId}/>
    <label>Title<input name="title" required minLength={2} maxLength={200}/></label>
    <label>Description<textarea name="description" required minLength={10} maxLength={4000}/></label>
    <label>Maximum score<input type="number" name="maxScore" min={1} step="0.5" required defaultValue={100}/></label>
    <label>Due<input type="datetime-local" name="dueAt" required/></label>
    <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
  </ManagedForm>;
}
function GradeForm({ submission, maxScore }: { submission: Submission; maxScore: number }) {
  return <ManagedForm action={gradeSubmission} label={submission.score_status === "pending" ? "Grade submission" : "Re-grade submission"}>
    <input type="hidden" name="submissionId" value={submission.id}/>
    <label>Score (out of {maxScore})<input type="number" name="score" min={0} max={maxScore} step="0.5" required defaultValue={submission.score ?? undefined}/></label>
    <label>Feedback for the student<textarea name="note" required minLength={5} maxLength={2000} defaultValue={submission.grading_note ?? ""}/></label>
    <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
  </ManagedForm>;
}
export default async function TutorAssignmentsPage() {
  await requireTutor();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("tutor_courses");
  if (error) throw new Error("Unable to load your assigned courses.");
  const courses = (data ?? []) as Course[];
  const assignmentsResults = await Promise.all(courses.map(course => db.from("assignments").select("id,title,description,max_score,due_at").eq("course_id", course.course_id).order("due_at")));
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Tutor</span><h1>Assignments</h1><p>Set assignments and grade submissions. A different academic administrator must approve each grade before the student sees it.</p></div></div>
    {courses.length === 0 ? <p>No courses assigned yet.</p> : <div className="dashgrid">
      {await Promise.all(courses.map(async (course, index) => {
        const assignments = (assignmentsResults[index].data ?? []) as Assignment[];
        const submissionResults = await Promise.all(assignments.map(assignment => db.rpc("tutor_assignment_submissions", { p_assignment_id: assignment.id })));
        return <div className="panel" key={course.course_id}><header><h2>{course.name} ({course.code})</h2></header>
          {assignments.length ? assignments.map((assignment, assignmentIndex) => {
            const submissions = (submissionResults[assignmentIndex].data ?? []) as Submission[];
            return <section className="account-card" key={assignment.id}>
              <div className="section-title"><h2>{assignment.title}</h2><span className="status-badge">Max {assignment.max_score}</span></div>
              <p><small>Due {new Date(assignment.due_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}</small></p>
              {submissions.length ? <ul>{submissions.map(submission => <li key={submission.id}>
                {submission.full_name} · {submission.file_name} ({new Date(submission.submitted_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })})
                {submission.is_late && <> · <span className="status-badge">Late</span></>}
                {" "}· <a href={"/portal/tutor/assignments/" + submission.id + "/content"} target="_blank" rel="noreferrer">View file</a>
                {" "}· <span className="status-badge">{submission.score_status}</span>
                {submission.score_status === "approved" && <> · Score: {submission.score}</>}
                {submission.score_status !== "approved" && <details><summary>{submission.score_status === "pending" ? "Grade" : "Review / re-grade"}</summary><GradeForm submission={submission} maxScore={assignment.max_score}/></details>}
              </li>)}</ul> : <p>No submissions yet.</p>}
            </section>;
          }) : <p>No assignments set for this course yet.</p>}
          <details><summary>Create assignment</summary><CreateAssignmentForm courseId={course.course_id}/></details>
        </div>;
      }))}
    </div>}
  </div>;
}
