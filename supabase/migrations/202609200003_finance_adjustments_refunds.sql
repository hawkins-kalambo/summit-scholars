begin;
-- Approval matrix: payment adjustment (finance_officer prepares, finance_administrator
-- approves) and refund (finance_officer prepares, super_admin approves). Mirrors the
-- staff_access_requests prepare/decide pattern, including separation of duties.
alter table public.invoices add column refunded_amount numeric(12,2) not null default 0 check(refunded_amount >= 0);

create table public.payment_adjustment_requests (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id),
 adjustment_amount numeric(12,2) not null check(adjustment_amount <> 0),
 reason text not null check(char_length(reason) between 5 and 2000),
 requested_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references public.profiles(id),
 decision_reason text,
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
create table public.refund_requests (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id),
 amount numeric(12,2) not null check(amount > 0),
 reason text not null check(char_length(reason) between 5 and 2000),
 requested_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references public.profiles(id),
 decision_reason text,
 created_at timestamptz not null default now(),
 decided_at timestamptz
);

alter table public.payment_adjustment_requests enable row level security;
alter table public.refund_requests enable row level security;
revoke all on public.payment_adjustment_requests,public.refund_requests from anon,authenticated;
grant select on public.payment_adjustment_requests,public.refund_requests to authenticated;
create policy payment_adjustment_requests_read on public.payment_adjustment_requests for select to authenticated using(
 private.has_role('finance_officer') or private.has_role('finance_administrator')
);
create policy refund_requests_read on public.refund_requests for select to authenticated using(
 private.has_role('finance_officer') or private.has_role('super_admin')
);

create trigger payment_adjustment_requests_audit after insert or update on public.payment_adjustment_requests for each row execute function private.audit_change();
create trigger refund_requests_audit after insert or update on public.refund_requests for each row execute function private.audit_change();

create function public.request_payment_adjustment(p_invoice_id uuid,p_adjustment_amount numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not private.has_role('finance_officer') then raise exception 'Finance permission required'; end if;
 if p_adjustment_amount is null or p_adjustment_amount = 0 then raise exception 'Enter a non-zero adjustment amount'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this adjustment'; end if;
 if not exists(select 1 from public.invoices where id=p_invoice_id) then raise exception 'Invoice not found'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.payment_adjustment_requests(invoice_id,adjustment_amount,reason,requested_by)
 values(p_invoice_id,p_adjustment_amount,btrim(p_reason),auth.uid()) returning id into result_id;
 return result_id;
end; $$;

create function public.decide_payment_adjustment(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare request public.payment_adjustment_requests; invoice_row public.invoices; new_total numeric; new_balance numeric; new_status public.payment_status;
begin
 if not private.has_role('finance_administrator') then raise exception 'Finance Administrator permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into request from public.payment_adjustment_requests where id=p_id for update;
 if not found or request.status<>'pending' then raise exception 'This request is no longer pending'; end if;
 if request.requested_by=auth.uid() then raise exception 'A different Finance Administrator must decide this request'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_approve then
  select * into invoice_row from public.invoices where id=request.invoice_id for update;
  new_total := invoice_row.total_amount + request.adjustment_amount;
  new_balance := invoice_row.balance_amount + request.adjustment_amount;
  if new_total < 0 or new_balance < 0 then raise exception 'This adjustment would produce a negative amount'; end if;
  new_status := case when new_balance=0 then 'paid'::public.payment_status when new_balance=new_total then 'invoice_created'::public.payment_status else 'partially_paid'::public.payment_status end;
  update public.invoices set total_amount=new_total,balance_amount=new_balance,status=new_status,updated_at=now() where id=request.invoice_id;
 end if;
 update public.payment_adjustment_requests set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;

create function public.request_refund(p_invoice_id uuid,p_amount numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; invoice_row public.invoices;
begin
 if not private.has_role('finance_officer') then raise exception 'Finance permission required'; end if;
 if p_amount is null or p_amount <= 0 then raise exception 'Enter a refund amount greater than zero'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this refund'; end if;
 select * into invoice_row from public.invoices where id=p_invoice_id;
 if not found then raise exception 'Invoice not found'; end if;
 if p_amount > invoice_row.total_amount then raise exception 'Refund cannot exceed the invoice total'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.refund_requests(invoice_id,amount,reason,requested_by)
 values(p_invoice_id,p_amount,btrim(p_reason),auth.uid()) returning id into result_id;
 return result_id;
end; $$;

create function public.decide_refund(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare request public.refund_requests;
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into request from public.refund_requests where id=p_id for update;
 if not found or request.status<>'pending' then raise exception 'This request is no longer pending'; end if;
 if request.requested_by=auth.uid() then raise exception 'A different Super Administrator must decide this request'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_approve then
  update public.invoices set refunded_amount=refunded_amount+request.amount,
   balance_amount=greatest(balance_amount-request.amount,0),status='refunded',updated_at=now() where id=request.invoice_id;
 end if;
 update public.refund_requests set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;

revoke all on function public.request_payment_adjustment(uuid,numeric,text),public.decide_payment_adjustment(uuid,boolean,text),
 public.request_refund(uuid,numeric,text),public.decide_refund(uuid,boolean,text) from public,anon;
grant execute on function public.request_payment_adjustment(uuid,numeric,text),public.decide_payment_adjustment(uuid,boolean,text),
 public.request_refund(uuid,numeric,text),public.decide_refund(uuid,boolean,text) to authenticated;
commit;
