-- Step 2: core academic configuration and governed admissions.
begin;
create type public.application_status as enum
 ('draft','submitted','under_review','information_required','approved','rejected','waitlisted','cancelled');
create type public.learning_mode as enum ('online','face_to_face');
create table public.organisation_settings (
 id boolean primary key default true check(id),
 organisation_name text not null default 'Summit ScholarsBridge',
 support_email text not null default 'summitscholarsbridge@gmail.com',
 registration_open boolean not null default false,
 privacy_notice text not null default '',
 privacy_version integer not null default 1,
 student_number_prefix text not null default 'SSB' check(student_number_prefix ~ '^[A-Z0-9]{2,10}$'),
 documents_required boolean not null default false
);
insert into public.organisation_settings(id) values(true);
create table public.programmes (
 id uuid primary key default gen_random_uuid(),
 university_id uuid not null references public.universities(id),
 name text not null check(char_length(name) between 2 and 200),
 code text not null,
 active boolean not null default true,
 unique(university_id,code)
);
create table public.academic_periods (
 id uuid primary key default gen_random_uuid(),
 university_id uuid not null references public.universities(id),
 name text not null check(char_length(name) between 2 and 200),
 registration_opens date not null,
 registration_closes date not null,
 active boolean not null default true,
 check(registration_closes >= registration_opens)
);
alter table public.profiles add column student_number text unique;
create sequence public.student_number_sequence;
revoke all on sequence public.student_number_sequence from public, anon, authenticated;
create table public.applications (
 id uuid primary key default gen_random_uuid(),
 applicant_id uuid not null references public.profiles(id),
 full_name text not null,
 university_id uuid not null references public.universities(id),
 programme_id uuid not null references public.programmes(id),
 period_id uuid not null references public.academic_periods(id),
 year_of_study integer not null check(year_of_study between 1 and 10),
 phone text not null check(phone ~ '^[+0-9 ()-]{7,25}$'),
 learning_mode public.learning_mode not null,
 status public.application_status not null default 'draft',
 revision integer not null default 1,
 consent_notice text,
 consent_version integer,
 consent_at timestamptz,
 recommendation text check(recommendation in ('approve','reject')),
 reviewed_by uuid references public.profiles(id),
 decided_by uuid references public.profiles(id),
 submitted_at timestamptz,
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index one_current_application_per_period on public.applications(applicant_id,period_id)
 where status not in ('cancelled','rejected');
create index applications_review_queue on public.applications(status,created_at desc);
create table public.application_courses (
 application_id uuid not null references public.applications(id) on delete cascade,
 course_id uuid not null references public.courses(id),
 primary key(application_id,course_id)
);
create table public.application_documents (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.applications(id) on delete cascade,
 object_path text not null unique,
 file_name text not null check(char_length(file_name) between 1 and 200),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 created_at timestamptz not null default now()
);
create index application_documents_application on public.application_documents(application_id);
create table public.application_history (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.applications(id),
 actor_id uuid not null references public.profiles(id),
 event text not null,
 note text not null default '',
 created_at timestamptz not null default now()
);
create index application_history_application on public.application_history(application_id,created_at);
create table public.enrolments (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id),
 course_id uuid not null references public.courses(id),
 period_id uuid not null references public.academic_periods(id),
 application_id uuid not null references public.applications(id),
 status text not null default 'pending' check(status in ('pending','active','withdrawn','completed')),
 created_at timestamptz not null default now(),
 unique(student_id,course_id,period_id)
);
-- Email events are committed with the application, not after a best-effort send.
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 event_key text not null unique,
 recipient text not null,
 subject text not null,
 body text not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','needs_review')),
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 locked_until timestamptz,
 provider_id text,
 created_at timestamptz not null default now()
);

create function private.can_apply() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id
 where p.id=auth.uid() and p.account_status in ('pending','active') and r.role='student');
$$;
create function private.can_read_application(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.applications a where a.id=p_id and
 ((a.applicant_id=auth.uid() and private.account_can_upload())
 or private.has_role('admissions_officer') or private.has_role('academic_admin') or (private.has_role('auditor') and a.status in ('approved','rejected'))));
$$;
create function private.can_edit_application(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare editable boolean;
begin
 select true into editable from public.applications a where a.id=p_id and a.applicant_id=auth.uid()
 and a.status in ('draft','information_required') and private.can_apply() for update;
 return coalesce(editable,false);
end;
$$;
revoke all on function private.can_apply(), private.can_read_application(uuid), private.can_edit_application(uuid) from public;
grant execute on function private.can_apply(), private.can_read_application(uuid), private.can_edit_application(uuid) to authenticated;

alter table public.organisation_settings enable row level security;
alter table public.programmes enable row level security;
alter table public.academic_periods enable row level security;
alter table public.applications enable row level security;
alter table public.application_courses enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_history enable row level security;
alter table public.enrolments enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on public.organisation_settings, public.programmes, public.academic_periods,
 public.applications, public.application_courses, public.application_documents, public.application_history,
 public.enrolments, public.notification_outbox from anon,authenticated;
grant select on public.organisation_settings, public.programmes, public.academic_periods to anon,authenticated;
grant select on public.applications, public.application_courses, public.application_documents,
 public.application_history, public.enrolments to authenticated;
create policy organisation_public on public.organisation_settings for select to anon,authenticated using(true);
create policy programmes_public on public.programmes for select to anon,authenticated using(active);
create policy periods_public on public.academic_periods for select to anon,authenticated using(active);
create policy applications_read on public.applications for select to authenticated using(private.can_read_application(id));
create policy application_courses_read on public.application_courses for select to authenticated using(private.can_read_application(application_id));
create policy application_documents_read on public.application_documents for select to authenticated using(private.can_read_application(application_id));
create policy application_history_read on public.application_history for select to authenticated using(private.can_read_application(application_id));
create policy enrolments_read on public.enrolments for select to authenticated using(
 (student_id=auth.uid() and private.account_can_upload()) or private.has_role('academic_admin') or private.has_role('admissions_officer'));
create policy universities_staff on public.universities for select to authenticated using(private.has_role('academic_admin'));
create policy courses_staff on public.courses for select to authenticated using(private.has_role('academic_admin'));
create policy programmes_staff on public.programmes for select to authenticated using(private.has_role('academic_admin'));
create policy periods_staff on public.academic_periods for select to authenticated using(private.has_role('academic_admin'));

-- Replace the initial upload policy with application-specific ownership and status.
drop policy applicant_upload on storage.objects;
drop policy applicant_read on storage.objects;
create policy applicant_upload on storage.objects for insert to authenticated with check(
 bucket_id='application-documents' and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.applications a where a.id::text=(storage.foldername(name))[2]
 and private.can_edit_application(a.id)));
create policy application_document_read on storage.objects for select to authenticated using(
 bucket_id='application-documents' and exists(select 1 from public.application_documents d
 where d.object_path=name and private.can_read_application(d.application_id)));
create policy application_document_cleanup on storage.objects for delete to authenticated using(
 bucket_id='application-documents' and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.applications a where a.id::text=(storage.foldername(name))[2]
 and private.can_edit_application(a.id)));

create function public.save_application(
 p_id uuid, p_revision integer, p_university uuid, p_programme uuid, p_period uuid,
 p_year integer, p_phone text, p_mode public.learning_mode, p_courses uuid[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.applications; result_id uuid;
begin
 if not private.can_apply() then raise exception 'An eligible student account is required'; end if;
 if not exists(select 1 from public.universities where id=p_university and active)
 or not exists(select 1 from public.programmes where id=p_programme and university_id=p_university and active)
 or not exists(select 1 from public.academic_periods where id=p_period and university_id=p_university and active)
 then raise exception 'Select an available university, programme and intake'; end if;
 if coalesce(cardinality(p_courses),0) not between 1 and 12
 or (select count(*) from public.courses where id=any(p_courses) and university_id=p_university and published) <> cardinality(p_courses)
 then raise exception 'Select distinct, published courses from the selected university'; end if;
 if p_id is null then
  insert into public.applications(applicant_id,full_name,university_id,programme_id,period_id,year_of_study,phone,learning_mode)
  values(auth.uid(),(select full_name from public.profiles where id=auth.uid()),p_university,p_programme,p_period,p_year,p_phone,p_mode) returning id into result_id;
  insert into public.application_history(application_id,actor_id,event) values(result_id,auth.uid(),'draft_created');
 else
  select * into a from public.applications where id=p_id for update;
  if not found or not private.can_edit_application(p_id) then raise exception 'This application cannot be edited'; end if;
  if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before saving'; end if;
  update public.applications set full_name=(select full_name from public.profiles where id=auth.uid()),university_id=p_university,programme_id=p_programme,period_id=p_period,
   year_of_study=p_year,phone=p_phone,learning_mode=p_mode,revision=revision+1,updated_at=now() where id=p_id;
  result_id:=p_id;
 end if;
 delete from public.application_courses where application_id=result_id;
 insert into public.application_courses(application_id,course_id) select result_id,unnest(p_courses);
 return result_id;
end; $$;

create function public.attach_application_document(
 p_application uuid,p_path text,p_name text,p_type text,p_size bigint
) returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 perform 1 from public.applications where id=p_application for update;
 if not private.can_edit_application(p_application) then raise exception 'This application cannot be edited'; end if;
 if (select count(*) from public.application_documents where application_id=p_application)>=5 then raise exception 'A maximum of five documents is allowed'; end if;
 if p_path not like auth.uid()::text || '/' || p_application::text || '/%'
 or not exists(select 1 from storage.objects where bucket_id='application-documents' and name=p_path)
 then raise exception 'Upload the document to this application first'; end if;
 insert into public.application_documents(application_id,object_path,file_name,mime_type,size_bytes)
 values(p_application,p_path,p_name,p_type,p_size) returning id into result_id;
 update public.applications set revision=revision+1,updated_at=now() where id=p_application;
 return result_id;
end; $$;

create function public.submit_application(p_id uuid,p_revision integer,p_consent boolean,p_privacy_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare a public.applications; settings public.organisation_settings; period public.academic_periods;
begin
 select * into a from public.applications where id=p_id for update;
 if not found or not private.can_edit_application(p_id) then raise exception 'This application cannot be submitted'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before submitting'; end if;
 select * into settings from public.organisation_settings where id=true;
 select * into period from public.academic_periods where id=a.period_id;
 if not settings.registration_open or not period.active
 or (now() at time zone 'Africa/Blantyre')::date not between period.registration_opens and period.registration_closes
 then raise exception 'Applications are closed for this intake'; end if;
 if not exists(select 1 from public.universities where id=a.university_id and active)
 or not exists(select 1 from public.programmes where id=a.programme_id and active)
 or not exists(select 1 from public.application_courses where application_id=p_id)
 or exists(select 1 from public.application_courses ac join public.courses c on c.id=ac.course_id
 where ac.application_id=p_id and (not c.published or c.university_id<>a.university_id))
 then raise exception 'Your selected academic options are no longer available'; end if;
 if p_consent is not true or char_length(settings.privacy_notice)<20 or settings.privacy_version is distinct from p_privacy_version
 then raise exception 'Read and accept the current privacy notice before submitting'; end if;
 if settings.documents_required and not exists(select 1 from public.application_documents where application_id=p_id)
 then raise exception 'Upload the required supporting document'; end if;
 if exists(select 1 from public.application_documents d where d.application_id=p_id and not exists(
 select 1 from storage.objects o where o.bucket_id='application-documents' and o.name=d.object_path))
 then raise exception 'A supporting document is missing. Contact admissions'; end if;
 update public.applications set status='submitted',revision=revision+1,consent_notice=settings.privacy_notice,
 consent_version=settings.privacy_version,consent_at=now(),submitted_at=now(),recommendation=null,reviewed_by=null,updated_at=now()
 where id=p_id;
 insert into public.application_history(application_id,actor_id,event) values(p_id,auth.uid(),'submitted');
end; $$;

create function public.review_application(p_id uuid,p_revision integer,p_action text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.applications; next_status public.application_status;
begin
 if not private.has_role('admissions_officer') then raise exception 'Admissions permission required'; end if;
 if char_length(btrim(p_note)) not between 5 and 2000 then raise exception 'Provide an applicant-visible review note'; end if;
 perform set_config('app.audit_reason',btrim(p_note),true);
 select * into a from public.applications where id=p_id for update;
 if not found then raise exception 'Application not found'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before reviewing'; end if;
 if a.applicant_id=auth.uid() then raise exception 'You cannot review your own application'; end if;
 if p_action='begin_review' and a.status in ('submitted','waitlisted') then next_status:='under_review';
 elsif p_action='request_information' and a.status='under_review' then next_status:='information_required';
 elsif p_action='waitlist' and a.status='under_review' then next_status:='waitlisted';
 elsif p_action in ('recommend_approval','recommend_rejection') and a.status='under_review' then next_status:='under_review';
 else raise exception 'This review action is not available for the current status'; end if;
 update public.applications set status=next_status,revision=revision+1,updated_at=now(),
 recommendation=case p_action when 'recommend_approval' then 'approve' when 'recommend_rejection' then 'reject' else null end,
 reviewed_by=case when p_action in ('recommend_approval','recommend_rejection') then auth.uid() else null end where id=p_id;
 insert into public.application_history(application_id,actor_id,event,note) values(p_id,auth.uid(),p_action,btrim(p_note));
end; $$;

create function public.decide_application(p_id uuid,p_revision integer,p_decision text,p_note text)
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

create function public.cancel_application(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.applications;
begin
 select * into a from public.applications where id=p_id for update;
 if not found or a.applicant_id<>auth.uid() or not private.can_apply()
 or a.status in ('approved','rejected','cancelled') then raise exception 'This application cannot be cancelled'; end if;
 update public.applications set status='cancelled',revision=revision+1,updated_at=now() where id=p_id;
 insert into public.application_history(application_id,actor_id,event) values(p_id,auth.uid(),'cancelled');
end; $$;

create function public.configure_academics(p_kind text,p_data jsonb)
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
   insert into public.programmes(university_id,name,code,active) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.programmes set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='period' then
  if entity_id is null then
   insert into public.academic_periods(university_id,name,registration_opens,registration_closes,active)
   values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),(p_data->>'registration_opens')::date,(p_data->>'registration_closes')::date,coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.academic_periods set name=btrim(p_data->>'name'),registration_opens=(p_data->>'registration_opens')::date,
   registration_closes=(p_data->>'registration_closes')::date,active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='course' then
  if entity_id is null then
   insert into public.courses(university_id,name,code,description,level) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce(p_data->>'description',''),(p_data->>'level')::integer) returning id into result_id;
  else update public.courses set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),description=coalesce(p_data->>'description',''),
   level=(p_data->>'level')::integer,published=false where id=entity_id returning id into result_id; end if;
 else raise exception 'Unknown academic record type'; end if;
 if result_id is null then raise exception 'Academic record not found'; end if;
 return result_id;
end; $$;

create function public.publish_course(p_id uuid,p_published boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator approval required'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide an approval reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.courses set published=p_published where id=p_id;
 if not found then raise exception 'Course not found'; end if;
end; $$;

create function public.configure_admissions(p_open boolean,p_notice text,p_prefix text,p_documents boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator permission required'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for changing admissions settings'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_open and char_length(btrim(p_notice))<20 then raise exception 'Publish your approved privacy notice before opening applications'; end if;
 if char_length(p_notice)>20000 then raise exception 'Privacy notice is too long'; end if;
 update public.organisation_settings set registration_open=p_open,privacy_notice=btrim(p_notice),
 privacy_version=privacy_version+case when privacy_notice<>btrim(p_notice) then 1 else 0 end,
 student_number_prefix=p_prefix,documents_required=p_documents where id=true;
end; $$;

create function private.queue_application_email()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient_email text;
begin
 if new.status=old.status then return new; end if;
 select email into recipient_email from auth.users where id=new.applicant_id;
 if recipient_email is not null then
  insert into public.notification_outbox(user_id,event_key,recipient,subject,body)
  values(new.applicant_id,'application/'||new.id::text||'/'||new.revision::text,recipient_email,
   'Summit ScholarsBridge application update',
   'Your application '||new.id::text||' is now '||replace(new.status::text,'_',' ')||'. Sign in to your account to view details.')
  on conflict(event_key) do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.queue_application_email() from public;
create trigger application_email after update on public.applications for each row execute function private.queue_application_email();
create trigger application_audit after insert or update or delete on public.applications for each row execute function private.audit_change();
create trigger programme_audit after insert or update or delete on public.programmes for each row execute function private.audit_change();
create trigger period_audit after insert or update or delete on public.academic_periods for each row execute function private.audit_change();
create trigger settings_audit after update on public.organisation_settings for each row execute function private.audit_change();
create trigger enrolment_audit after insert or update or delete on public.enrolments for each row execute function private.audit_change();

revoke all on function public.save_application(uuid,integer,uuid,uuid,uuid,integer,text,public.learning_mode,uuid[]),
 public.attach_application_document(uuid,text,text,text,bigint),public.submit_application(uuid,integer,boolean,integer),
 public.review_application(uuid,integer,text,text),public.decide_application(uuid,integer,text,text),public.cancel_application(uuid),
 public.configure_academics(text,jsonb),public.publish_course(uuid,boolean,text),public.configure_admissions(boolean,text,text,boolean,text)
 from public,anon;
grant execute on function public.save_application(uuid,integer,uuid,uuid,uuid,integer,text,public.learning_mode,uuid[]),
 public.attach_application_document(uuid,text,text,text,bigint),public.submit_application(uuid,integer,boolean,integer),
 public.review_application(uuid,integer,text,text),public.decide_application(uuid,integer,text,text),public.cancel_application(uuid),
 public.configure_academics(text,jsonb),public.publish_course(uuid,boolean,text),public.configure_admissions(boolean,text,text,boolean,text)
 to authenticated;
commit;
