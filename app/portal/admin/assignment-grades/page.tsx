import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { decideAssignmentGrade } from "./actions";
export const dynamic = "force-dynamic";
type PendingGrade = { submission_id: string; student_name: string; assignment_title: string; course_name: string; score: number; max_score: number; grading_note: string; is_late: boolean; graded_at: string };

export default async function AssignmentGradesPage() {
  const account = await requireAccount();
  if (account.status !== "active" || !account.roles.some(role => role === "academic_admin" || role === "super_admin")) notFound();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("assignment_grades_pending_approval");
  if (error) throw new Error("Unable to load assignment grades.");
  const pending = (data ?? []) as PendingGrade[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Academics</span><h1>Assignment grades</h1><p>Review and approve grades before students can see them.</p></div></div>
    {!pending.length && <p>No grades awaiting approval.</p>}
    <div className="dashgrid">{pending.map(item => <section className="account-panel" key={item.submission_id}>
      <div className="section-title"><h2>{item.student_name}</h2><span className="status-badge">{item.score} / {item.max_score}</span></div>
      <p>{item.assignment_title} · {item.course_name}{item.is_late && <> · <span className="status-badge">Late</span></>}</p>
      <p>{item.grading_note}</p>
      <ManagedForm action={decideAssignmentGrade} label="Record decision">
        <input type="hidden" name="id" value={item.submission_id}/>
        <label>Decision<select name="decision"><option value="approve">Approve — publish to student</option><option value="reject">Reject — return to tutor</option></select></label>
        <label>Decision reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
      </ManagedForm>
    </section>)}</div>
  </div>;
}
