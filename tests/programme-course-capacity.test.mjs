import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("programmes link to departments with a duration, and course capacity blocks admission once full", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6].map(n => `80000000-0000-4000-8000-00000000000${n}`);
  const [systemAdmin, academicAdmin, admissionsOfficer, superAdmin, student1, student2] = ids;
  const university = "10000000-0000-4000-8000-000000000001";
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text default 'test@example.test');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
    `);
    for (const path of [
      "../supabase/migrations/202609150001_foundation.sql", "../supabase/seed.sql",
      "../supabase/migrations/202609150002_admissions.sql",
      "../supabase/migrations/202609190001_academic_structure.sql",
      "../supabase/migrations/202609190005_programme_department_course_capacity.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [[systemAdmin, academicAdmin, admissionsOfficer, superAdmin]]);
    for (const [id, role] of [[systemAdmin, "system_admin"], [academicAdmin, "academic_admin"], [admissionsOfficer, "admissions_officer"], [superAdmin, "super_admin"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;

    await asUser(superAdmin);
    await db.query("select public.configure_admissions(true,$1,'SSB',false,'Test settings')", ["Test privacy notice used only by automated tests."]);

    await asUser(systemAdmin);
    const faculty = await scalar("select public.configure_academic_structure('faculty',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Faculty of Science", code: "SCI", university_id: university })]);
    const department = await scalar("select public.configure_academic_structure('department',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Department of Mathematics", code: "MATH", faculty_id: faculty })]);

    await asUser(academicAdmin);
    const programme = await scalar("select public.configure_academics('programme',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "BSc Mathematics", code: "BSCMATH", university_id: university, department_id: department, duration_years: 4 })]);
    assert.deepEqual(
      (await db.query("select department_id,duration_years from public.programmes where id=$1", [programme])).rows[0],
      { department_id: department, duration_years: 4 },
    );
    const period = await scalar("select public.configure_academics('period',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Test intake", university_id: university, registration_opens: "2000-01-01", registration_closes: "2099-12-31", active: true })]);
    const course = await scalar("select public.configure_academics('course',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Capacity-limited Course", code: "CAP1", university_id: university, level: 1, capacity: 1 })]);
    assert.equal(await scalar("select capacity as result from public.courses where id=$1", [course]), 1);
    await asUser(superAdmin);
    await db.query("select public.publish_course($1,true,'Test approval')", [course]);

    async function applyAndDecide(student) {
      await asUser(student);
      const application = await scalar("select public.save_application(null,0,$1,$2,$3,1,'0999123456','online',$4::uuid[]) as result", [university, programme, period, [course]]);
      await db.query("select public.submit_application($1,1,true,2)", [application]);
      await asUser(admissionsOfficer);
      await db.query("select public.review_application($1,2,'begin_review','Review started')", [application]);
      await db.query("select public.review_application($1,3,'recommend_approval','Documents checked')", [application]);
      await asUser(academicAdmin);
      return application;
    }

    const firstApplication = await applyAndDecide(student1);
    await db.query("select public.decide_application($1,4,'approve','Admission approved')", [firstApplication]);
    assert.equal(await scalar("select count(*)::int as result from public.enrolments where course_id=$1", [course]), 1);
    await db.exec("reset role");
    assert.equal(await scalar("select account_status as result from public.profiles where id=$1", [student1]), "active");

    const secondApplication = await applyAndDecide(student2);
    await assert.rejects(db.query("select public.decide_application($1,4,'approve','Admission approved')", [secondApplication]), /reached capacity/);
    assert.equal(await scalar("select count(*)::int as result from public.enrolments where course_id=$1", [course]), 1);
    await db.exec("reset role");
    assert.equal(await scalar("select account_status as result from public.profiles where id=$1", [student2]), "pending");
  } finally { await db.close(); }
});
