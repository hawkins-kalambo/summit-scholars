import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("course announcements, site-wide announcements and tutor<->student messages stay scoped to a shared course", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5].map(n => `e0000000-0000-4000-8000-00000000000${n}`);
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
      "../supabase/migrations/202610130001_communication.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id,email) values($1,$2)", [id, id + "@example.test"]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [tutor, "tutor"], [otherTutor, "tutor"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    const precalc = await scalar("select id as result from public.courses where code='SSB-PRECALC'");
    await asUser(academicAdmin);
    await db.query("select public.assign_course_tutor($1,$2,true,'Assign tutor')", [precalc, tutor]);

    // student1 is enrolled in the course; student2 is not (unrelated).
    const programme = "e0000000-0000-4000-8000-000000000010";
    const period = "e0000000-0000-4000-8000-000000000011";
    const application = "e0000000-0000-4000-8000-000000000012";
    await db.exec("reset role");
    await db.query("insert into public.programmes(id,university_id,name,code) values($1,$2,'Test Programme','TESTPROG')", [programme, university]);
    await db.query("insert into public.academic_periods(id,university_id,name,registration_opens,registration_closes) values($1,$2,'Test Period','2000-01-01','2099-12-31')", [period, university]);
    await db.query("insert into public.applications(id,applicant_id,full_name,university_id,programme_id,period_id,year_of_study,phone,learning_mode,status) values($1,$2,'Test Student',$3,$4,$5,1,'0999123456','online','approved')", [application, student1, university, programme, period]);
    await db.query("insert into public.enrolments(student_id,course_id,period_id,application_id,status) values($1,$2,$3,$4,'active')", [student1, precalc, period, application]);

    // --- Announcements ---
    // Only the assigned tutor (or academic_admin) can post a course announcement.
    await asUser(otherTutor);
    await assert.rejects(db.query("select public.post_announcement($1,'Room change','Class moves to Room 4 this week.','Notify students')", [precalc]), /not assigned to this course/);

    await asUser(tutor);
    const courseAnnouncement = await scalar("select public.post_announcement($1,'Room change','Class moves to Room 4 this week.','Notify students') as result", [precalc]);
    assert.ok(courseAnnouncement);

    // A site-wide announcement (course_id null) requires academic_admin.
    await assert.rejects(db.query("select public.post_announcement(null,'Platform maintenance','The portal is down Sunday night.','Site notice')"), /Academic administration permission required/);
    await asUser(academicAdmin);
    const broadcast = await scalar("select public.post_announcement(null,'Platform maintenance','The portal is down Sunday night.','Site notice') as result");
    assert.ok(broadcast);

    // The enrolled student sees both; the unrelated student sees only the broadcast.
    await asUser(student1);
    assert.equal(await scalar("select count(*)::int as result from public.announcements"), 2);
    await asUser(student2);
    assert.equal(await scalar("select count(*)::int as result from public.announcements"), 1);
    assert.equal(await scalar("select title as result from public.announcements"), "Platform maintenance");

    // Only the author (or academic_admin) can delete an announcement.
    await asUser(otherTutor);
    await assert.rejects(db.query("select public.delete_announcement($1,'Not mine')", [courseAnnouncement]), /did not post this announcement/);
    await asUser(tutor);
    await db.query("select public.delete_announcement($1,'Room change cancelled')", [courseAnnouncement]);
    await db.exec("reset role");
    assert.equal(await scalar("select count(*)::int as result from public.announcements"), 1);

    // Course announcements email only enrolled students (never the author, never an unrelated student) --
    // deleting the announcement afterwards does not retract an email already queued for it.
    const announcementEmails = (await db.query("select recipient from public.notification_outbox where event_key like 'announcement/%'")).rows;
    assert.equal(announcementEmails.length, 1);
    assert.equal(announcementEmails[0].recipient, student1 + "@example.test");

    // --- Messages ---
    // A student can only start a thread with a tutor actually assigned to a course they're enrolled in.
    await asUser(student1);
    await assert.rejects(db.query("select public.start_message_thread($1,$2)", [precalc, otherTutor]), /not eligible/);
    const thread = await scalar("select public.start_message_thread($1,$2) as result", [precalc, tutor]);
    assert.ok(thread);
    // Starting again for the same pair/course reuses the same thread.
    assert.equal(await scalar("select public.start_message_thread($1,$2) as result", [precalc, tutor]), thread);

    // An unrelated student cannot start a thread for this course at all.
    await asUser(student2);
    await assert.rejects(db.query("select public.start_message_thread($1,$2)", [precalc, tutor]), /not eligible/);

    // Only a thread participant can send into it.
    await assert.rejects(db.query("select public.send_message($1,'Hi')", [thread]), /not part of this conversation/);

    await asUser(student1);
    await db.query("select public.send_message($1,'Can we move my tutoring slot?')", [thread]);
    await asUser(tutor);
    await db.query("select public.send_message($1,'Sure, what time works?')", [thread]);

    // my_message_threads() surfaces the other party's name, last message and unread count.
    let tutorThreads = (await db.query("select * from public.my_message_threads()")).rows;
    assert.equal(tutorThreads.length, 1);
    assert.equal(tutorThreads[0].other_name, "Student");
    assert.equal(tutorThreads[0].last_message, "Sure, what time works?");
    assert.equal(Number(tutorThreads[0].unread_count), 1); // student1's message is still unread by the tutor

    await asUser(student1);
    let studentThreads = (await db.query("select * from public.my_message_threads()")).rows;
    assert.equal(Number(studentThreads[0].unread_count), 1); // the tutor's reply is unread

    await db.query("select public.mark_thread_read($1)", [thread]);
    studentThreads = (await db.query("select * from public.my_message_threads()")).rows;
    assert.equal(Number(studentThreads[0].unread_count), 0);

    // my_course_tutors() lets a student find who they can message.
    const availableTutors = (await db.query("select * from public.my_course_tutors()")).rows;
    assert.equal(availableTutors.length, 1);
    assert.equal(availableTutors[0].tutor_id, tutor);

    // RLS: an unrelated student cannot read the thread or its messages at all.
    await asUser(student2);
    assert.equal(await scalar("select count(*)::int as result from public.message_threads where id=$1", [thread]), 0);
    assert.equal(await scalar("select count(*)::int as result from public.messages where thread_id=$1", [thread]), 0);

    // Each message queues exactly one outbox email, addressed to the other participant.
    await db.exec("reset role");
    const messageEmails = (await db.query("select recipient from public.notification_outbox where event_key like 'message/%' order by recipient")).rows;
    assert.equal(messageEmails.length, 2);
    assert.deepEqual(messageEmails.map(row => row.recipient).sort(), [student1 + "@example.test", tutor + "@example.test"].sort());
  } finally { await db.close(); }
});
