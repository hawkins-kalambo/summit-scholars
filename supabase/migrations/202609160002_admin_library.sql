begin;
-- Administrative directory, safe suspension/restoration, and private library.
alter table public.profiles add column status_before_suspension public.account_status;
create policy admin_profiles_read on public.profiles for select to authenticated using(private.has_role('system_admin'));
create policy admin_roles_read on public.user_roles for select to authenticated using(private.has_role('system_admin'));

create function public.admin_directory(p_search text default '',p_page integer default 1)
returns table(id uuid,full_name text,email text,account_status public.account_status,student_number text,roles public.portal_role[],total_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('system_admin') then raise exception 'Account management permission required'; end if;
 return query select p.id,p.full_name,u.email::text,p.account_status,p.student_number,
 array(select r.role from public.user_roles r where r.user_id=p.id),count(*) over()
 from public.profiles p join auth.users u on u.id=p.id
 where coalesce(p_search,'')='' or p.full_name ilike '%'||left(p_search,100)||'%' or u.email ilike '%'||left(p_search,100)||'%'
 order by p.created_at desc,p.id limit 25 offset (greatest(1,least(coalesce(p_page,1),100000))-1)*25;
end; $$;

create function public.change_account_status(p_id uuid,p_suspend boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
 perform pg_advisory_xact_lock(16092026);
 if not private.has_role('system_admin') then raise exception 'Account management permission required'; end if;
 if p_suspend is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide an action and reason'; end if;
 if p_id=auth.uid() then raise exception 'You cannot change your own account status'; end if;
 select * into target from public.profiles where id=p_id for update;
 if not found then raise exception 'Account not found'; end if;
 if exists(select 1 from public.user_roles where user_id=p_id and role in ('super_admin','system_admin')) and not private.has_role('super_admin') then raise exception 'Only a Super Administrator can manage administrator accounts'; end if;
 if p_suspend and target.account_status='suspended' then raise exception 'Account already suspended'; end if;
 if not p_suspend and target.account_status<>'suspended' then raise exception 'Account is not suspended'; end if;
 if p_suspend and exists(select 1 from public.user_roles where user_id=p_id and role='super_admin') and not exists(
 select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='super_admin' and p.account_status='active' and p.id<>p_id) then raise exception 'The last active Super Administrator cannot be suspended'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.profiles set status_before_suspension=case when p_suspend then account_status else null end,
 account_status=case when p_suspend then 'suspended'::public.account_status else coalesce(status_before_suspension,'pending'::public.account_status) end where profiles.id=p_id;
end; $$;

create table public.library_resources (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 2 and 200),
 description text not null default '' check(char_length(description)<=2000),
 category text not null check(category in ('past_paper','study_notes','textbook','revision','other')),
 course_id uuid references public.courses(id),
 audience text not null default 'all_students' check(audience in ('all_students','course_students')),
 content_text text check(char_length(content_text) between 1 and 100000),
 object_path text unique,
 mime_type text check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes bigint check(size_bytes between 1 and 10485760),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 revision integer not null default 1,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check ((content_text is not null and object_path is null and mime_type is null and size_bytes is null) or (content_text is null and object_path is not null and mime_type is not null and size_bytes is not null)),
 check(audience<>'course_students' or course_id is not null)
);
create index library_catalogue on public.library_resources(status,created_at desc);
alter table public.library_resources enable row level security;
revoke all on public.library_resources from anon,authenticated;
grant select on public.library_resources to authenticated;
create function private.library_manager() returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role('academic_admin');
$$;
create function private.can_read_library(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.library_manager() or exists(select 1 from public.library_resources l
 join public.profiles p on p.id=auth.uid() join public.user_roles r on r.user_id=p.id and r.role='student'
 where l.id=p_id and l.status='published' and p.account_status='active' and p.student_number is not null
 and (l.audience='all_students' or exists(select 1 from public.enrolments e where e.student_id=p.id and e.course_id=l.course_id and e.status='active')));
$$;
revoke all on function private.library_manager(),private.can_read_library(uuid) from public;
grant execute on function private.library_manager(),private.can_read_library(uuid) to authenticated;
create policy library_read on public.library_resources for select to authenticated using(private.can_read_library(id));
create trigger library_audit after insert or update or delete on public.library_resources for each row execute function private.audit_change();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('library-materials','library-materials',false,10485760,array['application/pdf','image/jpeg','image/png']);
-- No browser storage policies: files are delivered only by the authenticated portal endpoint.

create function public.save_library_resource(p_id uuid,p_revision integer,p_data jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; resource public.library_resources; file_path text:=nullif(p_data->>'object_path','');
begin
 if not private.library_manager() then raise exception 'Library management permission required'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_id is null then
  if file_path is not null and (file_path not like auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='library-materials' and name=file_path)) then raise exception 'Upload the file first'; end if;
  insert into public.library_resources(title,description,category,course_id,audience,content_text,object_path,mime_type,size_bytes,created_by)
  values(btrim(p_data->>'title'),coalesce(p_data->>'description',''),p_data->>'category',nullif(p_data->>'course_id','')::uuid,p_data->>'audience',nullif(btrim(p_data->>'content_text'),''),file_path,nullif(p_data->>'mime_type',''),nullif(p_data->>'size_bytes','')::bigint,auth.uid()) returning id into result_id;
 else
  select * into resource from public.library_resources where id=p_id for update;
  if not found or resource.revision is distinct from p_revision then raise exception 'Resource changed. Reload before saving'; end if;
  update public.library_resources set title=btrim(p_data->>'title'),description=coalesce(p_data->>'description',''),category=p_data->>'category',course_id=nullif(p_data->>'course_id','')::uuid,audience=p_data->>'audience',
  content_text=case when object_path is null then nullif(btrim(p_data->>'content_text'),'') else null end,status='draft',revision=revision+1,updated_at=now() where id=p_id;
  result_id:=p_id;
 end if;
 return result_id;
end; $$;
create function public.publish_library_resource(p_id uuid,p_revision integer,p_status text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare resource public.library_resources;
begin
 if not private.library_manager() then raise exception 'Library management permission required'; end if;
 if p_status is null or p_status not in ('draft','published','archived') or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a status and reason'; end if;
 select * into resource from public.library_resources where id=p_id for update;
 if not found or resource.revision is distinct from p_revision then raise exception 'Resource changed. Reload before publishing'; end if;
 if p_status='published' and resource.object_path is not null and not exists(select 1 from storage.objects where bucket_id='library-materials' and name=resource.object_path) then raise exception 'The resource file is missing'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.library_resources set status=p_status,revision=revision+1,updated_at=now() where id=p_id;
end; $$;
revoke all on function public.admin_directory(text,integer),public.change_account_status(uuid,boolean,text),public.save_library_resource(uuid,integer,jsonb,text),public.publish_library_resource(uuid,integer,text,text) from public,anon;
grant execute on function public.admin_directory(text,integer),public.change_account_status(uuid,boolean,text),public.save_library_resource(uuid,integer,jsonb,text),public.publish_library_resource(uuid,integer,text,text) to authenticated;
create function public.configure_organisation(p_name text,p_email text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator permission required'; end if;
 if coalesce(char_length(btrim(p_name)),0) not between 2 and 200 or p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or char_length(p_email)>254 or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide an organisation name, support email and reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.organisation_settings set organisation_name=btrim(p_name),support_email=lower(btrim(p_email)) where id=true;
end; $$;
create function public.admin_notifications(p_page integer default 1)
returns table(id uuid,subject text,status text,attempts integer,created_at timestamptz,next_attempt_at timestamptz,total_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator permission required'; end if;
 return query select n.id,n.subject,n.status,n.attempts,n.created_at,n.next_attempt_at,count(*) over() from public.notification_outbox n order by n.created_at desc,n.id limit 25 offset (greatest(1,least(coalesce(p_page,1),100000))-1)*25;
end; $$;
revoke all on function public.configure_organisation(text,text,text),public.admin_notifications(integer) from public,anon;
grant execute on function public.configure_organisation(text,text,text),public.admin_notifications(integer) to authenticated;
create function public.change_enrolment_status(p_id uuid,p_expected text,p_status text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare enrolment public.enrolments;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 if p_status is null or p_status not in ('active','withdrawn','completed') or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a status and reason'; end if;
 select * into enrolment from public.enrolments where id=p_id for update;
 if not found or enrolment.status is distinct from p_expected then raise exception 'Enrolment changed. Reload before updating'; end if;
 if not ((enrolment.status='pending' and p_status in ('active','withdrawn')) or (enrolment.status='active' and p_status in ('withdrawn','completed')) or (enrolment.status='withdrawn' and p_status='active')) then raise exception 'This enrolment transition is not allowed'; end if;
 if p_status='active' and (not exists(select 1 from public.profiles where id=enrolment.student_id and account_status='active') or not exists(select 1 from public.applications where id=enrolment.application_id and status='approved')) then raise exception 'Active enrolment requires an active student and approved application'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.enrolments set status=p_status where id=p_id;
end; $$;
revoke all on function public.change_enrolment_status(uuid,text,text,text) from public,anon;
grant execute on function public.change_enrolment_status(uuid,text,text,text) to authenticated;
commit;
