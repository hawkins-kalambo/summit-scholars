begin;
-- On-demand attendance-risk report (de-scoped from the plan's "at-risk
-- alerts", which needs a scheduled cron push we don't have set up yet).
-- Computed live when academic_admin opens the report, not pushed.
-- profiles is restricted to system_admin/self, so this needs a controlled
-- lookup (matching admin_directory / tutor_course_roster) rather than a
-- direct join against profiles.
create function public.attendance_risk_report(p_threshold numeric default 75)
returns table(student_id uuid,full_name text,course_id uuid,course_name text,attended_count bigint,total_count bigint,attendance_rate numeric)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 return query
 select sa.student_id,p.full_name,cs.course_id,c.name,
  count(*) filter (where sa.status in ('present','late')),
  count(*),
  round(100.0*count(*) filter (where sa.status in ('present','late'))/count(*),1)
 from public.session_attendance sa
 join public.class_sessions cs on cs.id=sa.session_id
 join public.courses c on c.id=cs.course_id
 join public.profiles p on p.id=sa.student_id
 group by sa.student_id,p.full_name,cs.course_id,c.name
 having round(100.0*count(*) filter (where sa.status in ('present','late'))/count(*),1) < coalesce(p_threshold,75)
 order by 7 asc,p.full_name;
end; $$;
revoke all on function public.attendance_risk_report(numeric) from public,anon;
grant execute on function public.attendance_risk_report(numeric) to authenticated;
commit;
