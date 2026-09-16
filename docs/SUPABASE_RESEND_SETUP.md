# Supabase and Resend setup

## 1. Local environment
Copy .env.example to .env.local. Set:
- NEXT_PUBLIC_SUPABASE_URL: project API URL.
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: project publishable key (legacy anon key also works).
- APP_URL: exact app origin, e.g. http://localhost:5173.
- RESEND_API_KEY: server-only Resend sending key.
- RESEND_FROM_EMAIL: a plain email address on your verified Resend domain.

Never put a secret/service-role key in a NEXT_PUBLIC variable. Normal student/staff requests do not use a service-role key. Private library file uploads/delivery and the notification dispatcher require SUPABASE_SERVICE_ROLE_KEY (a server secret or legacy service-role key). The dispatcher additionally requires a CRON_SECRET of at least 32 random characters.
Restart the development server after changing configuration. Supply public values at build time and server values in the deployment environment.
Without configuration, account forms show an availability notice and remain disabled; no mock login is enabled.

An existing env.local template is ignored by Git but is not loaded automatically. When migrating it,
rename/copy it to .env.local and map NEXT_PUBLIC_SUPABASE_ANON_KEY to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
NEXT_PUBLIC_APP_URL to APP_URL, and EMAIL_FROM_ADDRESS to RESEND_FROM_EMAIL.
Replace template values with valid keys. Keep APP_URL matched to the actual local development port.

## 2. Database
Use a fresh development Supabase project first.
Apply these files once, in order, in SQL Editor (or your Supabase migration workflow):
1. supabase/migrations/202609150001_foundation.sql
2. supabase/migrations/202609150002_admissions.sql
3. supabase/migrations/202609150003_notifications.sql
4. supabase/migrations/202609160001_staff_access.sql
5. supabase/migrations/202609160002_admin_library.sql
If an earlier migration is already applied, apply only the remaining files.
Optionally apply supabase/seed.sql. Seed codes are Summit internal codes, not official university codes.

The migration creates nine roles, pending profiles, a signup trigger, RLS policies, audit triggers,
public catalogue tables and four private storage buckets.
New users always become pending students regardless of signup metadata.
No client can directly set roles or activate an account. Controlled PostgreSQL functions implement academic configuration, admissions review and activation. A different academic approver must confirm an admissions recommendation.
Existing auth users from before migration are not backfilled; use a new project or plan an explicit backfill.

## 3. Supabase Auth
Enable Email/Password and keep Confirm Email ON. Set minimum password length to 12.
Set Site URL to APP_URL and allow the exact /auth/confirm URL for each approved app origin.
Configure rate limits and production CAPTCHA/MFA policies before opening registration widely.

Set the Confirm signup email link to:
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Verify your email</a>

Set the Reset password email link to:
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>

The application sends an explicit /auth/confirm redirect. Keep the dashboard redirect allowlist narrow.
The route verifies the one-time token, sets session cookies, then redirects to /portal or /reset-password.
Do not use the default fragment-based confirmation URL with this server-rendered implementation.

## 4. Resend
Verify your sending domain in Resend using the DNS records Resend provides.
In Supabase Authentication → Email → SMTP Settings, configure Resend's documented SMTP connection:
- Host: smtp.resend.com
- Port: 465 (TLS)
- Username: resend
- Password: Resend API key
- Sender: your verified sender email and Summit ScholarsBridge display name

Supabase sends verification/recovery emails through this SMTP connection.
The application adapter in lib/email/resend.ts sends queued application notifications. Payment notifications will follow with the finance module.
It is not a second sender for signup mail, so signup does not produce duplicate verification messages.
No real email was sent during implementation tests.
The database outbox supplies stable event keys, exclusive leases and delayed retries. Configure a scheduler to POST to /api/internal/notifications with Authorization: Bearer <CRON_SECRET> every minute. The endpoint processes up to five emails per request. Never expose the service-role key or cron secret in public variables.
Attempts older than 23 hours or exhausted retries require manual review in notification_outbox; confirm provider delivery before requeueing them. Do not automatically reset first_attempt_at or change event_key to force a retry.

## 5. First staff account — development bootstrap only
Create and verify the designated administrator's account normally.
In SQL Editor, confirm the exact auth user UUID, then run a reviewed transaction:
begin;
select set_config('app.audit_reason', 'Initial administrator bootstrap', true);
update public.profiles set account_status = 'active' where id = 'REPLACE_WITH_VERIFIED_USER_UUID';
insert into public.user_roles(user_id, role) values ('REPLACE_WITH_VERIFIED_USER_UUID', 'super_admin');
commit;

Do not assign roles through user metadata or browser code. Use this controlled bootstrap only for the first administrators; use /portal/staff for subsequent role changes.
Ordinary applicant activation now happens only through the admissions decision function. After bootstrapping the initial administrators, use /portal/staff to request and approve roles for separate verified admissions and academic accounts. Invitation emails remain pending.

## 6. Storage
application-documents: private, 10 MiB, PDF/JPEG/PNG.
Object paths: authenticated user UUID / application UUID / random file UUID. Upload/remove operations lock and check the editable application; submitted files are read-only.
Applicants can read their own linked files; active admissions/academic administrators can review application documents. Auditors can read finalised applications. Downloads use short-lived signed URLs with attachment disposition.
course-materials, assignment-submissions and generated-documents: private, currently deny client access.
Add relationship-based policies together with the associated feature, not broad public bucket access.
Upload UI, size limits and basic signature checks are implemented. Malware scanning and orphan-file retention procedures remain launch work.

## 7. Validate a configured project
- Create two student accounts; verify email and sign in.
- Refresh a portal page and confirm the session survives; sign out and confirm protected routes reject access.
- Request password recovery, follow the link once, update the password and sign in again.
- Confirm the second account cannot read the first account's profile/files.
- Try setting role/status through signup metadata or direct API requests: neither may grant staff privileges.
- Activate a test staff user through the controlled bootstrap; verify their assigned workspace.
- Suspend that account; verify access and privileged storage/audit reads stop.
- Confirm authenticated responses are private/no-store in the hosted environment.
- Verify resend delivery using test recipients only before production.

After configuring core academic options, publish the organisation-approved privacy notice and open admissions in /portal/academics. Test draft ? submit ? admissions recommendation ? separate academic decision. Verify the student number and pending registrations.

Local automated SQL tests use real PostgreSQL in PGlite with small Supabase schema stand-ins.
They do not verify hosted Auth, Storage API MIME enforcement, SMTP, or deployment settings.

## References
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Storage policies: https://supabase.com/docs/guides/storage/security/access-control
- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Resend SMTP: https://resend.com/docs/send-with-smtp
- Resend idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys

## Staff access (migration 4)

Apply `supabase/migrations/202609160001_staff_access.sql` after the three earlier migrations. Staff register and confirm their email, then an active System Administrator or Super Administrator requests a grant or revocation at `/portal/staff`. A different Super Administrator must approve; neither the requester nor target can decide. Approval activates a pending account and grants only the selected role. It does not create student enrolments or invoices. Revoke staff roles individually; the existing student role is retained. Suspended accounts are excluded.

Bootstrap the first Super Administrator and System Administrator using the controlled SQL procedure above; the portal cannot approve its own bootstrap. Requests and decisions are audited. Auditors can read requests. The screen displays the latest 100 requests; full history remains in the database. Invitation emails, account suspension controls, and paginated audit browsing remain pending. No staff emails are sent by this feature.

Library and expanded Admin setup: see [ADMIN_LIBRARY_SETUP.md](ADMIN_LIBRARY_SETUP.md).
