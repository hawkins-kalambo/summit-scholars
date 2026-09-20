begin;
-- Phase 7.1/7.3/7.4: tutor-scheduled class sessions, attendance, and session
-- confirmation. Confirmation happens as part of taking attendance, per the
-- plan; actual start/end timestamps are captured now because Phase 8's
-- payroll calculation will need real duration, not just a boolean.
create type public.session_status as enum ('scheduled','completed','cancelled','no_show');
create type public.attendance_status as enum ('present','absent','late','excused');

create table public.class_sessions (
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id),
 tutor_id uuid not null references public.profiles(id),
 topic text not null check(char_length(topic) between 2 and 200),
 venue text not null check(char_length(venue) between 2 and 200),
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at > starts_at),
 meeting_link text,
 status public.session_status not null default 'scheduled',
 actual_starts_at timestamptz,
 actual_ends_at timestamptz check(actual_ends_at is null or actual_starts_at is null or actual_ends_at > actual_starts_at),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index class_sessions_course_id on public.class_sessions(course_id);
create index class_sessions_tutor_id on public.class_sessions(tutor_id,starts_at);

create table public.session_attendance (
 session_id uuid not null references public.class_sessions(id),
 student_id uuid not null references public.profiles(id),
 status public.attendance_status not null,
 recorded_at timestamptz not null default now(),
 primary key(session_id,student_id)
);

alter table public.class_sessions enable row level security;
alter table public.session_attendance enable row level security;
revoke all on public.class_sessions,public.session_attendance from anon,authenticated;
grant select on public.class_sessions,public.session_attendance to authenticated;
create policy class_sessions_read on public.class_sessions for select to authenticated using(
 tutor_id=(select auth.uid())
 or private.has_role('academic_admin')
 or exists(select 1 from public.enrolments e where e.course_id=class_sessions.course_id and e.student_id=(select auth.uid()) and e.status<>'withdrawn')
);
create policy session_attendance_read on public.session_attendance for select to authenticated using(
 student_id=(select auth.uid())
 or private.has_role('academic_admin')
 or exists(select 1 from public.class_sessions cs where cs.id=session_attendance.session_id and cs.tutor_id=(select auth.uid()))
);

create trigger class_sessions_audit after insert or update or delete on public.class_sessions
for each row execute function private.audit_change();

-- private.audit_change() keys record_id off an `id` or `user_id` column;
-- session_attendance has a composite key instead, so it needs its own trigger.
create function private.audit_session_attendance()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb;
begin
 if TG_OP <> 'INSERT' then old_row := to_jsonb(old); end if;
 if TG_OP <> 'DELETE' then new_row := to_jsonb(new); end if;
 insert into public.audit_events(actor_id, action, table_name, record_id, previous_value, new_value, reason)
 values (auth.uid(), TG_OP, TG_TABLE_NAME,
  coalesce(new_row->>'session_id', old_row->>'session_id') || ':' || coalesce(new_row->>'student_id', old_row->>'student_id'),
  old_row, new_row, nullif(current_setting('app.audit_reason', true), ''));
 if TG_OP = 'DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.audit_session_attendance() from public;
create trigger session_attendance_audit after insert or update or delete on public.session_attendance
for each row execute function private.audit_session_attendance();

create function public.schedule_class_session(p_course_id uuid,p_topic text,p_venue text,p_starts_at timestamptz,p_ends_at timestamptz,p_meeting_link text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=auth.uid()) then raise exception 'You are not assigned to this course'; end if;
 if char_length(btrim(p_topic)) not between 2 and 200 or char_length(btrim(p_venue)) not between 2 and 200 then raise exception 'Provide a topic and venue'; end if;
 if p_ends_at <= p_starts_at then raise exception 'The class must end after it starts'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this schedule change'; end if;
 if exists(select 1 from public.class_sessions where tutor_id=auth.uid() and status='scheduled' and starts_at<p_ends_at and ends_at>p_starts_at) then
  raise exception 'You already have another class scheduled in this time range';
 end if;
 if exists(select 1 from public.class_sessions where venue=btrim(p_venue) and status='scheduled' and starts_at<p_ends_at and ends_at>p_starts_at) then
  raise exception 'This venue is already booked in this time range';
 end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.class_sessions(course_id,tutor_id,topic,venue,starts_at,ends_at,meeting_link)
 values(p_course_id,auth.uid(),btrim(p_topic),btrim(p_venue),p_starts_at,p_ends_at,nullif(btrim(coalesce(p_meeting_link,'')),''))
 returning id into result_id;
 return result_id;
end; $$;

create function public.confirm_class_session(p_session_id uuid,p_status text,p_actual_starts_at timestamptz,p_actual_ends_at timestamptz,p_attendance jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare session_row public.class_sessions; entry jsonb;
begin
 select * into session_row from public.class_sessions where id=p_session_id and tutor_id=auth.uid() for update;
 if not found then raise exception 'Session not found or not yours to confirm'; end if;
 if session_row.status<>'scheduled' then raise exception 'This session has already been confirmed'; end if;
 if p_status not in ('completed','cancelled','no_show') then raise exception 'Choose a valid outcome'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_status='completed' then
  if p_actual_starts_at is null or p_actual_ends_at is null or p_actual_ends_at<=p_actual_starts_at then raise exception 'Provide the actual start and end time'; end if;
  for entry in select * from jsonb_array_elements(coalesce(p_attendance,'[]'::jsonb)) loop
   if entry->>'status' not in ('present','absent','late','excused') then raise exception 'Invalid attendance status'; end if;
   if not exists(select 1 from public.enrolments where student_id=(entry->>'student_id')::uuid and course_id=session_row.course_id and status<>'withdrawn') then
    raise exception 'One of the attendance entries is not an enrolled student';
   end if;
   insert into public.session_attendance(session_id,student_id,status) values(p_session_id,(entry->>'student_id')::uuid,(entry->>'status')::public.attendance_status)
   on conflict(session_id,student_id) do update set status=excluded.status,recorded_at=now();
  end loop;
  update public.class_sessions set status='completed',actual_starts_at=p_actual_starts_at,actual_ends_at=p_actual_ends_at,updated_at=now() where id=p_session_id;
 else
  update public.class_sessions set status=p_status::public.session_status,updated_at=now() where id=p_session_id;
 end if;
end; $$;

revoke all on function public.schedule_class_session(uuid,text,text,timestamptz,timestamptz,text,text),
 public.confirm_class_session(uuid,text,timestamptz,timestamptz,jsonb,text) from public,anon;
grant execute on function public.schedule_class_session(uuid,text,text,timestamptz,timestamptz,text,text),
 public.confirm_class_session(uuid,text,timestamptz,timestamptz,jsonb,text) to authenticated;
commit;
