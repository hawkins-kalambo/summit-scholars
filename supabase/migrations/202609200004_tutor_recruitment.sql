begin;
-- Public tutor recruitment: anyone with a verified account can apply to
-- become a tutor. Reviewed by academic_admin, mirroring the student
-- admissions separation-of-duties pattern (a different admin must decide
-- than the one who began the review). Approval grants the tutor role.
create type public.tutor_application_status as enum ('submitted','under_review','approved','rejected');
create table public.tutor_applications (
 id uuid primary key default gen_random_uuid(),
 applicant_id uuid not null references public.profiles(id),
 full_name text not null check(char_length(full_name) between 2 and 200),
 phone text not null check(phone ~ '^[+0-9 ()-]{7,25}$'),
 subjects text not null check(char_length(subjects) between 2 and 500),
 qualifications text not null check(char_length(qualifications) between 10 and 4000),
 availability text not null check(char_length(availability) between 2 and 1000),
 status public.tutor_application_status not null default 'submitted',
 reviewed_by uuid references public.profiles(id),
 decision_reason text,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 decided_at timestamptz
);
create unique index one_current_tutor_application on public.tutor_applications(applicant_id) where status<>'rejected';
create index tutor_applications_review_queue on public.tutor_applications(status,created_at desc);

create table public.tutor_application_documents (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.tutor_applications(id) on delete cascade,
 object_path text not null unique,
 file_name text not null check(char_length(file_name) between 1 and 200),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 created_at timestamptz not null default now()
);
create index tutor_application_documents_application on public.tutor_application_documents(application_id);

create function private.can_edit_tutor_application(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare editable boolean;
begin
 select true into editable from public.tutor_applications a where a.id=p_id and a.applicant_id=auth.uid() and a.status='submitted' for update;
 return coalesce(editable,false);
end; $$;
create function private.can_read_tutor_application(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tutor_applications a where a.id=p_id and
 (a.applicant_id=auth.uid() or private.has_role('academic_admin')));
$$;
revoke all on function private.can_edit_tutor_application(uuid),private.can_read_tutor_application(uuid) from public;
grant execute on function private.can_edit_tutor_application(uuid),private.can_read_tutor_application(uuid) to authenticated;

alter table public.tutor_applications enable row level security;
alter table public.tutor_application_documents enable row level security;
revoke all on public.tutor_applications,public.tutor_application_documents from anon,authenticated;
grant select on public.tutor_applications,public.tutor_application_documents to authenticated;
create policy tutor_applications_read on public.tutor_applications for select to authenticated using(private.can_read_tutor_application(id));
create policy tutor_application_documents_read on public.tutor_application_documents for select to authenticated using(private.can_read_tutor_application(application_id));

create trigger tutor_applications_audit after insert or update or delete on public.tutor_applications for each row execute function private.audit_change();
create trigger tutor_application_documents_audit after insert or update or delete on public.tutor_application_documents for each row execute function private.audit_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tutor-application-documents','tutor-application-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);
create policy tutor_applicant_upload on storage.objects for insert to authenticated with check(
 bucket_id='tutor-application-documents' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.tutor_applications a where a.id::text=(storage.foldername(name))[2] and private.can_edit_tutor_application(a.id))
);
create policy tutor_application_document_read on storage.objects for select to authenticated using(
 bucket_id='tutor-application-documents' and exists(select 1 from public.tutor_application_documents d
 where d.object_path=name and private.can_read_tutor_application(d.application_id))
);
create policy tutor_application_document_cleanup on storage.objects for delete to authenticated using(
 bucket_id='tutor-application-documents' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.tutor_applications a where a.id::text=(storage.foldername(name))[2] and private.can_edit_tutor_application(a.id))
);

create function public.submit_tutor_application(p_full_name text,p_phone text,p_subjects text,p_qualifications text,p_availability text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if exists(select 1 from public.user_roles where user_id=auth.uid() and role='tutor') then raise exception 'Your account already holds the tutor role'; end if;
 if exists(select 1 from public.tutor_applications where applicant_id=auth.uid() and status<>'rejected') then raise exception 'You already have an application on file'; end if;
 if char_length(btrim(p_full_name)) not between 2 and 200 then raise exception 'Enter your full name'; end if;
 if p_phone !~ '^[+0-9 ()-]{7,25}$' then raise exception 'Enter a valid phone number'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects you can teach'; end if;
 if char_length(btrim(p_qualifications)) not between 10 and 4000 then raise exception 'Describe your qualifications in more detail'; end if;
 if char_length(btrim(p_availability)) not between 2 and 1000 then raise exception 'Describe your availability'; end if;
 insert into public.tutor_applications(applicant_id,full_name,phone,subjects,qualifications,availability)
 values(auth.uid(),btrim(p_full_name),btrim(p_phone),btrim(p_subjects),btrim(p_qualifications),btrim(p_availability))
 returning id into result_id;
 return result_id;
end; $$;

create function public.attach_tutor_application_document(p_application uuid,p_path text,p_name text,p_type text,p_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not private.can_edit_tutor_application(p_application) then raise exception 'This application cannot be edited'; end if;
 if (select count(*) from public.tutor_application_documents where application_id=p_application)>=5 then raise exception 'A maximum of five documents is allowed'; end if;
 if p_path not like auth.uid()::text || '/' || p_application::text || '/%'
 or not exists(select 1 from storage.objects where bucket_id='tutor-application-documents' and name=p_path)
 then raise exception 'Upload the document to this application first'; end if;
 insert into public.tutor_application_documents(application_id,object_path,file_name,mime_type,size_bytes)
 values(p_application,p_path,p_name,p_type,p_size) returning id into result_id;
 update public.tutor_applications set revision=revision+1,updated_at=now() where id=p_application;
 return result_id;
end; $$;

create function public.review_tutor_application(p_id uuid,p_revision integer,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.tutor_applications;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 if char_length(btrim(p_note)) not between 5 and 2000 then raise exception 'Provide a review note'; end if;
 select * into a from public.tutor_applications where id=p_id for update;
 if not found or a.status<>'submitted' then raise exception 'This application cannot be reviewed'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before reviewing'; end if;
 perform set_config('app.audit_reason',btrim(p_note),true);
 update public.tutor_applications set status='under_review',reviewed_by=auth.uid(),revision=revision+1,updated_at=now() where id=p_id;
end; $$;

create function public.decide_tutor_application(p_id uuid,p_revision integer,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.tutor_applications;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 if p_decision not in ('approve','reject') or char_length(btrim(p_note)) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into a from public.tutor_applications where id=p_id for update;
 if not found or a.status<>'under_review' then raise exception 'This application is not ready for a decision'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before deciding'; end if;
 if a.reviewed_by=auth.uid() then raise exception 'A different academic administrator must decide this application'; end if;
 perform set_config('app.audit_reason',btrim(p_note),true);
 if p_decision='approve' then
  insert into public.user_roles(user_id,role) values(a.applicant_id,'tutor') on conflict do nothing;
  update public.profiles set account_status='active' where id=a.applicant_id and account_status<>'active';
 end if;
 update public.tutor_applications set status=case p_decision when 'approve' then 'approved'::public.tutor_application_status else 'rejected'::public.tutor_application_status end,
  decision_reason=btrim(p_note),decided_at=now(),revision=revision+1,updated_at=now() where id=p_id;
end; $$;

revoke all on function public.submit_tutor_application(text,text,text,text,text),public.attach_tutor_application_document(uuid,text,text,text,bigint),
 public.review_tutor_application(uuid,integer,text),public.decide_tutor_application(uuid,integer,text,text) from public,anon;
grant execute on function public.submit_tutor_application(text,text,text,text,text),public.attach_tutor_application_document(uuid,text,text,text,bigint),
 public.review_tutor_application(uuid,integer,text),public.decide_tutor_application(uuid,integer,text,text) to authenticated;
commit;
