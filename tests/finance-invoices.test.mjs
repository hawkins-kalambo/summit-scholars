import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("admission approval generates a fee-bearing invoice, and manual payments are recorded server-side", async () => {
  const db = new PGlite();
  const ids = [1, 2, 3, 4, 5, 6].map(n => `a0000000-0000-4000-8000-00000000000${n}`);
  const [academicAdmin, admissionsOfficer, superAdmin, financeOfficer, student1, student2] = ids;
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
    ]) { await db.exec(await readFile(new URL(path, import.meta.url), "utf8")); }
    for (const id of ids) await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("update public.profiles set account_status='active' where id=any($1::uuid[])", [[academicAdmin, admissionsOfficer, superAdmin, financeOfficer]]);
    for (const [id, role] of [[academicAdmin, "academic_admin"], [admissionsOfficer, "admissions_officer"], [superAdmin, "super_admin"], [financeOfficer, "finance_officer"]]) {
      await db.query("insert into public.user_roles(user_id,role) values($1,$2)", [id, role]);
    }
    const asUser = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

    await asUser(superAdmin);
    await db.query("select public.configure_admissions(true,$1,'SSB',false,'Test settings')", ["Test privacy notice used only by automated tests."]);

    await asUser(academicAdmin);
    const programme = await scalar("select public.configure_academics('programme',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Test Programme", code: "TESTPROG", university_id: university })]);
    const period = await scalar("select public.configure_academics('period',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Test intake", university_id: university, registration_opens: "2000-01-01", registration_closes: "2099-12-31", active: true })]);
    const feeCourse = await scalar("select public.configure_academics('course',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Paid Course", code: "PAID1", university_id: university, level: 1, fee_amount: 50000 })]);
    const freeCourse = await scalar("select public.configure_academics('course',$1::jsonb) as result", [JSON.stringify({ reason: "Test configuration", name: "Free Course", code: "FREE1", university_id: university, level: 1 })]);
    assert.equal(await scalar("select fee_amount as result from public.courses where id=$1", [feeCourse]), "50000.00");
    assert.equal(await scalar("select fee_amount as result from public.courses where id=$1", [freeCourse]), null);
    await asUser(superAdmin);
    await db.query("select public.publish_course($1,true,'Test approval')", [feeCourse]);
    await db.query("select public.publish_course($1,true,'Test approval')", [freeCourse]);

    async function applyAndApprove(student, courseIds) {
      await asUser(student);
      const application = await scalar("select public.save_application(null,0,$1,$2,$3,1,'0999123456','online',$4::uuid[]) as result", [university, programme, period, courseIds]);
      await db.query("select public.submit_application($1,1,true,2)", [application]);
      await asUser(admissionsOfficer);
      await db.query("select public.review_application($1,2,'begin_review','Review started')", [application]);
      await db.query("select public.review_application($1,3,'recommend_approval','Documents checked')", [application]);
      await asUser(academicAdmin);
      await db.query("select public.decide_application($1,4,'approve','Admission approved')", [application]);
    }

    await applyAndApprove(student1, [feeCourse]);
    await db.exec("reset role");
    const invoice = await scalar("select id as result from public.invoices where student_id=$1", [student1]);
    assert.ok(invoice);
    const invoiceRow = (await db.query("select reference,total_amount,balance_amount,status from public.invoices where id=$1", [invoice])).rows[0];
    assert.match(invoiceRow.reference, /^INV-\d{4}-\d{6}$/);
    assert.equal(invoiceRow.total_amount, "50000.00");
    assert.equal(invoiceRow.balance_amount, "50000.00");
    assert.equal(invoiceRow.status, "invoice_created");
    assert.equal(await scalar("select count(*)::int as result from public.invoice_line_items where invoice_id=$1", [invoice]), 1);

    await applyAndApprove(student2, [freeCourse]);
    await db.exec("reset role");
    assert.equal(await scalar("select count(*)::int as result from public.invoices where student_id=$1", [student2]), 0);

    await asUser(academicAdmin);
    await assert.rejects(db.query("select public.record_payment($1,20000,'cash','Partial payment','Recording payment')", [invoice]), /Finance permission required/);

    await asUser(financeOfficer);
    await assert.rejects(db.query("select public.record_payment($1,60000,'cash','Overpayment','Recording payment')", [invoice]), /exceeds the outstanding balance/);
    const firstPayment = await scalar("select public.record_payment($1,20000,'cash','Partial payment','Recording payment') as result", [invoice]);
    assert.ok(firstPayment);
    assert.match(await scalar("select reference as result from public.payments where id=$1", [firstPayment]), /^RCT-\d{4}-\d{6}$/);
    assert.deepEqual(
      (await db.query("select balance_amount,status from public.invoices where id=$1", [invoice])).rows[0],
      { balance_amount: "30000.00", status: "partially_paid" },
    );
    await db.query("select public.record_payment($1,30000,'bank_transfer','Final payment','Recording payment')", [invoice]);
    assert.deepEqual(
      (await db.query("select balance_amount,status from public.invoices where id=$1", [invoice])).rows[0],
      { balance_amount: "0.00", status: "paid" },
    );
    await assert.rejects(db.query("select public.record_payment($1,10,'cash','Late fee','Recording payment')", [invoice]), /cannot accept further payments/);

    await asUser(student1);
    assert.equal(await scalar("select count(*)::int as result from public.invoices where id=$1", [invoice]), 1);
    assert.equal(await scalar("select count(*)::int as result from public.payments where invoice_id=$1", [invoice]), 2);
    await asUser(student2);
    assert.equal(await scalar("select count(*)::int as result from public.invoices where id=$1", [invoice]), 0);
  } finally { await db.close(); }
});
