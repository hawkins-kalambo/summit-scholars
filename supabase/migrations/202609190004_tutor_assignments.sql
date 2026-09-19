begin;
-- Phase 4.1: tutor-course assignment and the safeguards it enforces
-- ("assigned courses/students only — no access to unrelated records").
create table public.course_tutors (
 course_id uuid not null references public.courses(id),
 tutor_id uuid not null references public.profiles(id),
 assigned_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(course_id,tutor_id)
);
create index course_tutors_tutor_id on public.course_tutors(tutor_id);
alter table public.course_tutors enable row level security;
revoke all on public.course_tutors from anon,authenticated;
grant select on public.course_tutors to authenticated;
create policy course_tutors_read on public.course_tutors for select to authenticated using(
 tutor_id=(select auth.uid()) or private.has_role('academic_admin')
);

-- private.audit_change() keys record_id off an `id` or `user_id` column;
-- course_tutors has a composite key instead, so it needs its own trigger.
create function private.audit_course_tutors()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb;
begin
 if TG_OP <> 'INSERT' then old_row := to_jsonb(old); end if;
 if TG_OP <> 'DELETE' then new_row := to_jsonb(new); end if;
 insert into public.audit_events(actor_id, action, table_name, record_id, previous_value, new_value, reason)
 values (auth.uid(), TG_OP, TG_TABLE_NAME,
  coalesce(new_row->>'course_id', old_row->>'course_id') || ':' || coalesce(new_row->>'tutor_id', old_row->>'tutor_id'),
  old_row, new_row, nullif(current_setting('app.audit_reason', true), ''));
 if TG_OP = 'DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.audit_course_tutors() from public;
create trigger course_tutors_audit after insert or update or delete on public.course_tutors
for each row execute function private.audit_course_tutors();

create function public.assign_course_tutor(p_course_id uuid,p_tutor_id uuid,p_assign boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('academic_admin') then raise exception 'Academic configuration permission required'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this assignment change'; end if;
 if not exists(select 1 from public.user_roles where user_id=p_tutor_id and role='tutor') then raise exception 'This account does not hold the tutor role'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_assign then
  insert into public.course_tutors(course_id,tutor_id,assigned_by) values(p_course_id,p_tutor_id,auth.uid()) on conflict do nothing;
 else
  delete from public.course_tutors where course_id=p_course_id and tutor_id=p_tutor_id;
 end if;
end; $$;

create function public.list_tutors()
returns table(id uuid,full_name text)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('academic_admin') then raise exception 'Academic configuration permission required'; end if;
 return query select p.id,p.full_name from public.profiles p join public.user_roles r on r.user_id=p.id
  where r.role='tutor' and p.account_status='active' order by p.full_name;
end; $$;

create function public.tutor_courses()
returns table(course_id uuid,name text,code text,student_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 return query select c.id,c.name,c.code,count(e.id)
  from public.course_tutors ct join public.courses c on c.id=ct.course_id
  left join public.enrolments e on e.course_id=c.id and e.status='active'
  where ct.tutor_id=auth.uid() group by c.id,c.name,c.code order by c.name;
end; $$;

create function public.tutor_course_roster(p_course_id uuid)
returns table(student_id uuid,full_name text,status text)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=auth.uid()) and not private.has_role('academic_admin') then
  raise exception 'You are not assigned to this course';
 end if;
 return query select e.student_id,p.full_name,e.status from public.enrolments e
  join public.profiles p on p.id=e.student_id where e.course_id=p_course_id order by p.full_name;
end; $$;

revoke all on function public.assign_course_tutor(uuid,uuid,boolean,text),public.list_tutors(),
 public.tutor_courses(),public.tutor_course_roster(uuid) from public,anon;
grant execute on function public.assign_course_tutor(uuid,uuid,boolean,text),public.list_tutors(),
 public.tutor_courses(),public.tutor_course_roster(uuid) to authenticated;
commit;
