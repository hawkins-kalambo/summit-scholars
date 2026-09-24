begin;
-- Security fix: a tutor's public profile stayed visible on the anonymous
-- directory after they lost the tutor role or were suspended, since
-- visibility only ever depended on the tutor's own `visible` toggle. Also
-- adds the teaching-mode fields (online/in person) requested for the
-- public directory and the tutor's own dashboard.
alter table public.tutor_profiles add column teaches_online boolean not null default true;
alter table public.tutor_profiles add column teaches_in_person boolean not null default false;

-- anon has no table-level grant on profiles/user_roles, so an RLS policy
-- cannot join them inline (that throws "permission denied", not a silent
-- filter) -- this needs a security definer helper, like every other
-- cross-table policy check in this schema. anon also has no schema-level
-- usage grant on `private` yet (only `authenticated` does), so extend that
-- too; execute is still granted function-by-function, so this alone exposes
-- nothing new.
grant usage on schema private to anon;
create function private.tutor_account_active(p_tutor_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id and ur.role='tutor'
  where p.id=p_tutor_id and p.account_status='active');
$$;
revoke all on function private.tutor_account_active(uuid) from public;
grant execute on function private.tutor_account_active(uuid) to anon,authenticated;

drop policy tutor_profiles_read on public.tutor_profiles;
create policy tutor_profiles_read on public.tutor_profiles for select to anon,authenticated using(
 (visible=true and private.tutor_account_active(tutor_id)) or tutor_id=(select auth.uid())
);

drop function if exists public.save_tutor_profile(text,text,text,text,boolean);
create function public.save_tutor_profile(p_display_name text,p_headline text,p_bio text,p_subjects text,p_visible boolean,p_teaches_online boolean default true,p_teaches_in_person boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 if char_length(btrim(p_display_name)) not between 2 and 200 then raise exception 'Enter a display name'; end if;
 if char_length(btrim(p_headline)) not between 2 and 200 then raise exception 'Enter a short headline'; end if;
 if char_length(btrim(p_bio)) not between 10 and 2000 then raise exception 'Write a longer bio'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects you teach'; end if;
 if not coalesce(p_teaches_online,false) and not coalesce(p_teaches_in_person,false) then raise exception 'Choose at least one teaching mode'; end if;
 insert into public.tutor_profiles(tutor_id,display_name,headline,bio,subjects,visible,teaches_online,teaches_in_person,updated_at)
 values(auth.uid(),btrim(p_display_name),btrim(p_headline),btrim(p_bio),btrim(p_subjects),coalesce(p_visible,true),p_teaches_online,p_teaches_in_person,now())
 on conflict(tutor_id) do update set display_name=excluded.display_name,headline=excluded.headline,
  bio=excluded.bio,subjects=excluded.subjects,visible=excluded.visible,
  teaches_online=excluded.teaches_online,teaches_in_person=excluded.teaches_in_person,updated_at=now();
end; $$;
revoke all on function public.save_tutor_profile(text,text,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.save_tutor_profile(text,text,text,text,boolean,boolean,boolean) to authenticated;
commit;
