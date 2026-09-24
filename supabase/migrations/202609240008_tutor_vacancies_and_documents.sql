begin;
-- Phase 2: tutor recruitment overhaul. Applying is no longer a permanent,
-- always-visible link -- staff post vacancies, and the public page only
-- accepts applications against a currently open one. Documents are now
-- categorized (cover letter, CV, certificates, ID, other) instead of one
-- generic upload slot, and the document cap is raised to fit them.
create table public.tutor_vacancies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 2 and 200),
 subjects text not null check(char_length(subjects) between 2 and 500),
 description text not null check(char_length(description) between 10 and 4000),
 is_open boolean not null default true,
 closes_at date,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index tutor_vacancies_open on public.tutor_vacancies(is_open,created_at desc);

alter table public.tutor_vacancies enable row level security;
revoke all on public.tutor_vacancies from anon,authenticated;
grant select on public.tutor_vacancies to anon,authenticated;
-- private.has_role() is normally execute-granted to authenticated only; this
-- policy also applies to anon, so extend the grant. Harmless: has_role()
-- resolves auth.uid(), which is always null for anon, so it just returns false.
grant execute on function private.has_role(public.portal_role) to anon;
create policy tutor_vacancies_read on public.tutor_vacancies for select to anon,authenticated using(
 (is_open and (closes_at is null or closes_at>=current_date)) or private.has_role('academic_admin') or private.has_role('system_admin')
);
create trigger tutor_vacancies_audit after insert or update or delete on public.tutor_vacancies for each row execute function private.audit_change();

create function public.create_vacancy(p_title text,p_subjects text,p_description text,p_closes_at date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not private.has_role('academic_admin') and not private.has_role('system_admin') then raise exception 'Academic or System Administrator permission required'; end if;
 if char_length(btrim(p_title)) not between 2 and 200 then raise exception 'Enter a vacancy title'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects for this vacancy'; end if;
 if char_length(btrim(p_description)) not between 10 and 4000 then raise exception 'Describe the vacancy in more detail'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.tutor_vacancies(title,subjects,description,closes_at,created_by)
 values(btrim(p_title),btrim(p_subjects),btrim(p_description),p_closes_at,auth.uid())
 returning id into result_id;
 return result_id;
end; $$;

create function public.update_vacancy(p_id uuid,p_title text,p_subjects text,p_description text,p_is_open boolean,p_closes_at date,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('academic_admin') and not private.has_role('system_admin') then raise exception 'Academic or System Administrator permission required'; end if;
 if char_length(btrim(p_title)) not between 2 and 200 then raise exception 'Enter a vacancy title'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects for this vacancy'; end if;
 if char_length(btrim(p_description)) not between 10 and 4000 then raise exception 'Describe the vacancy in more detail'; end if;
 if not exists(select 1 from public.tutor_vacancies where id=p_id) then raise exception 'Vacancy not found'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.tutor_vacancies set title=btrim(p_title),subjects=btrim(p_subjects),description=btrim(p_description),
  is_open=coalesce(p_is_open,true),closes_at=p_closes_at,updated_at=now() where id=p_id;
end; $$;
revoke all on function public.create_vacancy(text,text,text,date,text),public.update_vacancy(uuid,text,text,text,boolean,date,text) from public,anon;
grant execute on function public.create_vacancy(text,text,text,date,text),public.update_vacancy(uuid,text,text,text,boolean,date,text) to authenticated;

-- Applications now reference the vacancy they were made against. Nullable
-- at the schema level so any existing rows aren't broken; new submissions
-- are required to supply one by submit_tutor_application below.
alter table public.tutor_applications add column vacancy_id uuid references public.tutor_vacancies(id);

drop function if exists public.submit_tutor_application(text,text,text,text,text);
create function public.submit_tutor_application(p_vacancy_id uuid,p_full_name text,p_phone text,p_subjects text,p_qualifications text,p_availability text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and account_status in ('pending','active')) then
  raise exception 'An eligible account is required to apply';
 end if;
 if not exists(select 1 from public.tutor_vacancies where id=p_vacancy_id and is_open and (closes_at is null or closes_at>=current_date)) then
  raise exception 'This vacancy is no longer open';
 end if;
 if exists(select 1 from public.user_roles where user_id=auth.uid() and role='tutor') then raise exception 'Your account already holds the tutor role'; end if;
 if exists(select 1 from public.tutor_applications where applicant_id=auth.uid() and status<>'rejected') then raise exception 'You already have an application on file'; end if;
 if char_length(btrim(p_full_name)) not between 2 and 200 then raise exception 'Enter your full name'; end if;
 if p_phone !~ '^[+0-9 ()-]{7,25}$' then raise exception 'Enter a valid phone number'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects you can teach'; end if;
 if char_length(btrim(p_qualifications)) not between 10 and 4000 then raise exception 'Describe your qualifications in more detail'; end if;
 if char_length(btrim(p_availability)) not between 2 and 1000 then raise exception 'Describe your availability'; end if;
 insert into public.tutor_applications(applicant_id,vacancy_id,full_name,phone,subjects,qualifications,availability)
 values(auth.uid(),p_vacancy_id,btrim(p_full_name),btrim(p_phone),btrim(p_subjects),btrim(p_qualifications),btrim(p_availability))
 returning id into result_id;
 return result_id;
end; $$;
revoke all on function public.submit_tutor_application(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.submit_tutor_application(uuid,text,text,text,text,text) to authenticated;

-- Categorized documents: a cover letter, a CV, one or more certificates,
-- an ID document, and anything else -- instead of one generic upload type.
alter table public.tutor_application_documents add column document_category text not null default 'other'
 check(document_category in ('cover_letter','cv','certificate','id_document','other'));

drop function if exists public.attach_tutor_application_document(uuid,text,text,text,bigint);
create function public.attach_tutor_application_document(p_application uuid,p_path text,p_name text,p_type text,p_size bigint,p_category text default 'other')
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not private.can_edit_tutor_application(p_application) then raise exception 'This application cannot be edited'; end if;
 if p_category not in ('cover_letter','cv','certificate','id_document','other') then raise exception 'Choose a valid document type'; end if;
 if (select count(*) from public.tutor_application_documents where application_id=p_application)>=8 then raise exception 'A maximum of eight documents is allowed'; end if;
 if p_path not like auth.uid()::text || '/' || p_application::text || '/%'
 or not exists(select 1 from storage.objects where bucket_id='tutor-application-documents' and name=p_path)
 then raise exception 'Upload the document to this application first'; end if;
 insert into public.tutor_application_documents(application_id,object_path,file_name,mime_type,size_bytes,document_category)
 values(p_application,p_path,p_name,p_type,p_size,p_category) returning id into result_id;
 update public.tutor_applications set revision=revision+1,updated_at=now() where id=p_application;
 return result_id;
end; $$;
revoke all on function public.attach_tutor_application_document(uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.attach_tutor_application_document(uuid,text,text,text,bigint,text) to authenticated;
commit;
