import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { startThread } from "./actions";
export const dynamic = "force-dynamic";
type Thread = { thread_id: string; course_id: string; course_name: string; course_code: string; other_id: string; other_name: string; last_message: string | null; last_message_at: string | null; unread_count: number };
type Option = { value: string; label: string };

export default async function MessagesPage() {
  const account = await requireAccount();
  const isStudent = account.status === "active" && account.roles.includes("student");
  const isTutor = account.status === "active" && account.roles.includes("tutor");
  if (!isStudent && !isTutor) notFound();
  const db = await createSupabaseServerClient();
  const { data: threadsData, error } = await db.rpc("my_message_threads");
  if (error) throw new Error("Unable to load your messages.");
  const threads = (threadsData ?? []) as Thread[];

  let options: Option[] = [];
  if (isStudent) {
    const { data } = await db.rpc("my_course_tutors");
    options = ((data ?? []) as { course_id: string; course_name: string; course_code: string; tutor_id: string; tutor_name: string }[])
      .map(row => ({ value: row.course_id + ":" + row.tutor_id, label: row.tutor_name + " — " + row.course_name + " (" + row.course_code + ")" }));
  } else if (isTutor) {
    const { data: coursesData } = await db.rpc("tutor_courses");
    const courses = (coursesData ?? []) as { course_id: string; name: string; code: string }[];
    const rosters = await Promise.all(courses.map(course => db.rpc("tutor_course_roster", { p_course_id: course.course_id })));
    options = courses.flatMap((course, index) => ((rosters[index].data ?? []) as { student_id: string; full_name: string; status: string }[])
      .filter(student => student.status !== "withdrawn")
      .map(student => ({ value: course.course_id + ":" + student.student_id, label: student.full_name + " — " + course.name + " (" + course.code + ")" })));
  }

  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Communication</span><h1>Messages</h1><p>Direct messages between you and {isStudent ? "your tutors" : "your students"}, scoped to a shared course.</p></div></div>
    {options.length > 0 && <div className="panel"><header><h2>Start a conversation</h2></header>
      <ManagedForm action={startThread} label="Start">
        <label>Message<select name="target" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      </ManagedForm>
    </div>}
    <div className="dashgrid">
      {!threads.length && <p>No conversations yet.</p>}
      {threads.map(thread => <div className="panel" key={thread.thread_id}>
        <header><h2><Link href={"/portal/messages/" + thread.thread_id}>{thread.other_name}</Link></h2><span className="status-badge">{thread.course_code}</span></header>
        <p>{thread.last_message ?? "No messages yet."}</p>
        {thread.unread_count > 0 && <p><span className="status-badge">{thread.unread_count} unread</span></p>}
      </div>)}
    </div>
  </div>;
}
