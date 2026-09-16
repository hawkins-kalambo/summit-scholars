begin;
-- Extend audit identities for join tables while retaining the original audit contract.
create or replace function private.audit_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb;
begin
 if TG_OP<>'INSERT' then old_row:=to_jsonb(old); end if;
 if TG_OP<>'DELETE' then new_row:=to_jsonb(new); end if;
 insert into public.audit_events(actor_id,action,table_name,record_id,previous_value,new_value,reason)
 values(auth.uid(),TG_OP,TG_TABLE_NAME,
 coalesce(new_row->>'id',old_row->>'id',new_row->>'user_id',old_row->>'user_id',new_row->>'application_id',old_row->>'application_id'),
 old_row,new_row,nullif(current_setting('app.audit_reason',true),''));
 if TG_OP='DELETE' then return old; end if;
 return new;
end; $$;
create trigger application_courses_audit after insert or update or delete on public.application_courses
 for each row execute function private.audit_change();
create trigger application_documents_audit after insert or update or delete on public.application_documents
 for each row execute function private.audit_change();

create function public.remove_application_document(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.application_documents;
begin
 select * into d from public.application_documents where id=p_id;
 if not found or not private.can_edit_application(d.application_id) then raise exception 'This document cannot be removed'; end if;
 if exists(select 1 from storage.objects where bucket_id='application-documents' and name=d.object_path)
 then raise exception 'Remove the uploaded file before clearing its record'; end if;
 delete from public.application_documents where id=p_id;
 update public.applications set revision=revision+1,updated_at=now() where id=d.application_id;
end; $$;
revoke all on function public.remove_application_document(uuid) from public,anon;
grant execute on function public.remove_application_document(uuid) to authenticated;

alter table public.notification_outbox add column lease_token uuid;
create function public.claim_notifications(p_limit integer default 5)
returns setof public.notification_outbox language plpgsql security definer set search_path='' as $$
begin
 -- Resend's idempotency window is finite. Ambiguous old attempts need review,
 -- not an automatic resend that could create a duplicate outside that window.
 update public.notification_outbox set status='needs_review',locked_until=null,lease_token=null
 where status in ('pending','processing') and (first_attempt_at < now()-interval '23 hours' or attempts>=8)
 and (locked_until is null or locked_until<now());
 return query
 with candidates as (
  select id from public.notification_outbox
  where ((status='pending' and next_attempt_at<=now()) or (status='processing' and locked_until<now()))
   and attempts<8 and (first_attempt_at is null or first_attempt_at>=now()-interval '23 hours')
  order by created_at for update skip locked limit least(greatest(p_limit,1),20)
 )
 update public.notification_outbox n set status='processing',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),locked_until=now()+interval '5 minutes',lease_token=gen_random_uuid()
 from candidates c where n.id=c.id returning n.*;
end; $$;
create function public.finish_notification(p_id uuid,p_lease uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.notification_outbox set
 status=case when p_provider_id is not null then 'sent' when attempts>=8 then 'needs_review' else 'pending' end,
 provider_id=p_provider_id,locked_until=null,lease_token=null,
 next_attempt_at=now()+interval '1 minute'*power(2,least(attempts,6))
 where id=p_id and lease_token=p_lease and status='processing';
 return found;
end; $$;
revoke all on function public.claim_notifications(integer),public.finish_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notifications(integer),public.finish_notification(uuid,uuid,text) to service_role;
commit;
