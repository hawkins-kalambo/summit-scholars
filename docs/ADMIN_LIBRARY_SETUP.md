# Admin portal and student library

## Delivered

- Admin overview with live counts and links filtered by administrator responsibilities.
- Searchable, paginated account directory. System/Super Administrators can suspend and restore accounts with reasons. Self-suspension and removal of the last active Super Administrator are blocked. Restoration restores the prior status; it never approves a pending application.
- Existing admissions, academic configuration and independently approved staff role changes are linked from the overview.
- Academic administrators can activate, withdraw and complete approved student enrolments. These are academic decisions; payment clearance is not yet integrated.
- Read-only, paginated audit history for Super Administrators and auditors; organisation settings and email queue monitoring for Super Administrators.
- Library management for Super and Academic Administrators: upload PDF/PNG/JPEG (10 MiB maximum), or paste plain-text notes; categorize, associate a course, edit, preview, publish, withdraw and archive. Editing returns published material to draft. Files are immutable; upload a new resource to replace a file, then archive the old version.
- Student catalogue with title/category search, pagination and a reader with PDF page navigation, accessible extracted text and account watermark. Images and pasted text are also supported.

## Database setup

Apply `supabase/migrations/202609160002_admin_library.sql` ONCE, after the four migrations already applied. It creates the private `library-materials` bucket, library tables/policies/functions, account management functions, organisation and queue administration, and enrolment status changes. Do not rerun the earlier migrations.

No library material or student is seeded by this migration. The user must apply it in Supabase SQL Editor; it has not been applied remotely by the coding agent.

## Access rules

New resources default to all approved students (active account, student role, issued student number). Pending applicants do not receive library access. An optional course audience requires an active enrolment in that course; pending, withdrawn and completed enrolments do not qualify. Staff without a student admission do not gain library access merely because signup gave them a student role. Library managers can preview drafts.

Private Storage has NO authenticated/anonymous read policies for library files. The portal file endpoint first verifies the user and reads resource metadata through RLS, then uses the server-only storage credential. It returns no public or signed storage URL, and marks responses private/no-store. Every new file request rechecks publication, suspension and course access.

## Server configuration

`SUPABASE_SERVICE_ROLE_KEY` is required for uploads and reading private files. It accepts a Supabase server secret (`sb_secret_...`) or a legacy service-role key. It must never have a NEXT_PUBLIC prefix. The existing locally saved server secret was copied into the server-only setting without printing it. Restart the server after changing settings. Do not share credentials in chat.

PDF.js is bundled locally, including its worker; library documents are not sent to a third-party viewing service.

## Meaning of portal-only viewing

The app has no download link, PDF download toolbar or print button. The library reader is hidden by normal print CSS. This discourages ordinary downloading; it is NOT DRM. Browsers must receive content to display it. DevTools, screenshots, browser features, accessible text and already-loaded content cannot be reliably prevented from being copied. Revocation blocks future requests, not a copy already loaded. Canvas PDF reading includes accessible extracted text; scanned pages may require a separately pasted accessible version.

Administrators must upload materials they are permitted to share. File signatures and size are checked; malware scanning is not implemented. Ambiguous upload/save failures may leave private orphan objects; investigate references before deleting these via Storage. Do not automatically delete objects after an uncertain database response.

## Acceptance checks after migration

1. Admin sign-in -> overview -> user directory. Search and inspect accounts.
2. Suspend a test student; confirm protected library reads fail. Restore; confirm the previous status returns.
3. Upload a PDF and save a draft. Preview all pages and test mobile navigation. Publish it.
4. A different approved student can find and read it; an applicant cannot. Check image and pasted-note resources too.
5. Set course-only access. Confirm only active enrolments can read it; withdraw enrolment and verify the next content request is denied.
6. Edit a published resource; it becomes draft. Republish then archive it, and confirm student access is removed.
7. Confirm Storage public URLs and authenticated direct downloads are denied; inspect portal response headers for no-store.
8. Check audit records for every resource/status/settings change.

Automated PostgreSQL tests cover these permission/state rules with local Supabase schema stand-ins. They do not substitute for live Auth/Storage and authenticated browser acceptance testing.

## Remaining broader administration work

Staff invitation emails, programme/faculty/campus hierarchy, payments/finance administration, teaching/assessment administration, comprehensive reporting and production operations remain separate work. Existing staff onboard by registration and separate role approval. This delivery does not claim those unfinished modules are complete.
