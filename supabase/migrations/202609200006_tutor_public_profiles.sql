begin;
-- Public tutor directory: the "public fields" half of the profile split
-- deferred in Phase 4 (there was nowhere to display a bio then). Kept
-- separate from tutor_applications, which stays staff-only — a tutor
-- opts in and controls exactly what's shown, rather than their raw
-- application text being exposed. display_name is denormalized here
-- (tutor-supplied) because profiles.full_name is not publicly readable.
create table public.tutor_profiles (
 id uuid primary key default gen_random_uuid(),
 tutor_id uuid not null unique references public.profiles(id),
 display_name text not null check(char_length(display_name) between 2 and 200),
 headline text not null check(char_length(headline) between 2 and 200),
 bio text not null check(char_length(bio) between 10 and 2000),
 subjects text not null check(char_length(subjects) between 2 and 500),
 visible boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.tutor_profiles enable row level security;
revoke all on public.tutor_profiles from anon,authenticated;
grant select on public.tutor_profiles to anon,authenticated;
create policy tutor_profiles_read on public.tutor_profiles for select to anon,authenticated using(
 visible=true or tutor_id=(select auth.uid())
);
create trigger tutor_profiles_audit after insert or update or delete on public.tutor_profiles for each row execute function private.audit_change();

create function public.save_tutor_profile(p_display_name text,p_headline text,p_bio text,p_subjects text,p_visible boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 if char_length(btrim(p_display_name)) not between 2 and 200 then raise exception 'Enter a display name'; end if;
 if char_length(btrim(p_headline)) not between 2 and 200 then raise exception 'Enter a short headline'; end if;
 if char_length(btrim(p_bio)) not between 10 and 2000 then raise exception 'Write a longer bio'; end if;
 if char_length(btrim(p_subjects)) not between 2 and 500 then raise exception 'List the subjects you teach'; end if;
 insert into public.tutor_profiles(tutor_id,display_name,headline,bio,subjects,visible,updated_at)
 values(auth.uid(),btrim(p_display_name),btrim(p_headline),btrim(p_bio),btrim(p_subjects),coalesce(p_visible,true),now())
 on conflict(tutor_id) do update set display_name=excluded.display_name,headline=excluded.headline,
  bio=excluded.bio,subjects=excluded.subjects,visible=excluded.visible,updated_at=now();
end; $$;
revoke all on function public.save_tutor_profile(text,text,text,text,boolean) from public,anon;
grant execute on function public.save_tutor_profile(text,text,text,text,boolean) to authenticated;
commit;
