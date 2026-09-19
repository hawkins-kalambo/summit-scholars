import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("account holders can update their own name and phone, but not another account's", async () => {
  const db = new PGlite();
  const student = "60000000-0000-4000-8000-000000000001";
  const other = "60000000-0000-4000-8000-000000000002";
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
    for (const path of ["../supabase/migrations/202609150001_foundation.sql", "../supabase/migrations/202609190003_student_profile.sql"]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    for (const id of [student, other]) await db.query("insert into auth.users(id) values($1)", [id]);
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };

    await asUser(student);
    await db.query("update public.profiles set full_name='Updated Student',phone=$1 where id=$2", ["+265991234567", student]);
    assert.deepEqual((await db.query("select full_name,phone from public.profiles where id=$1", [student])).rows[0], { full_name: "Updated Student", phone: "+265991234567" });

    await db.query("update public.profiles set phone='+265999999999' where id=$1", [other]);
    await db.exec("reset role");
    assert.equal((await db.query("select phone from public.profiles where id=$1", [other])).rows[0].phone, null);
    await asUser(student);
    await assert.rejects(db.query("update public.profiles set phone='123' where id=$1", [student]), /violates check constraint/);
    await assert.rejects(db.query("update public.profiles set account_status='active' where id=$1", [student]), /permission denied/);
  } finally { await db.close(); }
});
