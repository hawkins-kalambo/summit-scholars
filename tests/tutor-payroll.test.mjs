import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("tutor payroll requires a rate, counts only completed classes in period, and a separate decider from the requester", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6].map(n => `c0000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, tutor, otherTutor, financeOfficer, financeAdministrator, dualFinance] = ids;
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
      "../supabase/migrations/202609190002_finance_administrator_role.sql",
      "../supabase/migrations/202609190004_tutor_assignments.sql",
      "../supabase/migrations/202609200001_class_sessions_attendance.sql",
      "../supabase/migrations/202609210001_class_sessions_google_meet.sql",
      "../supabase/migrations/202609210002_tutor_payroll.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, roles] of [
      [academicAdmin, ["academic_admin"]], [tutor, ["tutor"]], [otherTutor, ["tutor"]],
      [financeOfficer, ["finance_officer"]], [financeAdministrator, ["finance_administrator"]],
      [dualFinance, ["finance_officer", "finance_administrator"]],
    ]) {
      for (const role of roles) await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    const precalc = await scalar("select id as result from public.courses where code='SSB-PRECALC'");

    await asUser(academicAdmin);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [precalc, tutor]);

    await asUser(tutor);
    const session1 = await scalar("select public.schedule_class_session($1,'Class 1','Room 1',$2,$3,null,'Schedule class') as result", [precalc, "2030-01-05T10:00:00Z", "2030-01-05T11:00:00Z"]);
    const session2 = await scalar("select public.schedule_class_session($1,'Class 2','Room 1',$2,$3,null,'Schedule class') as result", [precalc, "2030-01-06T10:00:00Z", "2030-01-06T11:00:00Z"]);
    const outsidePeriod = await scalar("select public.schedule_class_session($1,'Class 3','Room 1',$2,$3,null,'Schedule class') as result", [precalc, "2030-02-05T10:00:00Z", "2030-02-05T11:00:00Z"]);
    const cancelled = await scalar("select public.schedule_class_session($1,'Class 4','Room 1',$2,$3,null,'Schedule class') as result", [precalc, "2030-01-07T10:00:00Z", "2030-01-07T11:00:00Z"]);
    await db.query("select public.confirm_class_session($1,'completed',$2,$3,'[]'::jsonb,'Held as scheduled')", [session1, "2030-01-05T10:00:00Z", "2030-01-05T11:00:00Z"]);
    await db.query("select public.confirm_class_session($1,'completed',$2,$3,'[]'::jsonb,'Held as scheduled')", [session2, "2030-01-06T10:00:00Z", "2030-01-06T11:00:00Z"]);
    await db.query("select public.confirm_class_session($1,'completed',$2,$3,'[]'::jsonb,'Held as scheduled')", [outsidePeriod, "2030-02-05T10:00:00Z", "2030-02-05T11:00:00Z"]);
    await db.query("select public.confirm_class_session($1,'cancelled',null,null,null,'Tutor unavailable')", [cancelled]);

    // Only finance_administrator can set a rate, and only for an actual tutor.
    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.set_tutor_rate($1,5000,'Standard rate')", [tutor]), /Finance Administrator permission required/);

    await asUser(financeAdministrator);
    await assert.rejects(db.query("select public.set_tutor_rate($1,5000,'Standard rate')", [academicAdmin]), /not a tutor/);

    // No rate yet: preparing a run must fail even though completed classes exist.
    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.prepare_payroll_run($1,'2030-01-01','2030-01-31','January pay')", [tutor]), /No pay rate/);

    await asUser(financeAdministrator);
    await db.query("select public.set_tutor_rate($1,5000,'Standard rate')", [tutor]);

    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.prepare_payroll_run($1,'2030-01-01','2030-01-31','January pay')", [otherTutor]), /No pay rate/);
    await assert.rejects(db.query("select public.prepare_payroll_run($1,'2030-03-01','2030-03-31','March pay')", [tutor]), /No payable classes/);
    const run = await scalar("select public.prepare_payroll_run($1,'2030-01-01','2030-01-31','January pay') as result", [tutor]);
    assert.ok(run);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select session_count,rate_amount,total_amount,status from public.payroll_runs where id=$1", [run])).rows[0],
      { session_count: 2, rate_amount: "5000.00", total_amount: "10000.00", status: "pending" },
    );

    // Sessions already claimed by a pending run cannot be double-booked into another run.
    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.prepare_payroll_run($1,'2030-01-01','2030-01-31','Repeat run')", [tutor]), /No payable classes/);

    // Separation of duties: the preparer cannot also decide, even holding both roles.
    await asUser(dualFinance);
    const selfRun = await scalar("select public.prepare_payroll_run($1,'2030-02-01','2030-02-28','February pay') as result", [tutor]);
    await assert.rejects(db.query("select public.decide_payroll_run($1,true,'Approving my own run')", [selfRun]), /different Finance Administrator/);

    await asUser(financeAdministrator);
    await assert.rejects(db.query("select public.decide_payroll_run($1,null,'Missing decision')", [run]), /Provide a decision/);
    await db.query("select public.decide_payroll_run($1,true,'Approved for disbursement')", [run]);
    await assert.rejects(db.query("select public.decide_payroll_run($1,true,'Repeat approval')", [run]), /no longer pending/);
    await db.query("select public.decide_payroll_run($1,false,'February overlaps January, resubmit')", [selfRun]);
    await db.exec("reset role");
    assert.equal(await scalar("select status as result from public.payroll_runs where id=$1", [run]), "approved");
    assert.equal(await scalar("select status as result from public.payroll_runs where id=$1", [selfRun]), "rejected");

    // A rejected run frees its sessions back up for a future run.
    await asUser(financeOfficer);
    const rerun = await scalar("select public.prepare_payroll_run($1,'2030-02-01','2030-02-28','February pay retry') as result", [tutor]);
    assert.ok(rerun);

    // Read scoping: the tutor sees their own rate/runs; a different tutor sees none of it.
    await asUser(tutor);
    assert.equal(await scalar("select count(*)::int as result from public.tutor_rates where tutor_id=$1", [tutor]), 1);
    assert.equal(await scalar("select count(*)::int as result from public.payroll_runs where tutor_id=$1", [tutor]), 3);
    await asUser(otherTutor);
    assert.equal(await scalar("select count(*)::int as result from public.payroll_runs where tutor_id=$1", [tutor]), 0);

    // Finance staff can list tutors and rates via the security-definer helper.
    await asUser(financeOfficer);
    const tutors = (await db.query("select * from public.finance_tutors()")).rows;
    assert.ok(tutors.some(row => row.tutor_id === tutor && Number(row.rate_amount) === 5000));
  } finally { await db.close(); }
});
