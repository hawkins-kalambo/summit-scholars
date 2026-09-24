begin;
-- Security fix: the course-capacity check in decide_application locked only
-- the application row, not the course/enrolment count, so two concurrent
-- approvals into the same near-full course could both pass. An advisory
-- lock per course (acquired in a stable, sorted order to avoid deadlocks
-- across applications with overlapping course sets) serializes decisions
-- that touch the same course.
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
  perform pg_advisory_xact_lock(hashtext('course_capacity:'||course_id::text))
  from (select distinct course_id from public.application_courses where application_id=p_id order by course_id) t;
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
commit;
