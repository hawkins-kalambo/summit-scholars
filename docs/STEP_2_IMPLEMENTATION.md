# Step 2 — core academic configuration and admissions

## Implemented
- Universities, programmes, registration intakes and courses can be created/edited in the academic configuration screen.
- Academic administrators prepare course records; Super Administrators publish them. Editing returns a published course to draft.
- Public course details use anonymous Supabase reads so staff sessions cannot expose draft courses.
- Student applications support drafts, requested courses, contact details and learning mode.
- Supporting files are private; upload checks inspect PDF/JPEG/PNG signatures and enforce 10 MiB per file.
- Five documents per application; documents can be removed while the application is editable.
- Submission requires an open intake, available academic choices, current privacy consent and any required document.
- Student-owned records and editable statuses are enforced in PostgreSQL, not only the interface.
- Admissions review supports information requests, waitlisting and approval/rejection recommendations.
- A different authorised academic approver makes the final decision.
- Revision checks reject stale saves and decisions, including null revision values.
- Approval activates the account, assigns a unique student number and creates pending course registrations atomically.
- Application snapshots, accepted privacy wording, history and audit records are retained.
- Application lists are paginated.
- Status changes enqueue transactional email in the same transaction.
- A protected notification endpoint claims leased batches, sends through Resend and records success/retries.
- Old ambiguous delivery attempts move to needs_review before the provider's idempotency window expires.

## Local verification
The SQL integration test exercises ownership, permissions, consent, document lifecycle, information requests,
waitlisting, rejection, approval, duplicate prevention, stale decisions, immutable outcomes, email leases and retry boundaries.
Tests use in-memory PostgreSQL and a fake email sender; no production records or real emails are involved.

## Still required before a live pilot
Apply the four migrations and configure Supabase Auth, storage, Resend SMTP/API and the scheduler.
Exercise the real sign-up, upload, signed download and email flows using designated test accounts.
A privacy notice must be supplied and published by the organisation; the system does not invent policy text.
File signature checks are basic format checks, not malware scanning.

## Remaining Foundation scope
Staff invitation emails and account suspension controls; campuses/faculties/departments;
full organisation and registration-field configuration; and richer document requirements.
The proposal's undefined Finance Administrator role remains unresolved.
The current admissions date boundary is Malawi time.

## Next academic operations step
Turn pending registrations into governed enrolments with capacity, eligibility and timetable checks.
Add tutor assignments, class schedules, venues/meeting links, learning materials, announcements and attendance.
Fees/invoices and PayChangu remain the subsequent finance phase; no fee or payment balance is invented here.

## Staff access follow-up

Implemented `/portal/staff` with verified-account role grant/revocation requests, independent Super Administrator decisions, SQL-enforced permissions and audit records. Migration: `202609160001_staff_access.sql`. Staff currently register using the existing email-confirmation flow. Invitation delivery and suspension management remain pending.
