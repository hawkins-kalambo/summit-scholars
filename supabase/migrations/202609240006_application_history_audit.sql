begin;
-- Audit coverage gap: application_history had an `id` column but no audit
-- trigger, unlike every sibling table in the admissions migration.
create trigger application_history_audit after insert or update or delete on public.application_history
for each row execute function private.audit_change();
commit;
