import { BookOpen, Users, CalendarClock, Video } from "lucide-react";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google";
import { ManagedForm } from "@/components/admissions/managed-form";
import { scheduleSession, confirmSession, saveTutorProfile } from "./actions";
export const dynamic = "force-dynamic";
type Course = { course_id: string; name: string; code: string; student_count: number };
type RosterRow = { student_id: string; full_name: string; status: string };
type SessionRow = { id: string; course_id: string; topic: string; venue: string; starts_at: string; ends_at: string; meeting_link: string | null; google_event_html_link: string | null; status: string; actual_starts_at: string | null; actual_ends_at: string | null };
type TutorProfile = { display_name: string; headline: string; bio: string; subjects: string; visible: boolean; teaches_online: boolean; teaches_in_person: boolean };

function ScheduleForm({ courseId, courseName, googleConfigured }: { courseId: string; courseName: string; googleConfigured: boolean }) {
  return <ManagedForm action={scheduleSession} label="Schedule class">
    <input type="hidden" name="courseId" value={courseId}/>
    <input type="hidden" name="courseName" value={courseName}/>
    <label>Topic<input name="topic" required minLength={2} maxLength={200}/></label>
    <label>Venue<input name="venue" required minLength={2} maxLength={200} placeholder="Room 12, or Online"/></label>
    <label>Starts<input type="datetime-local" name="startsAt" required/></label>
    <label>Ends<input type="datetime-local" name="endsAt" required/></label>
    {googleConfigured
      ? <>
        <label className="check-label"><input type="checkbox" name="autoGenerateMeet" value="true" defaultChecked/>Auto-create a Google Meet link for this class</label>
        <label>Notes for the calendar invite (optional)<textarea name="notes" maxLength={2000} placeholder="Bring a calculator, chapter 4 covered, etc."/></label>
      </>
      : <label>Meeting link (optional)<input name="meetingLink" type="url" maxLength={500} placeholder="https://meet.google.com/..."/></label>}
    <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
  </ManagedForm>;
}
function ConfirmForm({ session, roster }: { session: SessionRow; roster: RosterRow[] }) {
  return <ManagedForm action={confirmSession} label="Save outcome">
    <input type="hidden" name="sessionId" value={session.id}/>
    <label>Outcome<select name="status" required defaultValue="completed">
      <option value="completed">Completed</option>
      <option value="cancelled">Cancelled</option>
      <option value="no_show">No students attended</option>
    </select></label>
    <label>Actual start<input type="datetime-local" name="actualStart"/></label>
    <label>Actual end<input type="datetime-local" name="actualEnd"/></label>
    {roster.length > 0 && <fieldset><legend>Attendance</legend>
      {roster.map(row => <label key={row.student_id}>{row.full_name}
        <select name={"attendance_" + row.student_id} defaultValue="present">
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="late">Late</option>
          <option value="excused">Excused</option>
        </select>
      </label>)}
    </fieldset>}
    <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
  </ManagedForm>;
}
export default async function TutorDashboard() {
  const account = await requireTutor();
  const googleConfigured = isGoogleCalendarConfigured();
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("tutor_courses");
  if (error) throw new Error("Unable to load your assigned courses.");
  const courses = (data ?? []) as Course[];
  const [rosters, sessionsResult, profileResult] = await Promise.all([
    Promise.all(courses.map(course => db.rpc("tutor_course_roster", { p_course_id: course.course_id }))),
    db.from("class_sessions").select("*").eq("tutor_id", account.user.id).order("starts_at"),
    db.from("tutor_profiles").select("display_name,headline,bio,subjects,visible,teaches_online,teaches_in_person").eq("tutor_id", account.user.id).maybeSingle(),
  ]);
  if (sessionsResult.error) throw new Error("Unable to load your class sessions.");
  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const profile = profileResult.data as TutorProfile | null;
  const totalStudents = courses.reduce((sum, course) => sum + Number(course.student_count), 0);
  const scheduledSessions = sessions.filter(session => session.status === "scheduled");
  const upcoming = scheduledSessions.length;
  const courseNameById = new Map(courses.map(course => [course.course_id, course.name]));
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Tutor</span><h1>Welcome, {account.fullName}.</h1><p>Your assigned courses, classes and attendance.</p></div></div>
    <div className="stats">
      <div className="stat"><i><BookOpen size={21}/></i><div><strong>{courses.length}</strong><span>Assigned courses</span></div></div>
      <div className="stat green"><i><Users size={21}/></i><div><strong>{totalStudents}</strong><span>Enrolled students</span></div></div>
      <div className="stat gold"><i><CalendarClock size={21}/></i><div><strong>{upcoming}</strong><span>Classes to confirm</span></div></div>
    </div>
    <div className="panel"><header><h2>Your scheduled classes</h2></header>
      {scheduledSessions.length ? <ul className="live-class-list">{scheduledSessions.map(session => <li key={session.id}>
        <div><strong>{courseNameById.get(session.course_id) ?? "Class"}</strong> · {session.topic}<br/>
          <small>{session.venue} · {new Date(session.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}</small></div>
        {session.meeting_link
          ? <a className="btn teal" href={session.meeting_link} target="_blank" rel="noreferrer"><Video size={16}/> Start / join lesson</a>
          : <span className="status-badge">In person</span>}
      </li>)}</ul> : <p>No classes scheduled yet. Use &ldquo;Schedule a class&rdquo; below on the relevant course.</p>}
    </div>
    {courses.length === 0 ? <p>No courses assigned yet. Contact an academic administrator.</p> : <div className="dashgrid">
      {courses.map((course, index) => {
        const roster = (rosters[index].data ?? []) as RosterRow[];
        const courseSessions = sessions.filter(session => session.course_id === course.course_id);
        return <div className="panel" key={course.course_id}><header><h2>{course.name} ({course.code})</h2></header>
          <p><strong>Students</strong></p>
          {roster.length ? <ul>{roster.map(row => <li key={row.student_id}>{row.full_name} · {row.status}</li>)}</ul> : <p>No enrolled students yet.</p>}
          <p><strong>Classes</strong></p>
          {courseSessions.length ? <ul>{courseSessions.map(session => <li key={session.id}>
            {session.topic} · {session.venue} · {new Date(session.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })} · {session.status.replaceAll("_", " ")}
            {session.meeting_link && <> · <a href={session.meeting_link} target="_blank" rel="noreferrer">Start / join lesson</a></>}
            {session.google_event_html_link && <> · <a href={session.google_event_html_link} target="_blank" rel="noreferrer">Calendar event</a></>}
            {session.status === "scheduled" && <details><summary>Confirm this class</summary><ConfirmForm session={session} roster={roster}/></details>}
          </li>)}</ul> : <p>No classes scheduled yet.</p>}
          <details><summary>Schedule a class</summary><ScheduleForm courseId={course.course_id} courseName={course.name} googleConfigured={googleConfigured}/></details>
        </div>;
      })}
    </div>}
    <div className="panel"><header><h2>Public profile</h2></header>
      <p><small>Shown on the public <a href="/tutors" target="_blank" rel="noreferrer">tutors directory</a> when visible. Your qualifications and documents stay private.</small></p>
      <ManagedForm action={saveTutorProfile} label="Save public profile">
        <label>Display name<input name="displayName" required minLength={2} maxLength={200} defaultValue={profile?.display_name ?? account.fullName}/></label>
        <label>Headline<input name="headline" required minLength={2} maxLength={200} placeholder="Mathematics specialist" defaultValue={profile?.headline ?? ""}/></label>
        <label>Bio<textarea name="bio" required minLength={10} maxLength={2000} defaultValue={profile?.bio ?? ""}/></label>
        <label>Subjects<input name="subjects" required minLength={2} maxLength={500} placeholder="Mathematics, Physics" defaultValue={profile?.subjects ?? ""}/></label>
        <fieldset><legend>How do you teach?</legend>
          <label className="check-label"><input type="checkbox" name="teachesOnline" value="true" defaultChecked={profile?.teaches_online ?? true}/>Online (video call / Google Meet)</label>
          <label className="check-label"><input type="checkbox" name="teachesInPerson" value="true" defaultChecked={profile?.teaches_in_person ?? false}/>In person</label>
        </fieldset>
        <label className="check-label"><input type="checkbox" name="visible" value="true" defaultChecked={profile?.visible ?? true}/>Show on the public tutors directory</label>
      </ManagedForm>
    </div>
    <p><small>Learning materials and assignments are not yet available and will appear here as those features launch.</small></p>
  </div>;
}
