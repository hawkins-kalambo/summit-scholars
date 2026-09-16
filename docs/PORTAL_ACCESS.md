# Separate portal entry points

| Portal | Sign in | Dashboard | Assigned roles |
| --- | --- | --- | --- |
| Admin | /login/admin | /portal/home/admin | Super, System and Academic Administrators |
| Staff & Tutors | /login/staff | /portal/home/staff | Admissions, Finance, Tutor, Support and Auditor |
| Student | /login/student | /portal/home/student | Student (including pending applicants) |

`/login` is the public portal selector. `/portal` chooses the highest-priority available portal (admin, staff, then student). Each dashboard verifies the current database roles and account status. Staff and administrators must be active. Pending students may access applications; suspended accounts cannot enter a portal.

All entry points use the same Supabase identity system. Signing in checks the selected portal against server-read assignments, then redirects to that portal. A wrong-portal login signs out the newly established local session and returns an error. Shared application and configuration pages retain their own permission checks and PostgreSQL policies. Portal selection never grants a role.

Existing accounts retain their roles. Because signup assigns a student role, staff accounts that retain that role may deliberately open the Student portal. The default landing prioritizes their staff responsibilities. Password recovery returns to the portal selector; email verification returns to the role-aware landing page.

No SQL migration or new Supabase redirect URL is needed for this change. The confirmation endpoint remains /auth/confirm. Staff access management remains at /portal/staff; it is separate from the Staff & Tutors dashboard.

Verification: tests/portals.test.mjs covers role separation, pending/suspended access and default landing priority. Real authenticated browser testing still requires signing in with the intended account.
