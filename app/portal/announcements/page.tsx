import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { postAnnouncement, deleteAnnouncement } from "./actions";
export const dynamic = "force-dynamic";
type Announcement = { id: string; course_id: string | null; title: string; body: string; author_id: string; created_at: string; courses: { name: string; code: string } | null };
type TutorCourse = { course_id: string; name: string; code: string };
type AdminCourse = { id: string; name: string; code: string };

export default async function AnnouncementsPage() {
  const account = await requireAccount();
  const db = await createSupabaseServerClient();
  const isAcademicAdmin = account.status === "active" && account.roles.some(role => role === "academic_admin" || role === "super_admin");
  const isTutor = account.status === "active" && account.roles.includes("tutor");
  const [{ data, error }, tutorCoursesResult, adminCoursesResult] = await Promise.all([
    db.from("announcements").select("id,course_id,title,body,author_id,created_at,courses(name,code)").order("created_at", { ascending: false }),
    isTutor ? db.rpc("tutor_courses") : Promise.resolve({ data: [] }),
    isAcademicAdmin ? db.from("courses").select("id,name,code").eq("published", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error("Unable to load announcements.");
  const announcements = (data ?? []) as unknown as Announcement[];
  const tutorCourses = (tutorCoursesResult.data ?? []) as TutorCourse[];
  const adminCourses = (adminCoursesResult.data ?? []) as AdminCourse[];
  const canPost = isTutor || isAcademicAdmin;
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Communication</span><h1>Announcements</h1><p>Course updates and site-wide notices.</p></div></div>
    {canPost && <div className="panel"><header><h2>Post an announcement</h2></header>
      <ManagedForm action={postAnnouncement} label="Post">
        <label>Scope<select name="courseId" defaultValue="" required>
          <option value="" disabled>Choose…</option>
          {isAcademicAdmin && <option value="">Site-wide (everyone)</option>}
          {tutorCourses.map(course => <option key={course.course_id} value={course.course_id}>{course.name} ({course.code})</option>)}
          {isAcademicAdmin && adminCourses.map(course => <option key={course.id} value={course.id}>{course.name} ({course.code})</option>)}
        </select></label>
        <label>Title<input name="title" required minLength={2} maxLength={200}/></label>
        <label>Announcement<textarea name="body" required minLength={5} maxLength={4000}/></label>
        <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
      </ManagedForm>
    </div>}
    <div className="dashgrid">
      {!announcements.length && <p>No announcements yet.</p>}
      {announcements.map(announcement => {
        const canDelete = announcement.author_id === account.user.id || isAcademicAdmin;
        return <div className="panel" key={announcement.id}>
          <header><h2>{announcement.title}</h2><span className="status-badge">{announcement.courses ? announcement.courses.code : "Site-wide"}</span></header>
          <p>{announcement.body}</p>
          <p><small>{new Date(announcement.created_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}</small></p>
          {canDelete && <details><summary>Remove</summary><ManagedForm action={deleteAnnouncement} label="Remove">
            <input type="hidden" name="announcementId" value={announcement.id}/>
            <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm></details>}
        </div>;
      })}
    </div>
  </div>;
}
