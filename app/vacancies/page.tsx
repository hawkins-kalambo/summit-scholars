import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
function Brand() { return <div className="brand"><span className="peak">▲</span><span><b>Summit ScholarsBridge</b><small>Academic Solutions</small></span></div>; }
type Vacancy = { id: string; title: string; subjects: string; description: string; closes_at: string | null };

export default async function VacanciesPage() {
  const db = await createSupabaseServerClient();
  const { data } = await db.from("tutor_vacancies").select("id,title,subjects,description,closes_at").eq("is_open", true).order("created_at", { ascending: false });
  const vacancies = (data ?? []) as Vacancy[];
  return <div className="site">
    <header className="top"><Brand/><nav><Link href="/">Home</Link><Link href="/#courses">Courses</Link><Link href="/tutors">Our tutors</Link></nav><div><Link className="link" href="/login/student">Log in</Link><Link className="btn gold" href="/register">Register now <ArrowRight size={17}/></Link></div></header>
    <main>
      <section className="section"><div className="heading"><div><span className="eyebrow">Careers</span><h2>Open tutor positions</h2></div><p>We post a vacancy here when we&rsquo;re looking for tutors in a specific subject or level.</p></div>
        {!vacancies.length ? <p>There are no open tutor positions right now. Check back soon.</p> : <div className="workspace-grid">{vacancies.map(vacancy => <article className="account-panel" key={vacancy.id}>
          <span className="eyebrow">{vacancy.subjects}</span>
          <h2>{vacancy.title}</h2>
          <p>{vacancy.description}</p>
          {vacancy.closes_at && <p><small>Applications close {new Date(vacancy.closes_at).toLocaleDateString("en-GB")}.</small></p>}
          <Link className="btn gold" href={"/apply-to-teach?vacancy=" + vacancy.id}>Apply for this role <ArrowRight size={17}/></Link>
        </article>)}</div>}
      </section>
    </main>
    <footer><Brand/><p>St. Augustine Hall, next to St. Augustine Catholic Church</p><div><b>0989 127 308 / 0998 878 269</b><span>summitscholarsbridge@gmail.com</span></div></footer>
  </div>;
}
