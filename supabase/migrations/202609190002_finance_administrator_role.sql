-- Phase 1.2: add the finance_administrator role required by the approval matrix
-- (payment adjustments, refunds and payroll runs prepared by finance_officer).
-- Kept in its own transaction and does not use the new value here: Postgres
-- forbids using a freshly added enum value in the same transaction that added it.
begin;
alter type public.portal_role add value 'finance_administrator';
commit;
