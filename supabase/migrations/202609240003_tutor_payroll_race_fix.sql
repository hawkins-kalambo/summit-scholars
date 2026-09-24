begin;
-- Security fix: prepare_payroll_run's eligibility check was check-then-insert
-- with no lock and no unique constraint, so two concurrent runs could both
-- claim the same completed session and double-pay a tutor for it. Rejecting
-- a run now frees its sessions by deleting their link rows, so a plain
-- unique constraint on session_id is enough: a concurrent second run's
-- insert simply fails instead of silently succeeding.
delete from public.payroll_run_sessions prs using public.payroll_runs pr
 where pr.id=prs.payroll_run_id and pr.status='rejected';
create unique index payroll_run_sessions_session_unique on public.payroll_run_sessions(session_id);

create or replace function public.prepare_payroll_run(p_tutor_id uuid,p_period_start date,p_period_end date,p_reason text)
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
  and not exists(select 1 from public.payroll_run_sessions prs where prs.session_id=cs.id);
 eligible_count := coalesce(array_length(eligible_ids,1),0);
 if eligible_count = 0 then raise exception 'No payable classes for this tutor in that period'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.payroll_runs(tutor_id,period_start,period_end,session_count,rate_amount,total_amount,requested_by,reason)
 values(p_tutor_id,p_period_start,p_period_end,eligible_count,current_rate,current_rate*eligible_count,auth.uid(),btrim(p_reason))
 returning id into result_id;
 -- If a concurrent run claimed one of these sessions first, this unique
 -- violation aborts the whole run rather than silently double-paying it.
 insert into public.payroll_run_sessions(payroll_run_id,session_id) select result_id,unnest(eligible_ids);
 return result_id;
end; $$;

create or replace function public.decide_payroll_run(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare run public.payroll_runs;
begin
 if not private.has_role('finance_administrator') then raise exception 'Finance Administrator permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into run from public.payroll_runs where id=p_id for update;
 if not found or run.status<>'pending' then raise exception 'This payroll run is no longer pending'; end if;
 if run.requested_by=auth.uid() then raise exception 'A different Finance Administrator must decide this payroll run'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if not p_approve then delete from public.payroll_run_sessions where payroll_run_id=p_id; end if;
 update public.payroll_runs set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;

-- payroll_run_sessions has a composite key, so it needs its own audit
-- trigger (private.audit_change() keys off an `id`/`user_id` column).
create function private.audit_payroll_run_sessions()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb;
begin
 if TG_OP <> 'INSERT' then old_row := to_jsonb(old); end if;
 if TG_OP <> 'DELETE' then new_row := to_jsonb(new); end if;
 insert into public.audit_events(actor_id, action, table_name, record_id, previous_value, new_value, reason)
 values (auth.uid(), TG_OP, TG_TABLE_NAME,
  coalesce(new_row->>'payroll_run_id', old_row->>'payroll_run_id') || ':' || coalesce(new_row->>'session_id', old_row->>'session_id'),
  old_row, new_row, nullif(current_setting('app.audit_reason', true), ''));
 if TG_OP = 'DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.audit_payroll_run_sessions() from public;
create trigger payroll_run_sessions_audit after insert or update or delete on public.payroll_run_sessions
for each row execute function private.audit_payroll_run_sessions();
commit;
