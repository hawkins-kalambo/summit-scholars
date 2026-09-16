import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Execute actual PostgreSQL/RLS, with minimal stand-ins for Supabase-owned schemas.
// This does not replace a final test against the configured Supabase project.
test("foundation migration enforces account, role, audit and storage boundaries", async () => {
  const db = new PGlite();
  const student = "20000000-0000-4000-8000-000000000001";
  const other = "20000000-0000-4000-8000-000000000002";
  const admin = "20000000-0000-4000-8000-000000000003";
  const tutor = "20000000-0000-4000-8000-000000000004";
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create schema storage;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, storage to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
      create function storage.foldername(text) returns text[] language sql immutable as
        $$ select string_to_array($1, '/') $$;
      alter table storage.objects enable row level security;
      grant select, insert, update, delete on storage.objects to authenticated;
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/202609150001_foundation.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(`
      insert into auth.users values
      ('${student}', '{"full_name":"Student","role":"super_admin","account_status":"active"}'),
      ('${other}', '{"full_name":"Other"}'),
      ('${admin}', '{"full_name":"Admin"}'),
      ('${tutor}', '{"full_name":"Tutor"}');
      update public.profiles set account_status = 'active' where id in ('${admin}', '${tutor}');
      insert into public.user_roles(user_id,role) values ('${admin}','super_admin'), ('${tutor}','tutor');
      insert into storage.objects(bucket_id,name) values ('application-documents','${other}/private.pdf');
    `);
    const setUser = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec("set role authenticated");
    };
    await setUser(student);
    assert.deepEqual((await db.query("select account_status from public.profiles")).rows, [{ account_status: "pending" }]);
    assert.deepEqual((await db.query("select role from public.user_roles")).rows, [{ role: "student" }]);
    assert.equal((await db.query("select * from public.audit_events")).rows.length, 0);
    assert.equal((await db.query("select * from public.courses")).rows.length, 6);
    await assert.rejects(db.exec(`update public.profiles set account_status='active' where id='${student}'`), /permission denied/);
    await assert.rejects(db.exec(`insert into public.user_roles(user_id,role) values ('${student}','super_admin')`), /permission denied/);
    await assert.rejects(db.exec("insert into public.audit_events(action,table_name,record_id) values ('FAKE','profiles','x')"), /permission denied/);
    await db.exec(`update public.profiles set full_name='Updated Student' where id='${student}'`);
    await db.exec(`insert into storage.objects(bucket_id,name) values ('application-documents','${student}/my.pdf')`);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
    await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values ('application-documents','${other}/intruder.pdf')`), /row-level security/);
    await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values ('course-materials','${student}/material.pdf')`), /row-level security/);
    await db.exec(`delete from storage.objects where name='${student}/my.pdf'`);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);

    await setUser(tutor);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    assert.equal((await db.query("select * from public.audit_events")).rows.length, 0);
    await setUser(admin);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 2);
    assert.ok((await db.query("select * from public.audit_events where action='UPDATE' and table_name='profiles'")).rows.length >= 3);

    await db.exec("reset role");
    await db.exec(`update public.profiles set account_status='suspended' where id='${admin}'`);
    await setUser(admin);
    assert.equal((await db.query("select * from public.audit_events")).rows.length, 0);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);

    await db.exec("reset role");
    await db.exec("set role anon");
    assert.equal((await db.query("select * from public.courses")).rows.length, 6);
    await assert.rejects(db.exec("select * from public.profiles"), /permission denied/);
  } finally {
    await db.close();
  }
});
