import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";
export type PublicCourse = { id: string; name: string; description: string; level: number; university: string };
const initialCourses = [
 ["precalculus","Precalculus","Functions and foundational mathematics"],
 ["general-biology","General Biology","Cells, genetics and living systems"],
 ["general-physics","General Physics I","Mechanics, forces and energy"],
 ["general-chemistry","General Chemistry I","Matter and chemical reactions"],
 ["communication","Communication Skills","Academic writing and presentations"],
 ["computing","End User Computing","Digital productivity skills"],
];
export async function getPublicCourses(): Promise<PublicCourse[]> {
  const config=supabaseConfig();
  if (!config) return initialCourses.map(([id,name,description])=>({id,name,description,level:1,university:"Mzuzu University"}));
  // Always query anonymously: a signed-in staff member must not expose drafts on the public site.
  const db=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
  const [courses,universities]=await Promise.all([
    db.from("courses").select("id,name,description,level,university_id").order("name"),
    db.from("universities").select("id,name"),
  ]);
  if (courses.error || universities.error) return [];
  const names=new Map((universities.data ?? []).map(row=>[row.id,row.name]));
  return (courses.data ?? []).map(row=>({id:row.id,name:row.name,description:row.description,level:row.level,university:String(names.get(row.university_id) ?? "")}));
}
