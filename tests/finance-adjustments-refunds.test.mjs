import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("payment adjustments and refunds require a separate decider from the requester", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `b0000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, admissionsOfficer, superAdmin, financeOfficer, financeAdministrator, student1, dualAdjuster, dualRefunder] = ids;
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
      "../supabase/migrations/202609190001_academic_structure.sql",
      "../supabase/migrations/202609190002_finance_administrator_role.sql",
      "../supabase/migrations/202609190005_programme_department_course_capacity.sql",
      "../supabase/migrations/202609200002_finance_invoices.sql",
      "../supabase/migrations/202609200003_finance_adjustments_refunds.sql",
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [[academicAdmin, admissionsOfficer, superAdmin, financeOfficer, financeAdministrator, dualAdjuster, dualRefunder]]);
    for (const [id, roles] of [
      [academicAdmin, ["academic_admin"]], [admissionsOfficer, ["admissions_officer"]], [superAdmin, ["super_admin"]],
      [financeOfficer, ["finance_officer"]], [financeAdministrator, ["finance_administrator"]],
      [dualAdjuster, ["finance_officer", "finance_administrator"]], [dualRefunder, ["finance_officer", "super_admin"]],
    ]) {
      for (const role of roles) await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    await asUser(superAdmin);
    await db.query("select public.configure_admissions(true,$1,'SSB',false,'Test settings')", ["Test privacy notice used only by automated tests."]);
    await asUser(academicAdmin);
    const programme = await scalar("select public.configure_academics('programme',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Test Programme", code: "TESTPROG", university_id: university })]);
    const period = await scalar("select public.configure_academics('period',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Test intake", university_id: university, registration_opens: "2000-01-01", registration_closes: "2099-12-31", active: true })]);
    const course = await scalar("select public.configure_academics('course',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Paid Course", code: "PAID2", university_id: university, level: 1, fee_amount: 50000 })]);
    await asUser(superAdmin);
    await db.query("select public.publish_course($1,true,'Test approval')", [course]);

    await asUser(student1);
    const application = await scalar("select public.save_application(null,0,$1,$2,$3,1,'0999123456','online',$4::uuid[]) as result", [university, programme, period, [course]]);
    await db.query("select public.submit_application($1,1,true,2)", [application]);
    await asUser(admissionsOfficer);
    await db.query("select public.review_application($1,2,'begin_review','Review started')", [application]);
    await db.query("select public.review_application($1,3,'recommend_approval','Documents checked')", [application]);
    await asUser(academicAdmin);
    await db.query("select public.decide_application($1,4,'approve','Admission approved')", [application]);
    await db.exec("reset role");
    const invoice = await scalar("select id as result from public.invoices where student_id=$1", [student1]);
    assert.ok(invoice);

    // Adjustment: finance_officer prepares, a different finance_administrator approves.
    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.request_payment_adjustment($1,0,'No-op adjustment')", [invoice]), /non-zero adjustment/);
    const adjustment = await scalar("select public.request_payment_adjustment($1,-10000,'Sibling discount applied late') as result", [invoice]);
    assert.ok(adjustment);
    await assert.rejects(db.query("select public.decide_payment_adjustment($1,true,'Self-approving')", [adjustment]), /Finance Administrator permission required/);

    await asUser(dualAdjuster);
    const selfAdjustment = await scalar("select public.request_payment_adjustment($1,-1000,'Self test') as result", [invoice]);
    await assert.rejects(db.query("select public.decide_payment_adjustment($1,true,'Approving my own request')", [selfAdjustment]), /different Finance Administrator/);

    await asUser(financeAdministrator);
    await assert.rejects(db.query("select public.decide_payment_adjustment($1,null,'Missing decision')", [adjustment]), /Provide a decision/);
    await db.query("select public.decide_payment_adjustment($1,true,'Discount confirmed with admissions')", [adjustment]);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select total_amount,balance_amount,status from public.invoices where id=$1", [invoice])).rows[0],
      { total_amount: "40000.00", balance_amount: "40000.00", status: "invoice_created" },
    );
    await asUser(financeAdministrator);
    await assert.rejects(db.query("select public.decide_payment_adjustment($1,true,'Repeat approval')", [adjustment]), /no longer pending/);

    // Pay the (adjusted) invoice in full so we can test a refund against it.
    await asUser(financeOfficer);
    await db.query("select public.record_payment($1,40000,'cash','Paid in full','Recording payment')", [invoice]);
    await db.exec("reset role");
    assert.equal(await scalar("select status as result from public.invoices where id=$1", [invoice]), "paid");

    // Refund: finance_officer prepares, a different super_admin approves.
    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.request_refund($1,90000,'Excessive refund')", [invoice]), /cannot exceed the invoice total/);
    const refund = await scalar("select public.request_refund($1,15000,'Student withdrew from one component') as result", [invoice]);
    assert.ok(refund);
    await assert.rejects(db.query("select public.decide_refund($1,true,'Self-approving')", [refund]), /Super Administrator permission required/);

    await asUser(dualRefunder);
    const selfRefund = await scalar("select public.request_refund($1,500,'Self test') as result", [invoice]);
    await assert.rejects(db.query("select public.decide_refund($1,true,'Approving my own request')", [selfRefund]), /different Super Administrator/);

    await asUser(superAdmin);
    await db.query("select public.decide_refund($1,true,'Withdrawal confirmed')", [refund]);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select refunded_amount,balance_amount,status from public.invoices where id=$1", [invoice])).rows[0],
      { refunded_amount: "15000.00", balance_amount: "0.00", status: "refunded" },
    );

    await asUser(student1);
    assert.equal(await scalar("select count(*)::int as result from public.invoices where id=$1", [invoice]), 1);
    assert.equal(await scalar("select count(*)::int as result from public.payment_adjustment_requests"), 0);
  } finally { await db.close(); }
});
