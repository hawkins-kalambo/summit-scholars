begin;
-- Tutor payroll (Phase 8): a flat rate per completed, tutor-confirmed class
-- session. finance_administrator sets each tutor's rate directly (a
-- configuration value, like fee amounts); finance_officer prepares a payroll
-- run for a period, finance_administrator approves it -- mirrors the
-- payment_adjustment_requests prepare-then-decide pattern, including
-- separation of duties. Approval only authorizes the disbursement; the actual
-- mobile money/bank transfer stays a manual step for now, same as invoice
-- payments before PayChangu is wired in.

create table public.tutor_rates (
 id uuid primary key default gen_random_uuid(),
 tutor_id uuid not null references public.profiles(id),
 rate_amount numeric(10,2) not null check(rate_amount > 0),
 effective_from timestamptz not null default now(),
 set_by uuid not null references public.profiles(id),
 reason text not null check(char_length(reason) between 5 and 2000),
 created_at timestamptz not null default now()
);
create index tutor_rates_tutor_id on public.tutor_rates(tutor_id,effective_from desc);

create table public.payroll_runs (
 id uuid primary key default gen_random_uuid(),
 tutor_id uuid not null references public.profiles(id),
 period_start date not null,
 period_end date not null check(period_end >= period_start),
 session_count integer not null check(session_count > 0),
 rate_amount numeric(10,2) not null check(rate_amount > 0),
 total_amount numeric(12,2) not null check(total_amount > 0),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_by uuid not null references public.profiles(id),
 reason text not null check(char_length(reason) between 5 and 2000),
 decided_by uuid references public.profiles(id),
 decision_reason text,
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
create index payroll_runs_tutor_id on public.payroll_runs(tutor_id);

create table public.payroll_run_sessions (
 payroll_run_id uuid not null references public.payroll_runs(id),
 session_id uuid not null references public.class_sessions(id),
 primary key(payroll_run_id,session_id)
);

alter table public.tutor_rates enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_run_sessions enable row level security;
revoke all on public.tutor_rates,public.payroll_runs,public.payroll_run_sessions from anon,authenticated;
grant select on public.tutor_rates,public.payroll_runs,public.payroll_run_sessions to authenticated;

create policy tutor_rates_read on public.tutor_rates for select to authenticated using(
 tutor_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')
);
create policy payroll_runs_read on public.payroll_runs for select to authenticated using(
 tutor_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')
);
create policy payroll_run_sessions_read on public.payroll_run_sessions for select to authenticated using(
 exists(select 1 from public.payroll_runs pr where pr.id=payroll_run_sessions.payroll_run_id
  and (pr.tutor_id=(select auth.uid()) or private.has_role('finance_officer') or private.has_role('finance_administrator')))
);

create trigger tutor_rates_audit after insert or update on public.tutor_rates for each row execute function private.audit_change();
create trigger payroll_runs_audit after insert or update on public.payroll_runs for each row execute function private.audit_change();

create function public.set_tutor_rate(p_tutor_id uuid,p_rate_amount numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not private.has_role('finance_administrator') then raise exception 'Finance Administrator permission required'; end if;
 if p_rate_amount is null or p_rate_amount <= 0 then raise exception 'Enter a pay rate greater than zero'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this rate'; end if;
 if not exists(select 1 from public.user_roles where user_id=p_tutor_id and role='tutor') then raise exception 'That account is not a tutor'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.tutor_rates(tutor_id,rate_amount,set_by,reason) values(p_tutor_id,p_rate_amount,auth.uid(),btrim(p_reason)) returning id into result_id;
 return result_id;
end; $$;

create function public.finance_tutors()
returns table(tutor_id uuid,full_name text,rate_amount numeric)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('finance_officer') and not private.has_role('finance_administrator') then raise exception 'Finance permission required'; end if;
 return query
 select p.id,p.full_name,
  (select tr.rate_amount from public.tutor_rates tr where tr.tutor_id=p.id and tr.effective_from<=now() order by tr.effective_from desc limit 1)
 from public.profiles p join public.user_roles ur on ur.user_id=p.id and ur.role='tutor'
 order by p.full_name;
end; $$;

create function public.payroll_candidates()
returns table(tutor_id uuid,full_name text,rate_amount numeric,eligible_sessions integer)
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('finance_officer') and not private.has_role('finance_administrator') then raise exception 'Finance permission required'; end if;
 return query
 select cs.tutor_id,p.full_name,
  (select tr.rate_amount from public.tutor_rates tr where tr.tutor_id=cs.tutor_id and tr.effective_from<=now() order by tr.effective_from desc limit 1),
  count(*)::int
 from public.class_sessions cs join public.profiles p on p.id=cs.tutor_id
 where cs.status='completed'
  and not exists(select 1 from public.payroll_run_sessions prs join public.payroll_runs pr on pr.id=prs.payroll_run_id where prs.session_id=cs.id and pr.status<>'rejected')
 group by cs.tutor_id,p.full_name;
end; $$;

create function public.prepare_payroll_run(p_tutor_id uuid,p_period_start date,p_period_end date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare current_rate numeric; eligible_ids uuid[]; eligible_count integer; result_id uuid;
begin
 if not private.has_role('finance_officer') then raise exception 'Finance permission required'; end if;
 if p_period_end < p_period_start then raise exception 'The period end must be on or after the start'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this payroll run'; end if;
 select rate_amount into current_rate from public.tutor_rates where tutor_id=p_tutor_id and effective_from<=now() order by effective_from desc limit 1;
 if current_rate is null then raise exception 'No pay rate has been set for this tutor'; end if;
 select array_agg(cs.id) into eligible_ids from public.class_sessions cs
  where cs.tutor_id=p_tutor_id and cs.status='completed'
  and cs.actual_starts_at::date between p_period_start and p_period_end
  and not exists(select 1 from public.payroll_run_sessions prs join public.payroll_runs pr on pr.id=prs.payroll_run_id where prs.session_id=cs.id and pr.status<>'rejected');
 eligible_count := coalesce(array_length(eligible_ids,1),0);
 if eligible_count = 0 then raise exception 'No payable classes for this tutor in that period'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.payroll_runs(tutor_id,period_start,period_end,session_count,rate_amount,total_amount,requested_by,reason)
 values(p_tutor_id,p_period_start,p_period_end,eligible_count,current_rate,current_rate*eligible_count,auth.uid(),btrim(p_reason))
 returning id into result_id;
 insert into public.payroll_run_sessions(payroll_run_id,session_id) select result_id,unnest(eligible_ids);
 return result_id;
end; $$;

create function public.decide_payroll_run(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare run public.payroll_runs;
begin
 if not private.has_role('finance_administrator') then raise exception 'Finance Administrator permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into run from public.payroll_runs where id=p_id for update;
 if not found or run.status<>'pending' then raise exception 'This payroll run is no longer pending'; end if;
 if run.requested_by=auth.uid() then raise exception 'A different Finance Administrator must decide this payroll run'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 update public.payroll_runs set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;

revoke all on function public.set_tutor_rate(uuid,numeric,text),public.finance_tutors(),public.payroll_candidates(),
 public.prepare_payroll_run(uuid,date,date,text),public.decide_payroll_run(uuid,boolean,text) from public,anon;
grant execute on function public.set_tutor_rate(uuid,numeric,text),public.finance_tutors(),public.payroll_candidates(),
 public.prepare_payroll_run(uuid,date,date,text),public.decide_payroll_run(uuid,boolean,text) to authenticated;
commit;
