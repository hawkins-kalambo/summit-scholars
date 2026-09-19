import { BookOpen, Users } from "lucide-react";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
type Course = { course_id: string; name: string; code: string; student_count: number };
type RosterRow = { student_id: string; full_name: string; status: string };
export default async function TutorDashboard() {
  const account = await requireTutor();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("tutor_courses");
  if (error) throw new Error("Unable to load your assigned courses.");
  const courses = (data ?? []) as Course[];
  const rosters = await Promise.all(courses.map(course => db.rpc("tutor_course_roster", { p_course_id: course.course_id })));
  const totalStudents = courses.reduce((sum, course) => sum + Number(course.student_count), 0);
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Tutor</span><h1>Welcome, {account.fullName}.</h1><p>Your assigned courses and students.</p></div></div>
    <div className="stats">
      <div className="stat"><i><BookOpen size={21}/></i><div><strong>{courses.length}</strong><span>Assigned courses</span></div></div>
      <div className="stat green"><i><Users size={21}/></i><div><strong>{totalStudents}</strong><span>Enrolled students</span></div></div>
    </div>
    {courses.length === 0 ? <p>No courses assigned yet. Contact an academic administrator.</p> : <div className="dashgrid">
      {courses.map((course, index) => {
        const roster = (rosters[index].data ?? []) as RosterRow[];
        return <div className="panel" key={course.course_id}><header><h2>{course.name} ({course.code})</h2></header>
          {roster.length ? <ul>{roster.map(row => <li key={row.student_id}>{row.full_name} · {row.status}</li>)}</ul> : <p>No enrolled students yet.</p>}
        </div>;
      })}
    </div>}
    <p><small>Timetables, attendance, assignments and marking are not yet available and will appear here as those features launch.</small></p>
  </div>;
}
