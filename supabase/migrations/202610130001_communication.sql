begin;
-- Phase 5 (communication), first slice: announcements and tutor<->student
-- direct messages, scoped to a shared course. Support tickets, reminders,
-- configurable notification preferences, generated documents and reporting
-- are deferred to a later slice.
create table public.announcements (
 id uuid primary key default gen_random_uuid(),
 course_id uuid references public.courses(id),
 author_id uuid not null references public.profiles(id),
 title text not null check(char_length(title) between 2 and 200),
 body text not null check(char_length(body) between 5 and 4000),
 created_at timestamptz not null default now()
);
create index announcements_course_id on public.announcements(course_id);

-- A thread is scoped to the course that makes the tutor<->student pair
-- eligible to talk at all; re-used if either side starts a conversation
-- about the same course again.
create table public.message_threads (
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id),
 tutor_id uuid not null references public.profiles(id),
 student_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(course_id,tutor_id,student_id)
);
create index message_threads_tutor_id on public.message_threads(tutor_id);
create index message_threads_student_id on public.message_threads(student_id);

create table public.messages (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references public.message_threads(id),
 sender_id uuid not null references public.profiles(id),
 body text not null check(char_length(body) between 1 and 4000),
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index messages_thread_id on public.messages(thread_id);

alter table public.announcements enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
revoke all on public.announcements,public.message_threads,public.messages from anon,authenticated;
grant select on public.announcements,public.message_threads,public.messages to authenticated;

create policy announcements_read on public.announcements for select to authenticated using(
 course_id is null
 or private.has_role('academic_admin')
 or exists(select 1 from public.course_tutors ct where ct.course_id=announcements.course_id and ct.tutor_id=(select auth.uid()))
 or exists(select 1 from public.enrolments e where e.course_id=announcements.course_id and e.student_id=(select auth.uid()) and e.status<>'withdrawn')
);
create policy message_threads_read on public.message_threads for select to authenticated using(
 tutor_id=(select auth.uid()) or student_id=(select auth.uid()) or private.has_role('academic_admin')
);
create policy messages_read on public.messages for select to authenticated using(
 private.has_role('academic_admin')
 or exists(select 1 from public.message_threads t where t.id=messages.thread_id and (t.tutor_id=(select auth.uid()) or t.student_id=(select auth.uid())))
);

create trigger announcements_audit after insert or update or delete on public.announcements for each row execute function private.audit_change();
create trigger message_threads_audit after insert or update or delete on public.message_threads for each row execute function private.audit_change();
create trigger messages_audit after insert or update or delete on public.messages for each row execute function private.audit_change();

create function public.post_announcement(p_course_id uuid,p_title text,p_body text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if char_length(btrim(p_title)) not between 2 and 200 then raise exception 'Enter a title'; end if;
 if char_length(btrim(p_body)) not between 5 and 4000 then raise exception 'Enter the announcement text'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 if p_course_id is null then
  if not private.has_role('academic_admin') then raise exception 'Academic administration permission required for a site-wide announcement'; end if;
 elsif not private.has_role('academic_admin') and not exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=auth.uid()) then
  raise exception 'You are not assigned to this course';
 end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.announcements(course_id,author_id,title,body) values(p_course_id,auth.uid(),btrim(p_title),btrim(p_body)) returning id into result_id;
 return result_id;
end; $$;

create function public.delete_announcement(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.announcements;
begin
 select * into a from public.announcements where id=p_id;
 if not found then raise exception 'Announcement not found'; end if;
 if a.author_id<>auth.uid() and not private.has_role('academic_admin') then raise exception 'You did not post this announcement'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 delete from public.announcements where id=p_id;
end; $$;

create function public.start_message_thread(p_course_id uuid,p_other_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; resolved_tutor uuid; resolved_student uuid;
begin
 if exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=auth.uid())
  and exists(select 1 from public.enrolments where course_id=p_course_id and student_id=p_other_id and status<>'withdrawn')
 then resolved_tutor:=auth.uid(); resolved_student:=p_other_id;
 elsif exists(select 1 from public.enrolments where course_id=p_course_id and student_id=auth.uid() and status<>'withdrawn')
  and exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=p_other_id)
 then resolved_tutor:=p_other_id; resolved_student:=auth.uid();
 else raise exception 'You are not eligible to message this person about this course';
 end if;
 insert into public.message_threads(course_id,tutor_id,student_id) values(p_course_id,resolved_tutor,resolved_student)
  on conflict(course_id,tutor_id,student_id) do nothing returning id into result_id;
 if result_id is null then
  select id into result_id from public.message_threads where course_id=p_course_id and tutor_id=resolved_tutor and student_id=resolved_student;
 end if;
 return result_id;
end; $$;

create function public.send_message(p_thread_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.message_threads; result_id uuid;
begin
 select * into t from public.message_threads where id=p_thread_id;
 if not found or (t.tutor_id<>auth.uid() and t.student_id<>auth.uid()) then raise exception 'You are not part of this conversation'; end if;
 if char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'Enter a message'; end if;
 insert into public.messages(thread_id,sender_id,body) values(p_thread_id,auth.uid(),btrim(p_body)) returning id into result_id;
 return result_id;
end; $$;

create function public.mark_thread_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.message_threads where id=p_thread_id and (tutor_id=auth.uid() or student_id=auth.uid())) then
  raise exception 'You are not part of this conversation';
 end if;
 update public.messages set read_at=now() where thread_id=p_thread_id and sender_id<>auth.uid() and read_at is null;
end; $$;

-- profiles grants no direct read of another account's full_name; this (and
-- my_course_tutors below) are the controlled lookups, matching the
-- tutor_course_roster / admin_directory precedent.
create function public.my_message_threads()
returns table(thread_id uuid,course_id uuid,course_name text,course_code text,other_id uuid,other_name text,last_message text,last_message_at timestamptz,unread_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 return query
 select t.id as thread_id,c.id as course_id,c.name as course_name,c.code as course_code,
  (case when t.tutor_id=auth.uid() then t.student_id else t.tutor_id end) as other_id,
  p.full_name as other_name,
  (select m.body from public.messages m where m.thread_id=t.id order by m.created_at desc limit 1) as last_message,
  (select m.created_at from public.messages m where m.thread_id=t.id order by m.created_at desc limit 1) as last_message_at,
  (select count(*) from public.messages m where m.thread_id=t.id and m.sender_id<>auth.uid() and m.read_at is null) as unread_count
 from public.message_threads t join public.courses c on c.id=t.course_id
  join public.profiles p on p.id=(case when t.tutor_id=auth.uid() then t.student_id else t.tutor_id end)
 where t.tutor_id=auth.uid() or t.student_id=auth.uid()
 order by last_message_at desc nulls last;
end; $$;

create function public.my_course_tutors()
returns table(course_id uuid,course_name text,course_code text,tutor_id uuid,tutor_name text)
language plpgsql security definer set search_path='' as $$
begin
 return query select c.id,c.name,c.code,ct.tutor_id,p.full_name
 from public.enrolments e join public.courses c on c.id=e.course_id
 join public.course_tutors ct on ct.course_id=c.id
 join public.profiles p on p.id=ct.tutor_id
 where e.student_id=auth.uid() and e.status<>'withdrawn' order by c.name,p.full_name;
end; $$;

revoke all on function public.post_announcement(uuid,text,text,text),public.delete_announcement(uuid,text),
 public.start_message_thread(uuid,uuid),public.send_message(uuid,text),public.mark_thread_read(uuid),
 public.my_message_threads(),public.my_course_tutors() from public,anon;
grant execute on function public.post_announcement(uuid,text,text,text),public.delete_announcement(uuid,text),
 public.start_message_thread(uuid,uuid),public.send_message(uuid,text),public.mark_thread_read(uuid),
 public.my_message_threads(),public.my_course_tutors() to authenticated;

-- Email notifications reuse the Step 1/2 outbox. Site-wide (course_id is
-- null) announcements are deliberately not emailed in this slice -- without
-- configurable notification preferences (a later slice) that would mean
-- every account gets an email every time, which is the wrong default.
create function private.queue_message_email()
returns trigger language plpgsql security definer set search_path='' as $$
declare t public.message_threads; recipient_id uuid; recipient_email text; sender_name text;
begin
 select * into t from public.message_threads where id=new.thread_id;
 recipient_id := case when new.sender_id=t.tutor_id then t.student_id else t.tutor_id end;
 select email into recipient_email from auth.users where id=recipient_id;
 select full_name into sender_name from public.profiles where id=new.sender_id;
 if recipient_email is not null then
  insert into public.notification_outbox(user_id,event_key,recipient,subject,body)
  values(recipient_id,'message/'||new.id::text,recipient_email,
   'New message on Summit ScholarsBridge',
   coalesce(sender_name,'Someone')||' sent you a message. Sign in to your account to read and reply.')
  on conflict(event_key) do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.queue_message_email() from public;
create trigger messages_queue_email after insert on public.messages for each row execute function private.queue_message_email();

create function private.queue_announcement_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.course_id is not null then
  insert into public.notification_outbox(user_id,event_key,recipient,subject,body)
  select e.student_id,'announcement/'||new.id::text||'/'||e.student_id::text,u.email,
   'New announcement: '||new.title,
   'A new announcement was posted for one of your courses. Sign in to your account to read it.'
  from public.enrolments e join auth.users u on u.id=e.student_id
  where e.course_id=new.course_id and e.status<>'withdrawn' and e.student_id<>new.author_id and u.email is not null
  on conflict(event_key) do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.queue_announcement_email() from public;
create trigger announcements_queue_email after insert on public.announcements for each row execute function private.queue_announcement_email();
commit;
