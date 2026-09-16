import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicCourses } from "@/lib/admissions/public-catalogue";
export const dynamic="force-dynamic";
export default async function CoursePage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const course=(await getPublicCourses()).find(row=>row.id===id);
  if (!course) notFound();
  return <main className="account-content narrow-content"><Link href="/#courses">← Browse courses</Link>
    <section className="account-panel"><span className="eyebrow">Level {course.level} · {course.university}</span><h1>{course.name}</h1><p>{course.description}</p>
    <p>Request academic support through your Summit ScholarsBridge application. Admissions will confirm your course arrangements.</p>
    <div className="actions"><Link className="btn teal" href="/register">Create a free account</Link><Link className="btn outline-dark" href="/portal/applications">Continue your application</Link></div>
    <p>Summit ScholarsBridge provides independent academic support. Its records are not official university transcripts.</p></section>
  </main>;
}
