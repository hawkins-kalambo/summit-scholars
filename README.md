# Summit ScholarsBridge

Academic support portal built with Next.js/React, Supabase Auth/PostgreSQL/private storage and Resend email.

## Implemented so far
- Verified accounts, login, recovery and protected role workspaces.
- Core academic configuration and controlled course publication.
- Student applications, private documents, admissions review and separate academic approval.
- Student numbering, pending registrations, history and audit records.
- Transactional email queue with a protected Resend dispatcher.

Teaching workflows, PayChangu, assessment and reporting remain subsequent steps. This is not yet a production-ready complete system.

## Run locally
Node.js >=22.13.0 is required. Use npm and package-lock.json.

1. Run npm ci.
2. Follow docs/SUPABASE_RESEND_SETUP.md.
3. Copy .env.example to .env.local and configure the providers.
4. Apply all five Supabase migrations in order; optionally load supabase/seed.sql.
5. Run npm run dev (default port 3000).

Public pages can be reviewed without credentials. Account forms stay disabled until Supabase is configured.
An env.local file without the leading dot is not loaded automatically.

## Validation
- npm run typecheck
- npm test
- npm run lint
- npm run build
- npm start: serve the production build locally; does not deploy.

Tests do not contact a live Supabase project or send real email.

## Project map
- app/: public catalogue, authentication, applications, academic configuration and notification endpoint.
- lib/auth/: verified identity and role checks.
- lib/admissions/: academic queries, validation and file checks.
- lib/supabase/: request-scoped Supabase client.
- lib/email/: server-only Resend adapter.
- supabase/migrations/: PostgreSQL schema, access policies and workflows.
- tests/: application, permission, email and PostgreSQL integration tests.
- docs/IMPLEMENTATION_PLAN.md: complete proposal roadmap and unresolved decisions.
- docs/STEP_2_IMPLEMENTATION.md: current delivery and remaining scope.
- docs/SUPABASE_RESEND_SETUP.md: provider setup and live validation.

## Admin portal and student library

Admin overview: `/portal/home/admin`. User management, enrolments, library publishing, organisation settings, audit history and notification monitoring are implemented. Student library: `/portal/library`. Apply migration `202609160002_admin_library.sql` after the four existing migrations. See [Admin and Library setup](docs/ADMIN_LIBRARY_SETUP.md) for access rules, configuration and viewing limitations.
