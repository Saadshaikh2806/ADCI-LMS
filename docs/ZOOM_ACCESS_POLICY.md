# Zoom access policy

Only an active super administrator with an MFA-verified session can manually
grant or change course enrolments. Each complimentary activation records the
approving account and time in the enrolment and audit log. Assigning staff roles
and changing account activation also remain super-admin operations.

Zoom learner admission requires an active/completed, unexpired enrolment plus
either a captured payment for that learner and exact course whose order is still
paid, or an explicitly recorded super-admin complimentary grant. Legacy manual
enrolments without attribution need reapproval through People > Manage > Apply.
This stricter admission check applies to Zoom; other course access checks retain
their existing enrolment rules.

Active instructors, content authors, academic leads, branch administrators and
super administrators can host with MFA. Finance, support and mentor roles do not
receive host privileges. Branch administrators keep their existing operational
course, schedule, commerce and reporting permissions but cannot grant access.

Hosts are trusted meeting operators. These LMS controls do not prevent a host
from using Zoom's own meeting controls, nor do they revoke previously issued Zoom
credentials. Automatic registrant revocation after refunds remains separate work.

## Release order

Apply `supabase/migrations/202609050001_super_admin_complimentary_access.sql`
in the production Supabase SQL editor **before** deploying the application.
The route relies on the migration's organization ID to enforce host MFA.
Do not deploy the application alone.

The migration does not cancel or delete existing enrolments. It requires
unattributed manual enrolments to receive explicit super-admin approval before
they can be used for Zoom.

## Verification

`pnpm build` and `pnpm test:logic` verify the application.
The focused database test runs the migration and actual role/MFA function in
an isolated PostgreSQL-compatible PGlite database with synthetic fixtures:

```sh
npm install --prefix tmp/access-tests --no-audit --no-fund @electric-sql/pglite
node scripts/test_zoom_access.mjs
```

It covers denied grant roles, inactive super admins, missing MFA, explicit grants,
legacy grants, captured/failed/refunded payments, mismatched learners/courses,
expiry/cancellation, host roles and service-only function permissions.
