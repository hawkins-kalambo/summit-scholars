begin;
-- Phase 6.1: link programmes to the Phase 1 department hierarchy, and record
-- expected duration. Phase 6.2: course enrolment capacity, enforced at the
-- admission decision so approvals can never oversubscribe a course.
alter table public.programmes add column department_id uuid references public.departments(id);
alter table public.programmes add column duration_years integer not null default 3 check(duration_years between 1 and 10);
alter table public.courses add column capacity integer check(capacity is null or capacity > 0);

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
   insert into public.courses(university_id,name,code,description,level,capacity) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce(p_data->>'description',''),(p_data->>'level')::integer,nullif(p_data->>'capacity','')::integer) returning id into result_id;
  else update public.courses set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),description=coalesce(p_data->>'description',''),
   level=(p_data->>'level')::integer,capacity=nullif(p_data->>'capacity','')::integer,published=false where id=entity_id returning id into result_id; end if;
 else raise exception 'Unknown academic record type'; end if;
 if result_id is null then raise exception 'Academic record not found'; end if;
 return result_id;
end; $$;

create or replace function public.decide_application(p_id uuid,p_revision integer,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.applications; prefix text; serial_text text; student_status public.account_status;
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
 end if;
 update public.applications set status=case p_decision when 'approve' then 'approved'::public.application_status else 'rejected'::public.application_status end,
 revision=revision+1,decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=p_id;
 insert into public.application_history(application_id,actor_id,event,note) values(p_id,auth.uid(),p_decision,btrim(p_note));
end; $$;
commit;
