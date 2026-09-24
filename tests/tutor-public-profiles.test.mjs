import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("tutors control their own public profile, and visibility governs anonymous read access", async () => {
  const db = new PGlite();
  const ids = [1, 2].map(n => `e0000000-0000-4000-8000-00000000000${n}`);
  const [tutor, student] = ids;
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
      "../supabase/migrations/202609150001_foundation.sql", "../supabase/migrations/202609200006_tutor_public_profiles.sql",
      "../supabase/migrations/202609240007_tutor_profile_visibility_and_modes.sql",
    ]) {
      await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [ids]);
    await db.query("insert into public.user_roles(user_id,role) values($1,'tutor')", [tutor]);
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const asAnon = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.exec("set role anon"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    await asUser(student);
    await assert.rejects(
      db.query("select public.save_tutor_profile('Student','Headline','A bio that is long enough to pass validation','Maths',true)"),
      /Tutor access required/,
    );

    await asUser(tutor);
    await assert.rejects(
      db.query("select public.save_tutor_profile('Jane Tutor','Headline','short','Maths',true)"),
      /Write a longer bio/,
    );
    await db.query("select public.save_tutor_profile('Jane Tutor','Mathematics specialist','Five years of private tutoring experience in secondary and university mathematics.','Mathematics, Physics',true)");
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 1);

    await asAnon();
    assert.equal(await scalar("select display_name as result from public.tutor_profiles where tutor_id=$1", [tutor]), "Jane Tutor");

    await asUser(tutor);
    await db.query("select public.save_tutor_profile('Jane Tutor','Mathematics specialist','Five years of private tutoring experience in secondary and university mathematics.','Mathematics, Physics',false)");
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 1);

    await asAnon();
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 0);

    await asUser(tutor);
    assert.equal(await scalar("select visible as result from public.tutor_profiles where tutor_id=$1", [tutor]), false);

    await assert.rejects(
      db.query("select public.save_tutor_profile('Jane Tutor','Mathematics specialist','Five years of private tutoring experience in secondary and university mathematics.','Mathematics, Physics',true,false,false)"),
      /Choose at least one teaching mode/,
    );
    await db.query("select public.save_tutor_profile('Jane Tutor','Mathematics specialist','Five years of private tutoring experience in secondary and university mathematics.','Mathematics, Physics',true,true,true)");
    assert.deepEqual(
      (await db.query("select teaches_online,teaches_in_person from public.tutor_profiles where tutor_id=$1", [tutor])).rows[0],
      { teaches_online: true, teaches_in_person: true },
    );

    // A visible profile still hides itself once the tutor loses the role or is suspended.
    await asAnon();
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 1);
    await db.exec("reset role");
    await db.query("update public.profiles set account_status='suspended' where id=$1", [tutor]);
    await asAnon();
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 0);

    await db.exec("reset role");
    await db.query("update public.profiles set account_status='active' where id=$1", [tutor]);
    await db.query("delete from public.user_roles where user_id=$1 and role='tutor'", [tutor]);
    await asAnon();
    assert.equal(await scalar("select count(*)::int as result from public.tutor_profiles where tutor_id=$1", [tutor]), 0);
  } finally { await db.close(); }
});
