begin;
-- Phase 8.1 (foundation): fee configuration, invoice generation from
-- enrolment, and manual payment recording. PayChangu checkout/webhook
-- verification is a later, separate step — payments are recorded manually
-- by finance_officer for now (cash/bank transfer/mobile money).
create type public.payment_status as enum
 ('invoice_created','pending','processing','partially_paid','paid','failed','cancelled','refunded','overdue');

alter table public.courses add column fee_amount numeric(12,2) check(fee_amount is null or fee_amount >= 0);

create sequence public.invoice_reference_sequence;
create sequence public.receipt_reference_sequence;
revoke all on sequence public.invoice_reference_sequence,public.receipt_reference_sequence from public,anon,authenticated;

create table public.invoices (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id),
 period_id uuid not null references public.academic_periods(id),
 reference text not null unique,
 total_amount numeric(12,2) not null check(total_amount >= 0),
 balance_amount numeric(12,2) not null check(balance_amount >= 0),
 currency text not null default 'MWK',
 status public.payment_status not null default 'invoice_created',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(student_id,period_id)
);
create table public.invoice_line_items (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 course_id uuid not null references public.courses(id),
 description text not null,
 amount numeric(12,2) not null check(amount >= 0)
);
create table public.payments (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id),
 amount numeric(12,2) not null check(amount > 0),
 method text not null check(method in ('cash','bank_transfer','mobile_money','paychangu')),
 reference text not null unique,
 recorded_by uuid references public.profiles(id),
 notes text,
 created_at timestamptz not null default now()
);
create index invoices_student_id on public.invoices(student_id);
create index payments_invoice_id on public.payments(invoice_id);

alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.payments enable row level security;
revoke all on public.invoices,public.invoice_line_items,public.payments from anon,authenticated;
grant select on public.invoices,public.invoice_line_items,public.payments to authenticated;
create policy invoices_read on public.invoices for select to authenticated using(
 student_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')
);
create policy invoice_line_items_read on public.invoice_line_items for select to authenticated using(
 exists(select 1 from public.invoices i where i.id=invoice_line_items.invoice_id
  and (i.student_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')))
);
create policy payments_read on public.payments for select to authenticated using(
 exists(select 1 from public.invoices i where i.id=payments.invoice_id
  and (i.student_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')))
);

create trigger invoices_audit after insert or update or delete on public.invoices for each row execute function private.audit_change();
create trigger invoice_line_items_audit after insert or update or delete on public.invoice_line_items for each row execute function private.audit_change();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function private.audit_change();

create function public.record_payment(p_invoice_id uuid,p_amount numeric,p_method text,p_note text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare invoice_row public.invoices; result_id uuid; new_balance numeric; new_status public.payment_status; serial_text text;
begin
 if not private.has_role('finance_officer') then raise exception 'Finance permission required'; end if;
 if p_amount is null or p_amount <= 0 then raise exception 'Enter a payment amount greater than zero'; end if;
 if p_method not in ('cash','bank_transfer','mobile_money') then raise exception 'Choose a valid payment method'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this payment record'; end if;
 select * into invoice_row from public.invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if invoice_row.status in ('paid','cancelled','refunded') then raise exception 'This invoice cannot accept further payments'; end if;
 if p_amount > invoice_row.balance_amount then raise exception 'Payment exceeds the outstanding balance'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 new_balance := invoice_row.balance_amount - p_amount;
 new_status := case when new_balance = 0 then 'paid'::public.payment_status else 'partially_paid'::public.payment_status end;
 serial_text := nextval('public.receipt_reference_sequence')::text;
 insert into public.payments(invoice_id,amount,method,reference,recorded_by,notes)
 values(p_invoice_id,p_amount,p_method,'RCT-'||extract(year from now())::text||'-'||lpad(serial_text,6,'0'),auth.uid(),nullif(btrim(coalesce(p_note,'')),''))
 returning id into result_id;
 update public.invoices set balance_amount=new_balance,status=new_status,updated_at=now() where id=p_invoice_id;
 return result_id;
end; $$;
revoke all on function public.record_payment(uuid,numeric,text,text,text) from public,anon;
grant execute on function public.record_payment(uuid,numeric,text,text,text) to authenticated;

-- profiles is restricted to system_admin/self, so finance staff need a
-- controlled lookup (matching the admin_directory / tutor_course_roster
-- pattern) rather than a direct join against profiles.
create function public.finance_invoices(p_status text default null,p_page integer default 1)
returns table(id uuid,reference text,student_name text,total_amount numeric,balance_amount numeric,status public.payment_status,created_at timestamptz,total_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('finance_officer') and not private.has_role('finance_administrator') then raise exception 'Finance permission required'; end if;
 return query select i.id,i.reference,p.full_name,i.total_amount,i.balance_amount,i.status,i.created_at,count(*) over()
 from public.invoices i join public.profiles p on p.id=i.student_id
 where p_status is null or i.status::text=p_status
 order by i.created_at desc,i.id limit 25 offset (greatest(1,least(coalesce(p_page,1),100000))-1)*25;
end; $$;
revoke all on function public.finance_invoices(text,integer) from public,anon;
grant execute on function public.finance_invoices(text,integer) to authenticated;

-- Generate an invoice bundling the fees of every newly approved course, using
-- the numbering scheme deferred from Phase 5 (now has a real consumer).
create or replace function public.decide_application(p_id uuid,p_revision integer,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.applications; prefix text; serial_text text; student_status public.account_status;
declare invoice_total numeric; new_invoice_id uuid; invoice_serial text;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic approval permission required'; end if;
 if p_decision not in ('approve','reject') or char_length(btrim(p_note)) not between 5 and 2000
 then raise exception 'Provide a decision and an applicant-visible reason'; end if;
 perform set_config('app.audit_reason',btrim(p_note),true);
 select * into a from public.applications where id=p_id for update;
 if not found or a.status<>'under_review' or a.recommendation is distinct from p_decision or a.reviewed_by is null
 then raise exception 'An admissions recommendation matching this decision is required'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before deciding'; end if;
 if a.reviewed_by=auth.uid() or a.applicant_id=auth.uid() then raise exception 'A different staff member must approve the decision'; end if;
 select account_status into student_status from public.profiles where id=a.applicant_id for update;
 if student_status='suspended' then raise exception 'A suspended account cannot receive an admission decision'; end if;
 if p_decision='approve' then
  if not exists(select 1 from public.universities where id=a.university_id and active)
  or not exists(select 1 from public.programmes where id=a.programme_id and active)
  or not exists(select 1 from public.academic_periods where id=a.period_id and active)
  or not exists(select 1 from public.application_courses where application_id=p_id)
  or exists(select 1 from public.application_courses ac join public.courses c on c.id=ac.course_id
    where ac.application_id=p_id and not c.published)
  then raise exception 'Academic options changed. Review the application before approval'; end if;
  if exists(
   select 1 from public.application_courses ac join public.courses c on c.id=ac.course_id
   where ac.application_id=p_id and c.capacity is not null
   and c.capacity <= (select count(*) from public.enrolments e where e.course_id=c.id and e.period_id=a.period_id and e.status<>'withdrawn')
  ) then raise exception 'A selected course has reached capacity for this intake. Waitlist the applicant or choose different courses.'; end if;
  select student_number_prefix into prefix from public.organisation_settings where id=true;
  if exists(select 1 from public.profiles where id=a.applicant_id and student_number is null) then serial_text:=nextval('public.student_number_sequence')::text; end if;
  update public.profiles set account_status='active',student_number=coalesce(student_number,
   prefix || '-' || extract(year from now())::text || '-' || lpad(serial_text,greatest(6,char_length(serial_text)),'0'))
   where id=a.applicant_id;
  insert into public.enrolments(student_id,course_id,period_id,application_id)
  select a.applicant_id,course_id,a.period_id,p_id from public.application_courses where application_id=p_id
  on conflict(student_id,course_id,period_id) do nothing;
  select coalesce(sum(coalesce(c.fee_amount,0)),0) into invoice_total
  from public.application_courses ac join public.courses c on c.id=ac.course_id where ac.application_id=p_id;
  if invoice_total > 0 then
   invoice_serial := nextval('public.invoice_reference_sequence')::text;
   insert into public.invoices(student_id,period_id,reference,total_amount,balance_amount)
   values(a.applicant_id,a.period_id,'INV-'||extract(year from now())::text||'-'||lpad(invoice_serial,6,'0'),invoice_total,invoice_total)
   on conflict(student_id,period_id) do nothing
   returning id into new_invoice_id;
   if new_invoice_id is not null then
    insert into public.invoice_line_items(invoice_id,course_id,description,amount)
    select new_invoice_id,ac.course_id,c.name,coalesce(c.fee_amount,0)
    from public.application_courses ac join public.courses c on c.id=ac.course_id where ac.application_id=p_id;
   end if;
  end if;
 end if;
 update public.applications set status=case p_decision when 'approve' then 'approved'::public.application_status else 'rejected'::public.application_status end,
 revision=revision+1,decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=p_id;
 insert into public.application_history(application_id,actor_id,event,note) values(p_id,auth.uid(),p_decision,btrim(p_note));
end; $$;

create or replace function public.configure_academics(p_kind text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; entity_id uuid:=nullif(p_data->>'id','')::uuid;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic configuration permission required'; end if;
 if char_length(btrim(p_data->>'name')) not between 2 and 200 then raise exception 'Provide a valid name'; end if;
 if coalesce(char_length(btrim(p_data->>'reason')),0) not between 5 and 2000 then raise exception 'Provide a reason for this configuration change'; end if;
 perform set_config('app.audit_reason',btrim(p_data->>'reason'),true);
 if p_kind<>'period' and coalesce(char_length(upper(btrim(p_data->>'code'))),0) not between 2 and 40 then raise exception 'Provide an internal code of 2 to 40 characters'; end if;
 if p_kind='university' then
  if entity_id is null then
   insert into public.universities(name,code,active) values(btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.universities set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='programme' then
  if entity_id is null then
   insert into public.programmes(university_id,name,code,active,department_id,duration_years)
   values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true),
    nullif(p_data->>'department_id','')::uuid,coalesce(nullif(p_data->>'duration_years','')::integer,3)) returning id into result_id;
  else update public.programmes set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true),
   department_id=nullif(p_data->>'department_id','')::uuid,duration_years=coalesce(nullif(p_data->>'duration_years','')::integer,3) where id=entity_id returning id into result_id; end if;
 elsif p_kind='period' then
  if entity_id is null then
   insert into public.academic_periods(university_id,name,registration_opens,registration_closes,active)
   values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),(p_data->>'registration_opens')::date,(p_data->>'registration_closes')::date,coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.academic_periods set name=btrim(p_data->>'name'),registration_opens=(p_data->>'registration_opens')::date,
   registration_closes=(p_data->>'registration_closes')::date,active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='course' then
  if entity_id is null then
   insert into public.courses(university_id,name,code,description,level,capacity,fee_amount) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce(p_data->>'description',''),(p_data->>'level')::integer,nullif(p_data->>'capacity','')::integer,nullif(p_data->>'fee_amount','')::numeric) returning id into result_id;
  else update public.courses set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),description=coalesce(p_data->>'description',''),
   level=(p_data->>'level')::integer,capacity=nullif(p_data->>'capacity','')::integer,fee_amount=nullif(p_data->>'fee_amount','')::numeric,published=false where id=entity_id returning id into result_id; end if;
 else raise exception 'Unknown academic record type'; end if;
 if result_id is null then raise exception 'Academic record not found'; end if;
 return result_id;
end; $$;
commit;
