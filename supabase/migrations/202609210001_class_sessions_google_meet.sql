begin;
-- Optional Google Meet auto-generation for online classes. The Google Calendar
-- adapter (lib/calendar/google.ts) talks to Google from the app layer using a
-- single institution account; this migration only stores the resulting event
-- id so a cancelled class can later cancel the calendar event too. Until
-- GOOGLE_* env vars are configured, the adapter is unused and tutors keep
-- pasting a manual meeting_link as before.
alter table public.class_sessions add column google_event_id text;

drop function if exists public.schedule_class_session(uuid,text,text,timestamptz,timestamptz,text,text);

create function public.schedule_class_session(p_course_id uuid,p_topic text,p_venue text,p_starts_at timestamptz,p_ends_at timestamptz,p_meeting_link text,p_reason text,p_google_event_id text default null)
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
 insert into public.class_sessions(course_id,tutor_id,topic,venue,starts_at,ends_at,meeting_link,google_event_id)
 values(p_course_id,auth.uid(),btrim(p_topic),btrim(p_venue),p_starts_at,p_ends_at,nullif(btrim(coalesce(p_meeting_link,'')),''),p_google_event_id)
 returning id into result_id;
 return result_id;
end; $$;

revoke all on function public.schedule_class_session(uuid,text,text,timestamptz,timestamptz,text,text,text) from public,anon;
grant execute on function public.schedule_class_session(uuid,text,text,timestamptz,timestamptz,text,text,text) to authenticated;
commit;
