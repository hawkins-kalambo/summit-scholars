import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
function Brand() { return <div className="brand"><span className="peak">▲</span><span><b>Summit ScholarsBridge</b><small>Academic Solutions</small></span></div>; }
type TutorProfile = { display_name: string; headline: string; bio: string; subjects: string };

export default async function TutorsPage() {
  const db = await createSupabaseServerClient();
  const { data } = await db.from("tutor_profiles").select("display_name,headline,bio,subjects").eq("visible", true).order("display_name");
  const tutors = (data ?? []) as TutorProfile[];
  return <div className="site">
    <header className="top"><Brand/><nav><Link href="/">Home</Link><Link href="/#courses">Courses</Link><Link href="/apply-to-teach">Apply to teach</Link></nav><div><Link className="link" href="/login/student">Log in</Link><Link className="btn gold" href="/register">Register now <ArrowRight size={17}/></Link></div></header>
    <main>
      <section className="section"><div className="heading"><div><span className="eyebrow">Our team</span><h2>Meet our tutors</h2></div><p>Experienced, verified tutors supporting students online and face-to-face.</p></div>
        {!tutors.length ? <p>Tutor profiles will appear here as our team publishes them.</p> : <div className="workspace-grid">{tutors.map((tutor, index) => <article className="account-panel" key={index}>
          <span className="eyebrow">{tutor.subjects}</span>
          <h2>{tutor.display_name}</h2>
          <p><strong>{tutor.headline}</strong></p>
          <p>{tutor.bio}</p>
        </article>)}</div>}
      </section>
      <section className="cta"><div><span className="eyebrow">Want to teach with us?</span><h2>Share your qualifications.</h2><p>We review every application and welcome tutors across subjects and levels.</p></div><Link className="btn gold" href="/apply-to-teach">Apply to teach <ArrowRight size={17}/></Link></section>
    </main>
    <footer><Brand/><p>St. Augustine Hall, next to St. Augustine Catholic Church</p><div><b>0989 127 308 / 0998 878 269</b><span>summitscholarsbridge@gmail.com</span></div></footer>
  </div>;
}
