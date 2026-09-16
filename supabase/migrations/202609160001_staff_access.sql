begin;
create table public.staff_access_requests (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.profiles(id),
  target_email text not null,
  role public.portal_role not null check (role <> 'student'),
  operation text not null check (operation in ('grant','revoke')),
  reason text not null check (char_length(reason) between 5 and 2000),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index one_pending_staff_role on public.staff_access_requests(target_id,role) where status='pending';
alter table public.staff_access_requests enable row level security;
revoke all on public.staff_access_requests from anon,authenticated;
grant select on public.staff_access_requests to authenticated;
create policy staff_requests_read on public.staff_access_requests for select to authenticated
using (private.has_role('system_admin') or private.has_role('auditor'));
create trigger staff_requests_audit after insert or update on public.staff_access_requests
for each row execute function private.audit_change();

create function public.request_staff_access(p_email text,p_role public.portal_role,p_operation text,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; request_id uuid; canonical_email text;
begin
  if not private.has_role('system_admin') then raise exception 'Administrator access required.'; end if;
  if p_role is null or p_role='student' or p_operation is null or p_operation not in ('grant','revoke') then raise exception 'Choose a staff role and operation.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 2000 then raise exception 'Provide a reason between 5 and 2000 characters.'; end if;
  select u.id,u.email into target,canonical_email from auth.users u join public.profiles p on p.id=u.id
    where lower(u.email)=lower(btrim(p_email)) and u.email_confirmed_at is not null and p.account_status <> 'suspended';
  if target is null then raise exception 'A verified, nonsuspended account with this email is required.'; end if;
  if target=auth.uid() then raise exception 'You cannot request changes to your own access.'; end if;
  perform set_config('app.audit_reason',btrim(p_reason),true);
  insert into public.staff_access_requests(target_id,target_email,role,operation,reason,requested_by)
  values(target,canonical_email,p_role,p_operation,btrim(p_reason),auth.uid()) returning id into request_id;
  return request_id;
end; $$;

create function public.decide_staff_access(p_id uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare request public.staff_access_requests; target_status public.account_status;
begin
  -- Serialize role decisions, including removal of the last active super administrator.
  perform pg_advisory_xact_lock(16092026);
  if not private.has_role('super_admin') then raise exception 'Super Administrator access required.'; end if;
  if p_approve is null or p_reason is null or char_length(btrim(p_reason)) not between 5 and 2000 then raise exception 'Provide a decision and reason.'; end if;
  select * into request from public.staff_access_requests where id=p_id for update;
  if not found or request.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  if auth.uid() in (request.requested_by,request.target_id) then raise exception 'A separate Super Administrator must decide this request.'; end if;
  perform set_config('app.audit_reason',btrim(p_reason),true);
  if p_approve then
    select account_status into target_status from public.profiles where id=request.target_id for update;
    if target_status='suspended' then raise exception 'Suspended accounts cannot receive access changes.'; end if;
    if not exists(select 1 from auth.users where id=request.target_id and email_confirmed_at is not null and email=request.target_email) then raise exception 'The account email changed or is no longer verified. Reject this request and create a new one.'; end if;
    if request.operation='grant' then
      if exists(select 1 from public.user_roles where user_id=request.target_id and role=request.role) then raise exception 'This account already has the role. Reject the stale request.'; end if;
      insert into public.user_roles(user_id,role,assigned_by) values(request.target_id,request.role,auth.uid());
      update public.profiles set account_status='active' where id=request.target_id;
    else
      if request.role='super_admin' and not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='super_admin' and p.account_status='active' and r.user_id<>request.target_id) then raise exception 'The last active Super Administrator cannot be removed.'; end if;
      delete from public.user_roles where user_id=request.target_id and role=request.role;
      if not found then raise exception 'The account no longer has this role. Reject the stale request.'; end if;
    end if;
  end if;
  update public.staff_access_requests set status=case when p_approve then 'approved' else 'rejected' end,
    decided_by=auth.uid(),decision_reason=btrim(p_reason),decided_at=now() where id=p_id;
end; $$;
revoke all on function public.request_staff_access(text,public.portal_role,text,text),public.decide_staff_access(uuid,boolean,text) from public;
grant execute on function public.request_staff_access(text,public.portal_role,text,text),public.decide_staff_access(uuid,boolean,text) to authenticated;
commit;
