begin;
-- Security fix + product change: approval could reactivate a suspended
-- account and grant the tutor role in one step, with no suspension check.
-- Approval now only records the recommendation; a separate system_admin
-- step provisions the account (checking suspension there) and emails the
-- tutor to sign in. Submitting an application now also requires an
-- eligible (non-suspended) account, matching admissions' equivalent check.
alter table public.tutor_applications add column provisioned_at timestamptz;
alter table public.tutor_applications add column provisioned_by uuid references public.profiles(id);

create or replace function private.can_read_tutor_application(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tutor_applications a where a.id=p_id and
 (a.applicant_id=auth.uid() or private.has_role('academic_admin') or private.has_role('system_admin')));
$$;

create or replace function public.submit_tutor_application(p_full_name text,p_phone text,p_subjects text,p_qualifications text,p_availability text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and account_status in ('pending','active')) then
  raise exception 'An eligible account is required to apply';
 end if;
 if exists(select 1 from public.user_roles where user_id=auth.uid() and role='tutor') then raise exception 'Your account already holds the tutor role'; end if;
 if exists(select 1 from public.tutor_applications where applicant_id=auth.uid() and status<>'rejected') then raise exception 'You already have an application on file'; end if;
 if char_length(btrim(p_full_name)) not between 2 and 200 then raise exception 'Enter your full name'; end if;
 if p_phone !~ '^[+0-9 ()-]{7,25}$' then raise exception 'Enter a valid phone number'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects you can teach'; end if;
 if char_length(btrim(p_qualifications)) not between 10 and 4000 then raise exception 'Describe your qualifications in more detail'; end if;
 if char_length(btrim(p_availability)) not between 2 and 1000 then raise exception 'Describe your availability'; end if;
 insert into public.tutor_applications(applicant_id,full_name,phone,subjects,qualifications,availability)
 values(auth.uid(),btrim(p_full_name),btrim(p_phone),btrim(p_subjects),btrim(p_qualifications),btrim(p_availability))
 returning id into result_id;
 return result_id;
end; $$;

create or replace function public.decide_tutor_application(p_id uuid,p_revision integer,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.tutor_applications;
begin
 if not private.has_role('academic_admin') then raise exception 'Academic administration permission required'; end if;
 if p_decision not in ('approve','reject') or char_length(btrim(p_note)) not between 5 and 2000 then raise exception 'Provide a decision and reason'; end if;
 select * into a from public.tutor_applications where id=p_id for update;
 if not found or a.status<>'under_review' then raise exception 'This application is not ready for a decision'; end if;
 if a.revision is distinct from p_revision then raise exception 'This application changed. Reload before deciding'; end if;
 if a.reviewed_by=auth.uid() then raise exception 'A different academic administrator must decide this application'; end if;
 perform set_config('app.audit_reason',btrim(p_note),true);
 -- Approval only records the recommendation now; provision_tutor_account()
 -- grants the role and reactivates the account, with its own suspension check.
 update public.tutor_applications set status=case p_decision when 'approve' then 'approved'::public.tutor_application_status else 'rejected'::public.tutor_application_status end,
  decision_reason=btrim(p_note),decided_at=now(),revision=revision+1,updated_at=now() where id=p_id;
end; $$;

create function public.provision_tutor_account(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.tutor_applications; recipient_email text;
begin
 if not private.has_role('system_admin') then raise exception 'System Administrator permission required'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 5 and 2000 then raise exception 'Provide a reason'; end if;
 select * into a from public.tutor_applications where id=p_id for update;
 if not found or a.status<>'approved' then raise exception 'This application has not been approved'; end if;
 if a.provisioned_at is not null then raise exception 'This tutor account has already been provisioned'; end if;
 if exists(select 1 from public.profiles where id=a.applicant_id and account_status='suspended') then
  raise exception 'This applicant''s account is suspended and cannot be provisioned';
 end if;
 perform set_config('app.audit_reason',btrim(p_reason),true);
 insert into public.user_roles(user_id,role) values(a.applicant_id,'tutor') on conflict do nothing;
 update public.profiles set account_status='active' where id=a.applicant_id and account_status<>'active';
 update public.tutor_applications set provisioned_at=now(),provisioned_by=auth.uid() where id=p_id;
 select email into recipient_email from auth.users where id=a.applicant_id;
 if recipient_email is not null then
  insert into public.notification_outbox(user_id,event_key,recipient,subject,body)
  values(a.applicant_id,'tutor-application/'||p_id::text||'/provisioned',recipient_email,
   'Your Summit ScholarsBridge tutor account is active',
   'Your tutor application has been approved and your account is now active. Sign in with the email and password you registered with to reach your tutor workspace.')
  on conflict(event_key) do nothing;
 end if;
end; $$;
revoke all on function public.provision_tutor_account(uuid,text) from public,anon;
grant execute on function public.provision_tutor_account(uuid,text) to authenticated;
commit;
