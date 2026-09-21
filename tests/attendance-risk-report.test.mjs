import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("attendance risk report flags students below the threshold and is restricted to academic administrators", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4].map(n => `d0000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, tutor, student1, student2] = ids;
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
      "../supabase/migrations/202609200005_attendance_risk_report.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [[academicAdmin, tutor]]);
    await db.query("update public.profiles set full_name='Student One' where id=$1", [student1]);
    await db.query("update public.profiles set full_name='Student Two' where id=$1", [student2]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [tutor, "tutor"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const course = (await db.query("select id from public.courses where code='SSB-PRECALC'")).rows[0].id;
    const session1 = "d0000000-0000-4000-8000-000000000010";
    const session2 = "d0000000-0000-4000-8000-000000000011";
    await db.query(
      "insert into public.class_sessions(id,course_id,tutor_id,topic,venue,starts_at,ends_at,status,actual_starts_at,actual_ends_at) values($1,$2,$3,'Session 1','Room 1','2030-01-01T10:00:00Z','2030-01-01T11:00:00Z','completed','2030-01-01T10:00:00Z','2030-01-01T11:00:00Z')",
      [session1, course, tutor],
    );
    await db.query(
      "insert into public.class_sessions(id,course_id,tutor_id,topic,venue,starts_at,ends_at,status,actual_starts_at,actual_ends_at) values($1,$2,$3,'Session 2','Room 1','2030-01-02T10:00:00Z','2030-01-02T11:00:00Z','completed','2030-01-02T10:00:00Z','2030-01-02T11:00:00Z')",
      [session2, course, tutor],
    );
    await db.query("insert into public.session_attendance(session_id,student_id,status) values($1,$2,'present'),($1,$3,'present')", [session1, student1, student2]);
    await db.query("insert into public.session_attendance(session_id,student_id,status) values($1,$2,'absent'),($1,$3,'present')", [session2, student1, student2]);

    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };

    await asUser(academicAdmin);
    const rows = (await db.query("select student_id,full_name,attended_count,total_count,attendance_rate from public.attendance_risk_report(75)")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].student_id, student1);
    assert.equal(rows[0].full_name, "Student One");
    assert.equal(Number(rows[0].attended_count), 1);
    assert.equal(Number(rows[0].total_count), 2);
    assert.equal(Number(rows[0].attendance_rate), 50);

    const allRows = (await db.query("select student_id from public.attendance_risk_report(0)")).rows;
    assert.equal(allRows.length, 0);

    await asUser(tutor);
    await assert.rejects(db.query("select * from public.attendance_risk_report(75)"), /Academic administration permission required/);
  } finally { await db.close(); }
});
