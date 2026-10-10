import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("tutor draft, academic review, student-visible result: assignment grades stay private until approved", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5].map(n => `d0000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, tutor, otherTutor, student1, student2] = ids;
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
      "../supabase/migrations/202610070001_assignments.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [tutor, "tutor"], [otherTutor, "tutor"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    const precalc = await scalar("select id as result from public.courses where code='SSB-PRECALC'");
    await asUser(academicAdmin);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [precalc, tutor]);

    // Minimal enrolment fixture for student1 only (student2 stays unenrolled).
    const programme = "d0000000-0000-4000-8000-000000000010";
    const period = "d0000000-0000-4000-8000-000000000011";
    const application = "d0000000-0000-4000-8000-000000000012";
    await db.exec("reset role");
    await db.query("insert into public.programmes(id,university_id,name,code) values($1,$2,'Test Programme','TESTPROG')", [programme, university]);
    await db.query("insert into public.academic_periods(id,university_id,name,registration_opens,registration_closes) values($1,$2,'Test Period','2000-01-01','2099-12-31')", [period, university]);
    await db.query("insert into public.applications(id,applicant_id,full_name,university_id,programme_id,period_id,year_of_study,phone,learning_mode,status) values($1,$2,'Test Student',$3,$4,$5,1,'0999123456','online','approved')", [application, student1, university, programme, period]);
    await db.query("insert into public.enrolments(student_id,course_id,period_id,application_id,status) values($1,$2,$3,$4,'active')", [student1, precalc, period, application]);

    // Only the assigned tutor can create an assignment for the course.
    await asUser(otherTutor);
    await assert.rejects(db.query("select public.create_assignment($1,'Essay 1','Write a 500-word essay on functions.',100,'2000-01-01T00:00:00Z','Setting homework')", [precalc]), /not assigned to this course/);

    await asUser(tutor);
    const dueAt = "2030-01-01T00:00:00Z";
    const assignment = await scalar("select public.create_assignment($1,'Essay 1','Write a 500-word essay on functions.',100,$2,'Setting homework') as result", [precalc, dueAt]);
    assert.ok(assignment);
    await assert.rejects(db.query("select public.create_assignment($1,'x','short',100,$2,'Setting homework')", [precalc, dueAt]), /Enter a title/);

    // Unenrolled students cannot submit.
    await asUser(student2);
    await assert.rejects(db.query("select public.submit_assignment($1,'bad-path','essay.pdf','application/pdf',1000)", [assignment]), /not enrolled/);

    // Submitting requires the file to already be uploaded to the right path.
    await asUser(student1);
    const badPath = student1 + "/" + assignment + "/essay.pdf";
    await assert.rejects(db.query("select public.submit_assignment($1,$2,'essay.pdf','application/pdf',1000)", [assignment, badPath]), /Upload the file first/);
    await db.query("insert into storage.objects(bucket_id,name) values('assignment-submissions',$1)", [badPath]);
    const submission = await scalar("select public.submit_assignment($1,$2,'essay.pdf','application/pdf',1000) as result", [assignment, badPath]);
    assert.ok(submission);
    // Raw-table reads require reset role: students have no direct SELECT
    // grant on assignment_submissions by design (see the RLS check further down).
    await db.exec("reset role");
    assert.equal(await scalar("select is_late as result from public.assignment_submissions where id=$1", [submission]), false);
    await asUser(student1);

    // A student can see their own submission, but the grade is hidden until approved.
    let myView = (await db.query("select * from public.my_assignment_submission($1)", [assignment])).rows[0];
    assert.equal(myView.file_name, "essay.pdf");
    assert.equal(myView.score_status, "pending");
    assert.equal(myView.score, null);

    // Resubmission (replace) is allowed while still pending.
    const secondPath = student1 + "/" + assignment + "/essay-v2.pdf";
    await db.exec("reset role");
    await db.query("insert into storage.objects(bucket_id,name) values('assignment-submissions',$1)", [secondPath]);
    await asUser(student1);
    await db.query("select public.submit_assignment($1,$2,'essay-v2.pdf','application/pdf',2000)", [assignment, secondPath]);
    await db.exec("reset role");
    assert.equal(await scalar("select count(*)::int as result from public.assignment_submissions where assignment_id=$1 and student_id=$2", [assignment, student1]), 1);

    // Only a tutor assigned to the course can grade, and only within range.
    await asUser(otherTutor);
    await assert.rejects(db.query("select public.grade_assignment_submission($1,80,'Good work','Grading')", [submission]), /not assigned to this course/);

    await asUser(tutor);
    await assert.rejects(db.query("select public.grade_assignment_submission($1,150,'Good work','Grading')", [submission]), /Enter a score between 0 and the assignment maximum/);
    await db.query("select public.grade_assignment_submission($1,85,'Good work, minor issues with structure.','Grading submission')", [submission]);
    assert.equal(await scalar("select score_status as result from public.assignment_submissions where id=$1", [submission]), "graded");

    // Still hidden from the student even though it's graded.
    await asUser(student1);
    myView = (await db.query("select * from public.my_assignment_submission($1)", [assignment])).rows[0];
    assert.equal(myView.score_status, "graded");
    assert.equal(myView.score, null);
    assert.equal(myView.grading_note, null);

    // Tutor can see the roster-style view with the student's name.
    await asUser(tutor);
    const tutorView = (await db.query("select * from public.tutor_assignment_submissions($1)", [assignment])).rows[0];
    // profiles.full_name defaults to "Student" from the account-creation
    // trigger (we never set raw_user_meta_data); the application's own
    // full_name field above ("Test Student") is a separate, unrelated value.
    assert.equal(tutorView.full_name, "Student");
    assert.equal(tutorView.score, "85.00");

    // Only academic_admin can approve, and a rejection sends it back to the tutor.
    await asUser(tutor);
    await assert.rejects(db.query("select public.approve_assignment_grade($1,true,'Approving my own grade')", [submission]), /Academic administration permission required/);

    await asUser(academicAdmin);
    const pendingBeforeReject = (await db.query("select * from public.assignment_grades_pending_approval()")).rows;
    assert.equal(pendingBeforeReject.length, 1);
    assert.equal(pendingBeforeReject[0].student_name, "Student");

    await db.query("select public.approve_assignment_grade($1,false,'Please add more detail on limits.')", [submission]);
    assert.equal(await scalar("select score_status as result from public.assignment_submissions where id=$1", [submission]), "pending");

    await asUser(student1);
    myView = (await db.query("select * from public.my_assignment_submission($1)", [assignment])).rows[0];
    assert.equal(myView.score_status, "pending");
    assert.equal(myView.review_note, "Please add more detail on limits.");

    // Tutor re-grades, academic_admin approves this time -- now visible.
    await asUser(tutor);
    await db.query("select public.grade_assignment_submission($1,92,'Much improved, well done.','Re-grading after feedback')", [submission]);
    await asUser(academicAdmin);
    await db.query("select public.approve_assignment_grade($1,true,'Confirmed with the tutor.')", [submission]);
    await assert.rejects(db.query("select public.approve_assignment_grade($1,true,'Repeat approval')", [submission]), /not awaiting approval/);

    await asUser(student1);
    myView = (await db.query("select * from public.my_assignment_submission($1)", [assignment])).rows[0];
    assert.equal(myView.score_status, "approved");
    assert.equal(myView.score, "92.00");
    assert.equal(myView.grading_note, "Much improved, well done.");

    // Once approved, the submission can no longer be replaced.
    const thirdPath = student1 + "/" + assignment + "/essay-v3.pdf";
    await db.exec("reset role");
    await db.query("insert into storage.objects(bucket_id,name) values('assignment-submissions',$1)", [thirdPath]);
    await asUser(student1);
    await assert.rejects(
      db.query("select public.submit_assignment($1,$2,'essay-v3.pdf','application/pdf',500)", [assignment, thirdPath]),
      /already been graded/,
    );

    // RLS: even the owning student cannot read the raw table directly (no
    // policy grants it) -- my_assignment_submission() is the only read path,
    // which is what actually hides the grade until approval.
    await asUser(student1);
    assert.equal(await scalar("select count(*)::int as result from public.assignment_submissions where id=$1", [submission]), 0);

    // RLS: an unrelated student never sees the assignment at all.
    await asUser(student2);
    assert.equal(await scalar("select count(*)::int as result from public.assignments where id=$1", [assignment]), 0);
  } finally { await db.close(); }
});
