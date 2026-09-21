import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("tutors schedule conflict-checked classes, confirm them with attendance, and access stays scoped", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6].map(n => `90000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, tutor, otherTutor, student1, student2, superAdmin] = ids;
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
      "../supabase/migrations/202609190004_tutor_assignments.sql",
      "../supabase/migrations/202609200001_class_sessions_attendance.sql",
      "../supabase/migrations/202609210001_class_sessions_google_meet.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [tutor, "tutor"], [otherTutor, "tutor"], [superAdmin, "super_admin"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    const precalc = await scalar("select id as result from public.courses where code='SSB-PRECALC'");
    const biology = await scalar("select id as result from public.courses where code='SSB-BIO'");

    await asUser(academicAdmin);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [precalc, tutor]);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [biology, otherTutor]);

    // Minimal enrolment fixture for student1 (the enrolment pathway itself is covered elsewhere).
    const programme = "90000000-0000-4000-8000-000000000010";
    const period = "90000000-0000-4000-8000-000000000011";
    const application = "90000000-0000-4000-8000-000000000012";
    await db.exec("reset role");
    await db.query("insert into public.programmes(id,university_id,name,code) values($1,$2,'Test Programme','TESTPROG')", [programme, university]);
    await db.query("insert into public.academic_periods(id,university_id,name,registration_opens,registration_closes) values($1,$2,'Test Period','2000-01-01','2099-12-31')", [period, university]);
    await db.query("insert into public.applications(id,applicant_id,full_name,university_id,programme_id,period_id,year_of_study,phone,learning_mode,status) values($1,$2,'Test Student',$3,$4,$5,1,'0999123456','online','approved')", [application, student1, university, programme, period]);
    await db.query("insert into public.enrolments(student_id,course_id,period_id,application_id,status) values($1,$2,$3,$4,'active')", [student1, precalc, period, application]);

    const start = "2030-01-01T10:00:00Z";
    const end = "2030-01-01T11:00:00Z";

    await asUser(otherTutor);
    await assert.rejects(db.query("select public.schedule_class_session($1,'Intro','Room 1',$2,$3,null,'Schedule class')", [precalc, start, end]), /not assigned to this course/);

    await asUser(tutor);
    const session = await scalar("select public.schedule_class_session($1,'Intro','Room 1',$2,$3,null,'Schedule class') as result", [precalc, start, end]);
    await assert.rejects(db.query("select public.schedule_class_session($1,'Overlap','Room 2',$2,$3,null,'Schedule class')", [precalc, "2030-01-01T10:30:00Z", "2030-01-01T11:30:00Z"]), /already have another class/);

    await asUser(otherTutor);
    await assert.rejects(db.query("select public.schedule_class_session($1,'Overlap','Room 1',$2,$3,null,'Schedule class')", [biology, "2030-01-01T10:30:00Z", "2030-01-01T11:30:00Z"]), /venue is already booked/);
    const otherSession = await scalar("select public.schedule_class_session($1,'No conflict','Room 2',$2,$3,null,'Schedule class') as result", [biology, "2030-01-01T10:30:00Z", "2030-01-01T11:30:00Z"]);
    assert.ok(otherSession);

    const googleSession = await scalar(
      "select public.schedule_class_session($1,'Online class','Online',$2,$3,'https://meet.google.com/abc-defg-hij','Schedule class','evt-123') as result",
      [biology, "2030-01-01T13:00:00Z", "2030-01-01T14:00:00Z"],
    );
    assert.deepEqual(
      (await db.query("select meeting_link,google_event_id from public.class_sessions where id=$1", [googleSession])).rows[0],
      { meeting_link: "https://meet.google.com/abc-defg-hij", google_event_id: "evt-123" },
    );

    await asUser(tutor);
    await db.query(
      "select public.confirm_class_session($1,'completed',$2,$3,$4::jsonb,'Class held as scheduled')",
      [session, start, end, JSON.stringify([{ student_id: student1, status: "present" }])],
    );
    assert.deepEqual(
      (await db.query("select status,actual_starts_at is not null as confirmed from public.class_sessions where id=$1", [session])).rows[0],
      { status: "completed", confirmed: true },
    );
    assert.equal(await scalar("select status as result from public.session_attendance where session_id=$1 and student_id=$2", [session, student1]), "present");
    await assert.rejects(db.query("select public.confirm_class_session($1,'completed',$2,$3,'[]'::jsonb,'Repeat confirmation')", [session, start, end]), /already been confirmed/);

    const secondSession = await scalar("select public.schedule_class_session($1,'Follow-up','Room 3',$2,$3,null,'Schedule class') as result", [precalc, "2030-01-02T10:00:00Z", "2030-01-02T11:00:00Z"]);
    await assert.rejects(
      db.query("select public.confirm_class_session($1,'completed',$2,$3,$4::jsonb,'Class held')", [secondSession, "2030-01-02T10:00:00Z", "2030-01-02T11:00:00Z", JSON.stringify([{ student_id: student2, status: "present" }])]),
      /not an enrolled student/,
    );
    await db.query("select public.confirm_class_session($1,'cancelled',null,null,null,'Tutor was unavailable')", [secondSession]);
    assert.equal(await scalar("select status as result from public.class_sessions where id=$1", [secondSession]), "cancelled");
    assert.equal(await scalar("select count(*)::int as result from public.session_attendance where session_id=$1", [secondSession]), 0);

    await asUser(student1);
    assert.equal(await scalar("select count(*)::int as result from public.class_sessions where id=$1", [session]), 1);
    assert.equal(await scalar("select status as result from public.session_attendance where session_id=$1 and student_id=$2", [session, student1]), "present");

    await asUser(student2);
    assert.equal(await scalar("select count(*)::int as result from public.class_sessions where id=$1", [session]), 0);
    assert.equal(await scalar("select count(*)::int as result from public.session_attendance where session_id=$1", [session]), 0);
  } finally { await db.close(); }
});
