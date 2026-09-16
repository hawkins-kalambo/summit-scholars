-- Step 1: identities, permissions, catalogue and private storage.
-- Apply once in a new Supabase project. Application approval comes in Step 2.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.portal_role as enum (
  'super_admin', 'system_admin', 'academic_admin', 'admissions_officer',
  'finance_officer', 'tutor', 'student', 'support_officer', 'auditor'
);
create type public.account_status as enum ('pending', 'active', 'suspended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  account_status public.account_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.portal_role not null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text not null,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_events_created_at on public.audit_events(created_at desc);

-- A SECURITY DEFINER lookup avoids recursive policies on profiles/user_roles.
-- Every staff capability requires an active account, even with a valid old JWT.
create function private.has_role(required_role public.portal_role)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = (select auth.uid()) and p.account_status = 'active'
      and (r.role = required_role or r.role = 'super_admin')
  );
$$;
create function private.account_can_upload()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles
    where id = (select auth.uid()) and account_status in ('pending', 'active'));
$$;
revoke all on function private.has_role(public.portal_role) from public;
revoke all on function private.account_can_upload() from public;
grant execute on function private.has_role(public.portal_role) to authenticated;
grant execute on function private.account_can_upload() to authenticated;

create function private.audit_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare old_row jsonb; new_row jsonb;
begin
  if TG_OP <> 'INSERT' then old_row := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then new_row := to_jsonb(new); end if;
  insert into public.audit_events(actor_id, action, table_name, record_id, previous_value, new_value, reason)
  values (auth.uid(), TG_OP, TG_TABLE_NAME,
    coalesce(new_row->>'id', old_row->>'id', new_row->>'user_id', old_row->>'user_id'),
    old_row, new_row, nullif(current_setting('app.audit_reason', true), ''));
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_change() from public;

create function private.create_account()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Never copy role or activation status from user-editable metadata.
  insert into public.profiles(id, full_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), 'Student'), 120));
  insert into public.user_roles(user_id, role) values (new.id, 'student');
  return new;
end;
$$;
revoke all on function private.create_account() from public;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.create_account();

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
revoke all on function private.touch_updated_at() from public;
create trigger profiles_updated before update on public.profiles
for each row execute function private.touch_updated_at();
create trigger profiles_audit after insert or update or delete on public.profiles
for each row execute function private.audit_change();
create trigger roles_audit after insert or update or delete on public.user_roles
for each row execute function private.audit_change();

create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  code text not null unique,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id),
  code text not null,
  name text not null check (char_length(name) between 2 and 200),
  description text not null default '',
  level integer not null check (level between 1 and 10),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique(university_id, code)
);
create index courses_university_id on public.courses(university_id);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;
alter table public.universities enable row level security;
alter table public.courses enable row level security;

-- Explicit grants prevent default Supabase grants from creating write privileges.
revoke all on public.profiles, public.user_roles, public.audit_events,
  public.universities, public.courses from anon, authenticated;
grant select on public.profiles, public.user_roles, public.audit_events to authenticated;
grant update(full_name) on public.profiles to authenticated;
grant select on public.universities, public.courses to anon, authenticated;

create policy own_profile on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy update_own_name on public.profiles for update to authenticated
using (id = (select auth.uid()) and account_status <> 'suspended')
with check (id = (select auth.uid()) and account_status <> 'suspended');
create policy own_roles on public.user_roles for select to authenticated
using (user_id = (select auth.uid()));
create policy audit_read on public.audit_events for select to authenticated
using (private.has_role('auditor'));
create policy public_universities on public.universities for select to anon, authenticated
using (active);
create policy public_courses on public.courses for select to anon, authenticated
using (published and exists (
  select 1 from public.universities u where u.id = university_id and u.active
));

-- Catalogue writes, role assignment and activation intentionally have no browser
-- write grant. Later approval functions will implement the proposal's governance.
create trigger universities_audit after insert or update or delete on public.universities
for each row execute function private.audit_change();
create trigger courses_audit after insert or update or delete on public.courses
for each row execute function private.audit_change();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
 ('application-documents', 'application-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
 ('course-materials', 'course-materials', false, 52428800, null),
 ('assignment-submissions', 'assignment-submissions', false, 20971520, null),
 ('generated-documents', 'generated-documents', false, 10485760, array['application/pdf']);

create policy applicant_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.account_can_upload()
);
create policy applicant_read on storage.objects for select to authenticated
using (
  bucket_id = 'application-documents'
  and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and private.account_can_upload())
    or private.has_role('admissions_officer')
    or private.has_role('academic_admin')
  )
);
-- No overwrite/delete policies yet. The other buckets stay closed until the
-- enrolment, submission and generated-document ownership policies are added.
commit;
