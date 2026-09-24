import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("public tutor applications require a separate academic administrator to decide, and approval grants the tutor role", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6, 7].map(n => `c0000000-0000-4000-8000-00000000000${n}`);
  const [applicant, otherApplicant, academicAdmin1, academicAdmin2, systemAdmin, suspendedApplicant, lateSuspendedApplicant] = ids;
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
      "../supabase/migrations/202609150001_foundation.sql", "../supabase/migrations/202609150002_admissions.sql",
      "../supabase/migrations/202609200004_tutor_recruitment.sql", "../supabase/migrations/202609240002_tutor_recruitment_provisioning.sql",
    ]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [[academicAdmin1, academicAdmin2, systemAdmin]]);
    await db.query("update public.profiles set account_status='suspended' where id=$1", [suspendedApplicant]);
    for (const [id, role] of [[academicAdmin1, "academic_admin"], [academicAdmin2, "academic_admin"], [systemAdmin, "system_admin"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    await asUser(suspendedApplicant);
    await assert.rejects(
      db.query("select public.submit_tutor_application('Suspended Applicant','+265991110000','Mathematics','Some qualification text here','Anytime')"),
      /eligible account is required/,
    );

    await asUser(applicant);
    const application = await scalar(
      "select public.submit_tutor_application('Jane Tutor','+265991234567','Mathematics, Physics','BSc Mathematics, five years private tutoring experience','Weekday evenings and weekends') as result",
    );
    assert.ok(application);
    await assert.rejects(
      db.query("select public.submit_tutor_application('Jane Tutor','+265991234567','Chemistry','Some other qualification text here','Anytime')"),
      /already have an application/,
    );

    const objectPath = applicant + "/" + application + "/certificate.pdf";
    await db.query("insert into storage.objects(bucket_id,name) values('tutor-application-documents',$1)", [objectPath]);
    await db.query("select public.attach_tutor_application_document($1,$2,'certificate.pdf','application/pdf',1000)", [application, objectPath]);
    assert.equal(await scalar("select count(*)::int as result from public.tutor_application_documents where application_id=$1", [application]), 1);

    await asUser(academicAdmin1);
    await db.query("select public.review_tutor_application($1,2,'Reviewing credentials')", [application]);
    await assert.rejects(db.query("select public.decide_tutor_application($1,3,'approve','Approved')", [application]), /different academic administrator/);

    await asUser(academicAdmin2);
    await db.query("select public.decide_tutor_application($1,3,'approve','Qualifications verified')", [application]);
    await db.exec("reset role");
    assert.equal(await scalar("select status as result from public.tutor_applications where id=$1", [application]), "approved");
    // Approval only records the recommendation; the account is untouched
    // until a System Administrator provisions it separately.
    assert.equal(await scalar("select account_status as result from public.profiles where id=$1", [applicant]), "pending");
    assert.equal(await scalar("select count(*)::int as result from public.user_roles where user_id=$1 and role='tutor'", [applicant]), 0);

    await asUser(academicAdmin1);
    await assert.rejects(db.query("select public.provision_tutor_account($1,'Trying without permission')", [application]), /System Administrator permission required/);

    await asUser(systemAdmin);
    await db.query("select public.provision_tutor_account($1,'Approved application; provisioning account')", [application]);
    await assert.rejects(db.query("select public.provision_tutor_account($1,'Repeat provisioning')", [application]), /already been provisioned/);
    await db.exec("reset role");
    assert.equal(await scalar("select account_status as result from public.profiles where id=$1", [applicant]), "active");
    assert.equal(await scalar("select count(*)::int as result from public.user_roles where user_id=$1 and role='tutor'", [applicant]), 1);
    assert.equal(await scalar("select count(*)::int as result from public.notification_outbox where event_key=$1", ["tutor-application/" + application + "/provisioned"]), 1);

    // Provisioning is blocked if the applicant's account was suspended after approval.
    await asUser(lateSuspendedApplicant);
    const lateSuspendedApplication = await scalar(
      "select public.submit_tutor_application('Late Suspended','+265991230000','History','Some qualification text here','Anytime') as result",
    );
    await asUser(academicAdmin1);
    await db.query("select public.review_tutor_application($1,1,'Reviewing')", [lateSuspendedApplication]);
    await asUser(academicAdmin2);
    await db.query("select public.decide_tutor_application($1,2,'approve','Approved')", [lateSuspendedApplication]);
    await db.exec("reset role");
    await db.query("update public.profiles set account_status='suspended' where id=$1", [lateSuspendedApplicant]);
    await asUser(systemAdmin);
    await assert.rejects(db.query("select public.provision_tutor_account($1,'Attempting provisioning')", [lateSuspendedApplication]), /suspended and cannot be provisioned/);

    // A rejected applicant can reapply; an approved/pending one cannot.
    await asUser(otherApplicant);
    const rejectedApplication = await scalar(
      "select public.submit_tutor_application('Other Applicant','+265997654321','English','Diploma in education','Mornings') as result",
    );
    await asUser(academicAdmin1);
    await db.query("select public.review_tutor_application($1,1,'Reviewing')", [rejectedApplication]);
    await asUser(academicAdmin2);
    await db.query("select public.decide_tutor_application($1,2,'reject','Insufficient teaching experience')", [rejectedApplication]);
    await asUser(otherApplicant);
    const secondApplication = await scalar(
      "select public.submit_tutor_application('Other Applicant','+265997654321','English','Diploma in education plus one year of tutoring since the last application','Mornings and afternoons') as result",
    );
    assert.ok(secondApplication);
    await assert.rejects(
      db.query("select public.submit_tutor_application('Other Applicant','+265997654321','English','Another one','Anytime')"),
      /already have an application/,
    );

    await asUser(applicant);
    await assert.rejects(
      db.query("select public.submit_tutor_application('Jane Tutor','+265991234567','Chemistry','Some other qualification text here','Anytime')"),
      /already holds the tutor role/,
    );

    await db.exec("reset role");
    assert.equal(await scalar("select count(*)::int as result from public.tutor_applications where id=$1", [application]), 1);
    await asUser(otherApplicant);
    assert.equal(await scalar("select count(*)::int as result from public.tutor_applications where id=$1", [application]), 0);
  } finally { await db.close(); }
});
