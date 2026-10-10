begin;
-- Phase 5.1 (assignments): tutor sets an assignment for their course,
-- students submit a file, the tutor grades it (a draft score), and an
-- academic_admin must approve the grade before the student can see it --
-- "tutor draft -> academic review -> student-visible result" per the plan.
-- Late submissions are never blocked, only flagged; the tutor decides what
-- to do about lateness when grading. Quizzes are deferred to a later phase.
create table public.assignments (
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id),
 created_by uuid not null references public.profiles(id),
 title text not null check(char_length(title) between 2 and 200),
 description text not null check(char_length(description) between 10 and 4000),
 max_score numeric(6,2) not null check(max_score > 0),
 due_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index assignments_course_id on public.assignments(course_id);

create table public.assignment_submissions (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.assignments(id),
 student_id uuid not null references public.profiles(id),
 object_path text not null unique,
 file_name text not null check(char_length(file_name) between 1 and 200),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 submitted_at timestamptz not null default now(),
 is_late boolean not null default false,
 score numeric(6,2),
 score_status text not null default 'pending' check(score_status in ('pending','graded','approved')),
 grading_note text,
 review_note text,
 graded_by uuid references public.profiles(id),
 graded_at timestamptz,
 approved_by uuid references public.profiles(id),
 approved_at timestamptz,
 unique(assignment_id,student_id)
);
create index assignment_submissions_assignment_id on public.assignment_submissions(assignment_id);
create index assignment_submissions_student_id on public.assignment_submissions(student_id);

alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
revoke all on public.assignments,public.assignment_submissions from anon,authenticated;
grant select on public.assignments to authenticated;
-- Students read their own submission only through my_assignment_submission()
-- below, which hides the grade until it's approved; only tutors/academic_admin
-- get a direct table grant, since they're allowed to see everything.
grant select on public.assignment_submissions to authenticated;

create policy assignments_read on public.assignments for select to authenticated using(
 private.has_role('academic_admin')
 or exists(select 1 from public.course_tutors ct where ct.course_id=assignments.course_id and ct.tutor_id=(select auth.uid()))
 or exists(select 1 from public.enrolments e where e.course_id=assignments.course_id and e.student_id=(select auth.uid()) and e.status<>'withdrawn')
);
create policy assignment_submissions_read on public.assignment_submissions for select to authenticated using(
 private.has_role('academic_admin')
 or exists(select 1 from public.assignments a join public.course_tutors ct on ct.course_id=a.course_id
  where a.id=assignment_submissions.assignment_id and ct.tutor_id=(select auth.uid()))
);

create trigger assignments_audit after insert or update or delete on public.assignments for each row execute function private.audit_change();
create trigger assignment_submissions_audit after insert or update or delete on public.assignment_submissions for each row execute function private.audit_change();

-- The foundation migration already provisioned this bucket as a forward-looking
-- placeholder (20 MB, no mime restriction), before this feature's exact shape
-- was decided. Tighten it to match the app-layer validation (10 MB, PDF/JPEG/PNG
-- only) instead of inserting a duplicate row.
update storage.buckets set file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/jpeg','image/png']
 where id='assignment-submissions';
create policy assignment_submission_upload on storage.objects for insert to authenticated with check(
 bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.assignments a join public.enrolments e on e.course_id=a.course_id
  where a.id::text=(storage.foldername(name))[2] and e.student_id=(select auth.uid()) and e.status<>'withdrawn')
);
create policy assignment_submission_read on storage.objects for select to authenticated using(
 bucket_id='assignment-submissions' and (
  exists(select 1 from public.assignment_submissions s where s.object_path=name and s.student_id=(select auth.uid()))
  or exists(select 1 from public.assignment_submissions s join public.assignments a on a.id=s.assignment_id
   join public.course_tutors ct on ct.course_id=a.course_id where s.object_path=name and ct.tutor_id=(select auth.uid()))
  or private.has_role('academic_admin')
 )
);

create function public.create_assignment(p_course_id uuid,p_title text,p_description text,p_max_score numeric,p_due_at timestamptz,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not exists(select 1 from public.course_tutors where course_id=p_course_id and tutor_id=auth.uid()) then raise exception 'You are not assigned to this course'; end if;
 if char_length(btrim(p_title)) not between 2 and 200 then raise exception 'Enter a title'; end if;
 if char_length(btrim(p_description)) not between 10 and 4000 then raise exception 'Describe the assignment in more detail'; end if;
 if p_max_score is null or p_max_score <= 0 then raise exception 'Enter a maximum score greater than zero'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.assignments(course_id,created_by,title,description,max_score,due_at)
 values(p_course_id,auth.uid(),btrim(p_title),btrim(p_description),p_max_score,p_due_at)
 returning id into result_id;
 return result_id;
end; $$;

create function public.update_assignment(p_id uuid,p_title text,p_description text,p_max_score numeric,p_due_at timestamptz,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.assignments where id=p_id and created_by=auth.uid()) then raise exception 'You did not create this assignment'; end if;
 if char_length(btrim(p_title)) not between 2 and 200 then raise exception 'Enter a title'; end if;
 if char_length(btrim(p_description)) not between 10 and 4000 then raise exception 'Describe the assignment in more detail'; end if;
 if p_max_score is null or p_max_score <= 0 then raise exception 'Enter a maximum score greater than zero'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.assignments set title=btrim(p_title),description=btrim(p_description),max_score=p_max_score,due_at=p_due_at,updated_at=now() where id=p_id;
end; $$;

create function public.submit_assignment(p_assignment_id uuid,p_path text,p_name text,p_type text,p_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.assignments; existing public.assignment_submissions; result_id uuid; late boolean;
begin
 select * into a from public.assignments where id=p_assignment_id;
 if not found then raise exception 'Assignment not found'; end if;
 if not exists(select 1 from public.enrolments where course_id=a.course_id and student_id=auth.uid() and status<>'withdrawn') then
  raise exception 'You are not enrolled in this course';
 end if;
 if p_path not like auth.uid()::text || '/' || p_assignment_id::text || '/%'
 or not exists(select 1 from storage.objects where bucket_id='assignment-submissions' and name=p_path)
 then raise exception 'Upload the file first'; end if;
 late := now() > a.due_at;
 select * into existing from public.assignment_submissions where assignment_id=p_assignment_id and student_id=auth.uid() for update;
 if found then
  if existing.score_status <> 'pending' then raise exception 'This submission has already been graded and can no longer be replaced'; end if;
  update public.assignment_submissions set object_path=p_path,file_name=p_name,mime_type=p_type,size_bytes=p_size,
   submitted_at=now(),is_late=late where id=existing.id returning id into result_id;
 else
  insert into public.assignment_submissions(assignment_id,student_id,object_path,file_name,mime_type,size_bytes,is_late)
  values(p_assignment_id,auth.uid(),p_path,p_name,p_type,p_size,late) returning id into result_id;
 end if;
 return result_id;
end; $$;

create function public.grade_assignment_submission(p_submission_id uuid,p_score numeric,p_note text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.assignment_submissions; a public.assignments;
begin
 select * into s from public.assignment_submissions where id=p_submission_id for update;
 if not found then raise exception 'Submission not found'; end if;
 select * into a from public.assignments where id=s.assignment_id;
 if not exists(select 1 from public.course_tutors where course_id=a.course_id and tutor_id=auth.uid()) then raise exception 'You are not assigned to this course'; end if;
 if p_score is null or p_score < 0 or p_score > a.max_score then raise exception 'Enter a score between 0 and the assignment maximum'; end if;
 if coalesce(char_length(btrim(p_note)),0) not between 5 and 2000 then raise exception 'Provide feedback for the student'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.assignment_submissions set score=p_score,score_status='graded',grading_note=btrim(p_note),review_note=null,
  graded_by=auth.uid(),graded_at=now(),approved_by=null,approved_at=null where id=p_submission_id;
end; $$;

create function public.approve_assignment_grade(p_submission_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.assignment_submissions;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into s from public.assignment_submissions where id=p_submission_id for update;
 if not found or s.score_status<>'graded' then raise exception 'This submission is not awaiting approval'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_approve then
  update public.assignment_submissions set score_status='approved',approved_by=auth.uid(),approved_at=now() where id=p_submission_id;
 else
  update public.assignment_submissions set score_status='pending',review_note=btrim(p_reason),approved_by=null,approved_at=null where id=p_submission_id;
 end if;
end; $$;

-- The only read path for a student: hides the score/feedback until the
-- academic_admin has approved it, even though they can see their own
-- submission (file, timestamp, lateness) immediately.
create function public.my_assignment_submission(p_assignment_id uuid)
returns table(id uuid,file_name text,submitted_at timestamptz,is_late boolean,score numeric,score_status text,grading_note text,review_note text)
language sql stable security definer set search_path='' as $$
 select s.id,s.file_name,s.submitted_at,s.is_late,
  case when s.score_status='approved' then s.score else null end,
  s.score_status,
  case when s.score_status='approved' then s.grading_note else null end,
  s.review_note
 from public.assignment_submissions s where s.assignment_id=p_assignment_id and s.student_id=auth.uid();
$$;

-- profiles has no RLS policy letting a tutor or academic_admin read an
-- arbitrary student's full_name directly, matching tutor_course_roster's
-- existing pattern for the same problem; these two give each reviewer the
-- names they need without a broader profile-reading privilege.
create function public.tutor_assignment_submissions(p_assignment_id uuid)
returns table(id uuid,student_id uuid,full_name text,file_name text,object_path text,submitted_at timestamptz,is_late boolean,score numeric,score_status text,grading_note text,review_note text)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.assignments a join public.course_tutors ct on ct.course_id=a.course_id
  where a.id=p_assignment_id and ct.tutor_id=auth.uid()) and not private.has_role('academic_admin') then
  raise exception 'You are not assigned to this course';
 end if;
 return query select s.id,s.student_id,p.full_name,s.file_name,s.object_path,s.submitted_at,s.is_late,s.score,s.score_status,s.grading_note,s.review_note
 from public.assignment_submissions s join public.profiles p on p.id=s.student_id
 where s.assignment_id=p_assignment_id order by s.submitted_at;
end; $$;

create function public.assignment_grades_pending_approval()
returns table(submission_id uuid,student_name text,assignment_title text,course_name text,score numeric,max_score numeric,grading_note text,is_late boolean,graded_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 return query select s.id,p.full_name,a.title,c.name,s.score,a.max_score,s.grading_note,s.is_late,s.graded_at
 from public.assignment_submissions s join public.assignments a on a.id=s.assignment_id
 join public.courses c on c.id=a.course_id join public.profiles p on p.id=s.student_id
 where s.score_status='graded' order by s.graded_at;
end; $$;

revoke all on function public.create_assignment(uuid,text,text,numeric,timestamptz,text),public.update_assignment(uuid,text,text,numeric,timestamptz,text),
 public.submit_assignment(uuid,text,text,text,bigint),public.grade_assignment_submission(uuid,numeric,text,text),
 public.approve_assignment_grade(uuid,boolean,text),public.my_assignment_submission(uuid),
 public.tutor_assignment_submissions(uuid),public.assignment_grades_pending_approval() from public,anon;
grant execute on function public.create_assignment(uuid,text,text,numeric,timestamptz,text),public.update_assignment(uuid,text,text,numeric,timestamptz,text),
 public.submit_assignment(uuid,text,text,text,bigint),public.grade_assignment_submission(uuid,numeric,text,text),
 public.approve_assignment_grade(uuid,boolean,text),public.my_assignment_submission(uuid),
 public.tutor_assignment_submissions(uuid),public.assignment_grades_pending_approval() to authenticated;
commit;
