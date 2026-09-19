import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("campuses, faculties and departments are system_admin-managed and readable by any authenticated account", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3].map(n => `50000000-0000-4000-8000-00000000000${n}`);
  const [systemAdmin, academicAdmin, student] = ids;
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
    for (const path of ["../supabase/migrations/202609150001_foundation.sql", "../supabase/seed.sql", "../supabase/migrations/202609190001_academic_structure.sql"]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    for (const [id, role] of [[systemAdmin, "system_admin"], [academicAdmin, "academic_admin"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
    const university = "10000000-0000-4000-8000-000000000001";

    await asUser(academicAdmin);
    await assert.rejects(
      db.query("select public.configure_academic_structure('faculty',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Faculty of Science", code: "SCI", university_id: university })]),
      /System Administrator/,
    );

    await asUser(systemAdmin);
    const faculty = await scalar("select public.configure_academic_structure('faculty',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Faculty of Science", code: "SCI", university_id: university })]);
    const department = await scalar("select public.configure_academic_structure('department',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Department of Computer Science", code: "CS", faculty_id: faculty })]);
    const campus = await scalar("select public.configure_academic_structure('campus',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "St. Augustine Hall", code: "SAH", university_id: university })]);
    assert.ok(faculty && department && campus);

    await assert.rejects(
      db.query("select public.configure_academic_structure('faculty',$1::jsonb) as result", [JSON.stringify({ reason: "Duplicate code", name: "Faculty of Science Again", code: "SCI", university_id: university })]),
      /duplicate key|unique/i,
    );
    await assert.rejects(
      db.query("select public.configure_academic_structure('campus',$1::jsonb) as result", [JSON.stringify({ reason: "Bad kind", name: "Somewhere", code: "SW" })]),
      /null value|violates not-null/i,
    );
    await assert.rejects(
      db.query("select public.configure_academic_structure('planet',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Mars", code: "MARS" })]),
      /Unknown structure record type/,
    );

    const renamed = await scalar("select public.configure_academic_structure('faculty',$1::jsonb) as result", [JSON.stringify({ id: faculty, reason: "Renamed for clarity", name: "Faculty of Natural Sciences", code: "SCI", university_id: university })]);
    assert.equal(renamed, faculty);
    assert.equal(await scalar("select name as result from public.faculties where id=$1", [faculty]), "Faculty of Natural Sciences");

    await asUser(student);
    assert.equal(await scalar("select count(*)::int as result from public.faculties"), 1);
    assert.equal(await scalar("select count(*)::int as result from public.departments"), 1);
    assert.equal(await scalar("select count(*)::int as result from public.campuses"), 1);
    await assert.rejects(
      db.query("select public.configure_academic_structure('campus',$1::jsonb) as result", [JSON.stringify({ reason: "Not allowed", name: "Somewhere Else", code: "SE", university_id: university })]),
      /System Administrator/,
    );

    await db.exec("reset role");
    assert.equal(await scalar("select count(*)::int as result from public.audit_events where table_name='faculties'"), 2);
  } finally { await db.close(); }
});

test("finance_administrator role can be added to the enum and assigned", async () => {
  const db = new PGlite();
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
    for (const path of ["../supabase/migrations/202609150001_foundation.sql", "../supabase/migrations/202609190002_finance_administrator_role.sql"]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    const id = "50000000-0000-4000-8000-000000000009";
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=$1", [id]);
    await db.query("insert into public.user_roles(user_id,role) values($1,'finance_administrator')", [id]);
    assert.equal((await db.query("select count(*)::int as count from public.user_roles where user_id=$1 and role='finance_administrator'", [id])).rows[0].count, 1);
  } finally { await db.close(); }
});
