begin;
-- Security fix: the tutor/venue overlap checks in schedule_class_session were
-- check-then-insert with no lock, so two concurrent bookings could both pass
-- before either committed. These EXCLUDE constraints are the real
-- concurrency-safe backstop, enforced by Postgres itself; the existing
-- exists() checks stay as a fast, friendly error for the common sequential
-- case, with the constraint violation mapped back to the same message.
create extension if not exists btree_gist;
alter table public.class_sessions add constraint class_sessions_no_tutor_overlap
 exclude using gist (tutor_id with =, tstzrange(starts_at,ends_at) with &&) where (status='scheduled');
alter table public.class_sessions add constraint class_sessions_no_venue_overlap
 exclude using gist (venue with =, tstzrange(starts_at,ends_at) with &&) where (status='scheduled');

create or replace function public.schedule_class_session(p_course_id uuid,p_topic text,p_venue text,p_starts_at timestamptz,p_ends_at timestamptz,p_meeting_link text,p_reason text,p_google_event_id text default null,p_google_event_html_link text default null,p_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; conflicting_constraint text;
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
 begin
  insert into public.class_sessions(id,course_id,tutor_id,topic,venue,starts_at,ends_at,meeting_link,google_event_id,google_event_html_link)
  values(coalesce(p_id,gen_random_uuid()),p_course_id,auth.uid(),btrim(p_topic),btrim(p_venue),p_starts_at,p_ends_at,nullif(btrim(coalesce(p_meeting_link,'')),''),p_google_event_id,p_google_event_html_link)
  returning id into result_id;
 exception when exclusion_violation then
  get stacked diagnostics conflicting_constraint = constraint_name;
  if conflicting_constraint = 'class_sessions_no_venue_overlap' then
   raise exception 'This venue is already booked in this time range';
  else
   raise exception 'You already have another class scheduled in this time range';
  end if;
 end;
 return result_id;
end; $$;
commit;
