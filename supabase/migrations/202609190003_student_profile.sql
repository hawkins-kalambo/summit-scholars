begin;
-- Phase 3.2: My Profile — an account-level contact number alongside full_name.
alter table public.profiles add column phone text check (phone is null or char_length(btrim(phone)) between 7 and 20);
grant update(phone) on public.profiles to authenticated;
commit;
