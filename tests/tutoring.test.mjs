import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("tutors are assigned to courses and can only read their own assigned courses and students", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4].map(n => `70000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, tutor, otherTutor, student] = ids;
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
    for (const path of ["../supabase/migrations/202609150001_foundation.sql", "../supabase/seed.sql", "../supabase/migrations/202609150002_admissions.sql", "../supabase/migrations/202609190004_tutor_assignments.sql"]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [tutor, "tutor"], [otherTutor, "tutor"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const course = (await db.query("select id from public.courses where code='SSB-PRECALC'")).rows[0].id;
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };

    await asUser(tutor);
    await assert.rejects(db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [course, tutor]), /Academic configuration/);
    assert.equal((await db.query("select * from public.tutor_courses()")).rows.length, 0);

    await asUser(academicAdmin);
    await assert.rejects(db.query("select public.assign_course_tutor($1,$2,true,'x')", [course, tutor]), /Provide a reason/);
    await assert.rejects(db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor to course')", [course, student]), /does not hold the tutor role/);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor to course')", [course, tutor]);
    const tutors = (await db.query("select id from public.list_tutors()")).rows.map(row => row.id);
    assert.ok(tutors.includes(tutor) && tutors.includes(otherTutor));

    // Set up a minimal enrolled student directly (the enrolment pathway itself is covered elsewhere).
    const programme = "70000000-0000-4000-8000-000000000010";
    const period = "70000000-0000-4000-8000-000000000011";
    const application = "70000000-0000-4000-8000-000000000012";
    await db.exec("reset role");
    await db.query("insert into public.programmes(id,university_id,name,code) values($1,$2,'Test Programme','TESTPROG')", [programme, university]);
    await db.query("insert into public.academic_periods(id,university_id,name,registration_opens,registration_closes) values($1,$2,'Test Period','2000-01-01','2099-12-31')", [period, university]);
    await db.query("update public.profiles set full_name='Test Student' where id=$1", [student]);
    await db.query("insert into public.applications(id,applicant_id,full_name,university_id,programme_id,period_id,year_of_study,phone,learning_mode,status) values($1,$2,'Test Student',$3,$4,$5,1,'0999123456','online','approved')", [application, student, university, programme, period]);
    await db.query("insert into public.enrolments(student_id,course_id,period_id,application_id,status) values($1,$2,$3,$4,'active')", [student, course, period, application]);

    await asUser(tutor);
    const courses = (await db.query("select course_id,student_count from public.tutor_courses()")).rows;
    assert.equal(courses.length, 1);
    assert.equal(String(courses[0].course_id), course);
    assert.equal(Number(courses[0].student_count), 1);
    const roster = (await db.query("select full_name from public.tutor_course_roster($1)", [course])).rows;
    assert.deepEqual(roster, [{ full_name: "Test Student" }]);

    await asUser(otherTutor);
    assert.equal((await db.query("select * from public.tutor_courses()")).rows.length, 0);
    await assert.rejects(db.query("select public.tutor_course_roster($1)", [course]), /not assigned to this course/);

    await asUser(student);
    await assert.rejects(db.query("select * from public.tutor_courses()"), /Tutor access required/);
  } finally { await db.close(); }
});
