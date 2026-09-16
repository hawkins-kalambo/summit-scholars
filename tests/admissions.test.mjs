import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { detectDocumentType } from "../lib/admissions/files.ts";
import { applicationSchema } from "../lib/admissions/validation.ts";

test("upload checks inspect file signatures and application inputs are bounded", () => {
  assert.equal(detectDocumentType(new Uint8Array([37,80,68,70,45]))?.mime,"application/pdf");
  assert.equal(detectDocumentType(new Uint8Array([255,216,255]))?.mime,"image/jpeg");
  assert.equal(detectDocumentType(new TextEncoder().encode("<script>")),null);
  assert.equal(applicationSchema.safeParse({}).success,false);
});

test("admissions enforce consent, ownership, separate approval, versioning and immutable outcomes", async () => {
  const db = new PGlite();
  const ids = Array.from({length:6},(_,index) => "30000000-0000-4000-8000-00000000000" + (index+1));
  const [student,other,reviewer,approver,superAdmin,finance] = ids;
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
    for (const path of ["../supabase/migrations/202609150001_foundation.sql","../supabase/seed.sql","../supabase/migrations/202609150002_admissions.sql","../supabase/migrations/202609150003_notifications.sql"]) {
      await db.exec(await readFile(new URL(path,import.meta.url),"utf8"));
    }
    for (const id of ids) await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)",[id,JSON.stringify({full_name:"Original Name"})]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])",[[reviewer,approver,superAdmin,finance]]);
    for (const [id,role] of [[reviewer,"admissions_officer"],[approver,"academic_admin"],[superAdmin,"super_admin"],[finance,"finance_officer"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)",[id,role]);
    }
    const asUser = async id => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
      await db.exec("set role authenticated");
    };
    const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].result;
    const revision = async id => Number(await scalar("select revision as result from public.applications where id=$1",[id]));
    const university="10000000-0000-4000-8000-000000000001";
    await asUser(superAdmin);
    await db.query("select public.configure_admissions(true,$1,'SSB',true,'Test settings')",["Test privacy notice used only by automated tests."]);
    await asUser(approver);
    const programme=await scalar("select public.configure_academics('programme',$1::jsonb) as result",[JSON.stringify({reason:"Test configuration",name:"Test Programme",code:"TEST",university_id:university,active:true})]);
    const period=await scalar("select public.configure_academics('period',$1::jsonb) as result",[JSON.stringify({reason:"Test configuration",name:"Test intake",university_id:university,registration_opens:"2000-01-01",registration_closes:"2099-12-31",active:true})]);
    const course=await scalar("select id as result from public.courses where code='SSB-PRECALC'");
    const draftCourse=await scalar("select public.configure_academics('course',$1::jsonb) as result",[JSON.stringify({reason:"Test configuration",name:"New Course",code:"NEW",university_id:university,level:1})]);
    await assert.rejects(db.query("select public.publish_course($1,true,'Test approval')",[draftCourse]),/Super Administrator/);
    await asUser(superAdmin);
    await db.query("select public.publish_course($1,true,'Test approval')",[draftCourse]);
    await asUser(student);
    const save = (id=null,version=0) => scalar("select public.save_application($1,$2,$3,$4,$5,1,'0999123456','online',$6::uuid[]) as result",[id,version,university,programme,period,[course]]);
    const application=await save();
    await assert.rejects(save(),/one_current_application_per_period/);
    await assert.rejects(db.query("update public.applications set status='approved' where id=$1",[application]),/permission denied/);
    await assert.rejects(db.query("select public.submit_application($1,1,true,2)",[application]),/supporting document/);
    const objectPath=student+"/"+application+"/document.pdf";
    await db.query("insert into storage.objects(bucket_id,name) values('application-documents',$1)",[objectPath]);
    await db.query("select public.attach_application_document($1,$2,'document.pdf','application/pdf',10)",[application,objectPath]);
    await assert.rejects(db.query("select public.submit_application($1,1,true,2)",[application]),/changed/);
    await assert.rejects(db.query("select public.submit_application($1,2,true,null)",[application]),/privacy notice/);
    await assert.rejects(db.query("select public.submit_application($1,2,false,2)",[application]),/privacy notice/);
    await db.query("select public.submit_application($1,2,true,2)",[application]);
    await assert.rejects(save(application,3),/cannot be edited/);
    await db.query("delete from storage.objects where name=$1",[objectPath]);
    assert.equal((await db.query("select * from storage.objects")).rows.length,1);
    await assert.rejects(db.query("select * from public.notification_outbox"),/permission denied/);

    await asUser(other);
    assert.equal((await db.query("select * from public.applications")).rows.length,0);
    assert.equal((await db.query("select * from public.application_documents")).rows.length,0);
    assert.equal((await db.query("select * from storage.objects")).rows.length,0);
    await asUser(finance);
    assert.equal((await db.query("select * from public.applications")).rows.length,0);
    await assert.rejects(db.query("select public.review_application($1,3,'begin_review','Review started')",[application]),/Admissions permission/);

    await asUser(reviewer);
    await db.query("select public.review_application($1,3,'begin_review','Review started')",[application]);
    await asUser(approver);
    await assert.rejects(db.query("select public.decide_application($1,4,'approve','Admission approved')",[application]),/recommendation/);
    await asUser(reviewer);
    await db.query("select public.review_application($1,4,'recommend_approval','Documents checked')",[application]);
    await db.exec("reset role");
    await db.query("insert into public.user_roles(user_id,role) values($1,'academic_admin')",[reviewer]);
    await asUser(reviewer);
    await assert.rejects(db.query("select public.decide_application($1,5,'approve','Admission approved')",[application]),/different staff/);
    await asUser(approver);
    await assert.rejects(db.query("select public.decide_application($1,null,'approve','Admission approved')",[application]),/changed/);
    await db.query("select public.decide_application($1,5,'approve','Admission approved')",[application]);
    await assert.rejects(db.query("select public.decide_application($1,6,'approve','Admission approved')",[application]),/recommendation/);
    await asUser(student);
    const profile=(await db.query("select * from public.profiles")).rows[0];
    assert.equal(profile.account_status,"active");
    assert.match(profile.student_number,/^SSB-\d{4}-\d{6,}$/);
    assert.equal((await db.query("select * from public.enrolments")).rows.length,1);
    assert.equal((await db.query("select * from public.enrolments")).rows[0].status,"pending");
    await db.exec("update public.profiles set full_name='Changed Name'");
    assert.equal(await scalar("select full_name as result from public.applications where id=$1",[application]),"Original Name");
    await assert.rejects(db.query("select public.cancel_application($1)",[application]),/cannot be cancelled/);

    // Information requests and cancellation are recoverable without losing history.
    await asUser(other);
    const second=await save();
    const secondPath=other+"/"+second+"/document.pdf";
    await db.query("insert into storage.objects(bucket_id,name) values('application-documents',$1)",[secondPath]);
    await db.query("select public.attach_application_document($1,$2,'document.pdf','application/pdf',10)",[second,secondPath]);
    await db.query("select public.submit_application($1,2,true,2)",[second]);
    await asUser(reviewer);
    await db.query("select public.review_application($1,3,'begin_review','Review started')",[second]);
    await db.query("select public.review_application($1,4,'request_information','Please update your phone number')",[second]);
    await asUser(other);
    await save(second,5);
    await db.query("select public.submit_application($1,6,true,2)",[second]);
    await asUser(reviewer);
    await db.query("select public.review_application($1,7,'begin_review','Review restarted')",[second]);
    await db.query("select public.review_application($1,8,'waitlist','Waiting for a place')",[second]);
    await db.query("select public.review_application($1,9,'begin_review','Review resumed')",[second]);
    await db.query("select public.review_application($1,10,'recommend_rejection','Eligibility not met')",[second]);
    await asUser(approver);
    await db.query("select public.decide_application($1,11,'reject','Application not eligible')",[second]);
    await asUser(other);
    assert.equal(await scalar("select account_status as result from public.profiles"),"pending");
    const third=await save();
    const thirdPath=other+"/"+third+"/document.pdf";
    await db.query("insert into storage.objects(bucket_id,name) values('application-documents',$1)",[thirdPath]);
    const documentId=await scalar("select public.attach_application_document($1,$2,'document.pdf','application/pdf',10) as result",[third,thirdPath]);
    await assert.rejects(db.query("select public.remove_application_document($1)",[documentId]),/uploaded file/);
    await db.query("delete from storage.objects where name=$1",[thirdPath]);
    await db.query("select public.remove_application_document($1)",[documentId]);

    await db.query("select public.cancel_application($1)",[third]);
    assert.equal(await scalar("select status as result from public.applications where id=$1",[third]),"cancelled");
    await db.exec("reset role");
    assert.equal(Number(await scalar("select count(*) as result from public.enrolments")),1);
    assert.ok(Number(await scalar("select count(*) as result from public.notification_outbox"))>=3);
    assert.ok(Number(await scalar("select count(*) as result from public.application_history where application_id=$1",[second]))>=8);
    assert.equal(await revision(application),6);
    await asUser(student);
    await assert.rejects(db.query("select * from public.claim_notifications(2)"),/permission denied/);
    await db.exec("reset role; set role service_role");
    const claimed=(await db.query("select * from public.claim_notifications(2)")).rows;
    const nextClaim=(await db.query("select * from public.claim_notifications(2)")).rows;
    assert.equal(claimed.length,2);
    assert.ok(nextClaim.every(row => !claimed.some(first => first.id===row.id)));
    assert.equal(await scalar("select public.finish_notification($1,$2,'test-provider') as result",[claimed[0].id,'99999999-9999-4999-8999-999999999999']),false);
    assert.equal(await scalar("select public.finish_notification($1,$2,'test-provider') as result",[claimed[0].id,claimed[0].lease_token]),true);
    assert.equal(await scalar("select public.finish_notification($1,$2,'test-provider') as result",[claimed[0].id,claimed[0].lease_token]),false);
    await db.query("select public.finish_notification($1,$2,null)",[claimed[1].id,claimed[1].lease_token]);
    await db.exec("reset role");
    await db.query("update public.notification_outbox set first_attempt_at=now()-interval '24 hours',next_attempt_at=now() where id=$1",[claimed[1].id]);
    await db.exec("set role service_role");
    await db.query("select * from public.claim_notifications(1)");
    await db.exec("reset role");
    assert.equal(await scalar("select status as result from public.notification_outbox where id=$1",[claimed[1].id]),"needs_review");

  } finally { await db.close(); }
});
