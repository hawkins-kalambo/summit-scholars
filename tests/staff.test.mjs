import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("staff access requires independent approval and prevents direct escalation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text default 'test@example.test',email_confirmed_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
    `);
    for (const path of ["../supabase/migrations/202609150001_foundation.sql","../supabase/seed.sql","../supabase/migrations/202609150002_admissions.sql","../supabase/migrations/202609150003_notifications.sql","../supabase/migrations/202609160001_staff_access.sql"]) {
      await db.exec(await readFile(new URL(path,import.meta.url),"utf8"));
    }

    const ids = [1,2,3,4].map(n => `40000000-0000-4000-8000-00000000000${n}`);
    for (const [i,id] of ids.entries()) await db.query("insert into auth.users(id,email) values($1,$2)",[id,`staff${i}@example.test`]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])",[ids.slice(0,2)]);
    for (const [id,role] of [[ids[0],"system_admin"],[ids[1],"super_admin"]]) await db.query("insert into public.user_roles(user_id,role) values($1,$2)",[id,role]);
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec("set role authenticated"); };
    const request = async (operation="grant") => (await db.query("select public.request_staff_access('staff2@example.test','tutor',$1,'Approved staffing need') as id",[operation])).rows[0].id;
    await asUser(ids[2]);
    await assert.rejects(request(),/Administrator/);
    await assert.rejects(db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')",[ids[2]]),/permission denied/);
    await asUser(ids[0]);
    const id=await request();
    await assert.rejects(request(),/one_pending_staff_role/);
    await assert.rejects(db.query("select public.request_staff_access('staff0@example.test','tutor','grant','Own access request')"),/own access/);
    await assert.rejects(db.query("select public.decide_staff_access($1,true,'Approved staffing need')",[id]),/Super Administrator/);
    await db.exec("reset role");
    await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')",[ids[0]]);
    await asUser(ids[0]);
    await assert.rejects(db.query("select public.decide_staff_access($1,true,'Approved staffing need')",[id]),/separate/);
    await asUser(ids[1]);
    await db.query("select public.decide_staff_access($1,true,'Independent approval')",[id]);
    await assert.rejects(db.query("select public.decide_staff_access($1,true,'Repeat approval')",[id]),/no longer pending/);
    await asUser(ids[2]);
    assert.equal((await db.query("select account_status from public.profiles")).rows[0].account_status,"active");
    assert.ok((await db.query("select role from public.user_roles")).rows.some(r=>r.role==="tutor"));
    assert.equal((await db.query("select * from public.staff_access_requests")).rows.length,0);
    await asUser(ids[0]);
    const revoke=await request("revoke");
    await asUser(ids[1]);
    await db.query("select public.decide_staff_access($1,true,'Access no longer needed')",[revoke]);
    await asUser(ids[2]);
    assert.ok(!(await db.query("select role from public.user_roles")).rows.some(r=>r.role==="tutor"));
    await asUser(ids[0]);
    const reject=await request();
    await asUser(ids[1]);
    await db.query("select public.decide_staff_access($1,false,'Request declined')",[reject]);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as count from public.audit_events where table_name='staff_access_requests'")).rows[0].count,6);
  } finally { await db.close(); }
});
