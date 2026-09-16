# Summit ScholarsBridge implementation plan

Source: supplied 16-page Student Portal Proposal, dated 14 September 2026.
The proposal supplies product requirements; its approval instructions do not override the user's authorization to start development.

## Technology decisions
- Supabase PostgreSQL: operational records, roles and row-level security.
- Supabase Auth: verified email/password accounts; no simulated ChatGPT sign-in for this application.
- Supabase Storage: private files, with access checked against database policies.
- Resend: authentication mail through Supabase custom SMTP; transactional mail through the server adapter.
- PayChangu: future verified student payments, as specified in the proposal.
- Keep React/Vinext/Cloudflare deployment for now.

## Step 1 — account and service foundation (implemented locally)
- Registration, email verification, login, password recovery and logout.
- Pending account status separate from activated student/staff access.
- Nine named roles from proposal page 4; no self-assigned staff privileges.
- Verified server identity and protected workspace entry.
- SQL migration for profiles, roles, audit events, universities and courses.
- Private storage buckets; only applicant documents have initial access policies.
- Resend adapter with mandatory event retry key and no public sending endpoint.
- Optional Mzuzu University and six-course catalogue seed.
- Local PostgreSQL policy tests plus input/access/email adapter tests.
- Live project migration, SMTP delivery and real-device authentication still require provider configuration.

This step is NOT the entirety of proposal Phase 1. Empty workspaces intentionally contain no fictional academic/financial records.

## Step 2 — finish Foundation (proposal pp. 4–5, 7–8, 14)
- Configurable organisation details, universities/campuses/departments/programmes, academic periods, courses and venues.
- Mobile application form, document upload, duplicate checks and versioned consent.
- Draft → Submitted → Under Review → Additional Information Required / Approved / Rejected / Waitlisted / Cancelled.
- Admissions prepares; Academic Administrator approves. Retain transition history, actor and reason.
- Controlled staff invitations and role assignments, with approval for high-risk changes.
- Account activation and unique Summit student number. Preserve the original application.
- In-app and Resend application notifications with durable outbox/retry state.
- Make the public catalogue database-driven and provide course details.
- Exit: apply, review, approve and configure academic structure end to end.

## Step 3 — academic operations (proposal Phase 2)
Enrolment eligibility/capacity, course offerings, tutor assignments, timetable conflict checks, learning modes,
venues/meeting links, materials, announcements and attendance. Tutor access limited to assigned classes.
Exit: approved student and assigned tutor complete a class workflow.

## Step 4 — student payments (proposal Phase 3)
Configurable fees, invoices, instalments, verified PayChangu checkout/webhooks, unique transaction references,
ledger, receipts, reconciliation and approval-controlled refunds/adjustments.
Exit: repeat callbacks update the correct balance exactly once.

## Step 5 — assessment (proposal Phase 4)
Assignments, submissions, lateness rules, quizzes, timing/attempt limits, grading, correction and approval.
Results stay private until academic approval/publication; revisions audited.
Exit: tutor draft → academic review → student-visible result.

## Step 6 — communication (proposal Phase 5)
Announcements, direct messages, support tickets, reminders, configurable notification preferences,
generated documents, reporting and optional WhatsApp.
Exit: centralised communication with durable delivery status and scoped reports.

## Step 7 — advanced and launch readiness (proposal Phase 6)
PWA, recordings, digital IDs, QR attendance and expansion. Backups/restoration, monitoring,
privacy/retention, MFA and session controls, performance/accessibility, controlled pilot.
Payroll and AI support are later scope, not prerequisites for core launch.

## Unresolved decisions — record, do not invent
- “Finance Administrator” approves adjustments on page 4 but is absent from the role list.
  Do not grant that authority to Finance Officer by assumption.
- Actual staff assignments and separation-of-duty rules (including whether an approver may approve their own work).
- Fees, deposit, instalment dates and payment-based access rules.
- Approved privacy/consent, integrity, refunds, retention and acceptable-use text.
- Sending domain, production origin and provider project configuration.
- Pilot intake dates, programmes, course capacity, tutors and grading policy.
