begin;
-- Phase 1.1: campuses and faculties beneath each university, departments beneath each faculty.
create table public.campuses (
 id uuid primary key default gen_random_uuid(),
 university_id uuid not null references public.universities(id),
 name text not null check(char_length(name) between 2 and 200),
 code text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(university_id,code)
);
create table public.faculties (
 id uuid primary key default gen_random_uuid(),
 university_id uuid not null references public.universities(id),
 name text not null check(char_length(name) between 2 and 200),
 code text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(university_id,code)
);
create table public.departments (
 id uuid primary key default gen_random_uuid(),
 faculty_id uuid not null references public.faculties(id),
 name text not null check(char_length(name) between 2 and 200),
 code text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(faculty_id,code)
);
create index campuses_university_id on public.campuses(university_id);
create index faculties_university_id on public.faculties(university_id);
create index departments_faculty_id on public.departments(faculty_id);

alter table public.campuses enable row level security;
alter table public.faculties enable row level security;
alter table public.departments enable row level security;
revoke all on public.campuses,public.faculties,public.departments from anon,authenticated;
grant select on public.campuses,public.faculties,public.departments to authenticated;
create policy campuses_read on public.campuses for select to authenticated using(true);
create policy faculties_read on public.faculties for select to authenticated using(true);
create policy departments_read on public.departments for select to authenticated using(true);

create trigger campuses_audit after insert or update or delete on public.campuses for each row execute function private.audit_change();
create trigger faculties_audit after insert or update or delete on public.faculties for each row execute function private.audit_change();
create trigger departments_audit after insert or update or delete on public.departments for each row execute function private.audit_change();

-- System Administrator authority, deliberately separate from academic_admin's
-- configure_academics: this hierarchy is organisational, not academic content.
create function public.configure_academic_structure(p_kind text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; entity_id uuid:=nullif(p_data->>'id','')::uuid;
begin
 if not private.has_role('system_admin') then raise exception 'System Administrator permission required'; end if;
 if char_length(btrim(p_data->>'name')) not between 2 and 200 then raise exception 'Provide a valid name'; end if;
 if coalesce(char_length(btrim(p_data->>'reason')),0) not between 5 and 2000 then raise exception 'Provide a reason for this configuration change'; end if;
 perform set_config('app.audit_reason',btrim(p_data->>'reason'),true);
 if coalesce(char_length(upper(btrim(p_data->>'code'))),0) not between 2 and 40 then raise exception 'Provide an internal code of 2 to 40 characters'; end if;
 if p_kind='campus' then
  if entity_id is null then
   insert into public.campuses(university_id,name,code,active) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.campuses set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='faculty' then
  if entity_id is null then
   insert into public.faculties(university_id,name,code,active) values((p_data->>'university_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.faculties set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 elsif p_kind='department' then
  if entity_id is null then
   insert into public.departments(faculty_id,name,code,active) values((p_data->>'faculty_id')::uuid,btrim(p_data->>'name'),upper(btrim(p_data->>'code')),coalesce((p_data->>'active')::boolean,true)) returning id into result_id;
  else update public.departments set name=btrim(p_data->>'name'),code=upper(btrim(p_data->>'code')),active=coalesce((p_data->>'active')::boolean,true) where id=entity_id returning id into result_id; end if;
 else raise exception 'Unknown structure record type'; end if;
 if result_id is null then raise exception 'Record not found'; end if;
 return result_id;
end; $$;
revoke all on function public.configure_academic_structure(text,jsonb) from public,anon;
grant execute on function public.configure_academic_structure(text,jsonb) to authenticated;
commit;
