begin;
-- Security fix: refunds had no cap across repeated requests, letting an
-- invoice be refunded more than once past its total. Locks before checking,
-- blocks refunding a cancelled invoice, and allows only one pending refund
-- request per invoice at a time.
create or replace function public.request_refund(p_invoice_id uuid,p_amount numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; invoice_row public.invoices;
begin
 if not private.has_role('finance_officer') then raise exception 'Finance permission required'; end if;
 if p_amount is null or p_amount <= 0 then raise exception 'Enter a refund amount greater than zero'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason for this refund'; end if;
 select * into invoice_row from public.invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if invoice_row.status='cancelled' then raise exception 'A cancelled invoice cannot be refunded'; end if;
 if p_amount > invoice_row.total_amount - invoice_row.refunded_amount then raise exception 'Refund cannot exceed the invoice''s remaining refundable amount'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.refund_requests(invoice_id,amount,reason,requested_by)
 values(p_invoice_id,p_amount,btrim(p_reason),auth.uid()) returning id into result_id;
 return result_id;
end; $$;

create or replace function public.decide_refund(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare request public.refund_requests; invoice_row public.invoices; new_refunded numeric;
begin
 if not private.has_role('super_admin') then raise exception 'Super Administrator permission required'; end if;
 if p_approve is null or coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into request from public.refund_requests where id=p_id for update;
 if not found or request.status<>'pending' then raise exception 'This request is no longer pending'; end if;
 if request.requested_by=auth.uid() then raise exception 'A different Super Administrator must decide this request'; end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 if p_approve then
  select * into invoice_row from public.invoices where id=request.invoice_id for update;
  if invoice_row.status='cancelled' then raise exception 'A cancelled invoice cannot be refunded'; end if;
  new_refunded := invoice_row.refunded_amount + request.amount;
  if new_refunded > invoice_row.total_amount then raise exception 'This refund would exceed the invoice total'; end if;
  update public.invoices set refunded_amount=new_refunded,
   balance_amount=greatest(balance_amount-request.amount,0),status='refunded',updated_at=now() where id=request.invoice_id;
 end if;
 update public.refund_requests set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;
create unique index one_pending_refund_per_invoice on public.refund_requests(invoice_id) where status='pending';
commit;
