# ADCI LMS production release checklist

The current schema ends at `202609080002_verified_active_sessions.sql`. Release the application and database from the same reviewed commit; never paste only part of a migration into production.

## 1. Automated release gates

Run the same commands enforced by CI:

```text
pnpm install --frozen-lockfile
pnpm verify
pnpm audit:production
pnpm exec playwright install chromium
pnpm test:e2e
```

CI also starts an empty local Supabase stack and applies every file in `supabase/migrations`. A release is blocked unless the application, migration and CodeQL jobs pass.

## 2. Apply database migrations

Link the official Supabase CLI to the production project, inspect the exact pending set and apply it from the release commit:

```text
supabase link --project-ref <production-project-ref>
supabase db push --dry-run
supabase db push
```

Confirm the Supabase migration history ends at `202609080002`. Never rename an applied migration. Before pushing, verify a current database restore point as described in `OPERATIONS_RUNBOOK.md`.

### September 8 session and Zoom repair

Deploy the new application and migrations together during a maintenance window. Apply every pending migration, including `202609060002_single_active_session.sql`, `202609080001_zoom_cleanup.sql`, and `202609080002_verified_active_sessions.sql`. The old browser code cannot claim the new verified session records. Reload open tabs after deployment; users may need to sign in again. Do not roll the application back to the old device-token implementation while the new session guard is enabled.

The session migration installs `public.adci_check_request_session` as the PostgREST pre-request hook and adds restrictive session policies to existing ADCI tables and Storage objects. If the project has a custom pre-request hook outside this repository, compose its checks with this one before applying the migration. Verify the hook is configured and reloaded, rather than merely checking that its function exists. New protected tables must also receive the restrictive session policy.

MFA enrollment remains optional. Accounts with a verified factor must complete MFA before claiming a session. Sign in with the same test account in two independent browser profiles; the second login must succeed, the first must lose Data API/Next API/Storage access, and the first browser must leave its embedded classroom when it notices revocation. Browser timers may be throttled in background tabs. Already-issued third-party credentials and signed media URLs retain their provider-defined lifetime; this is not DRM or a promise of instantaneous provider-side revocation.

Verify Zoom deletion with an authorized administrator: stale purchase confirmation must leave the meeting untouched, ordinary deletion must remove it from the LMS and Zoom, and an unavailable Zoom API must leave a visible pending removal with a working retry. The cleanup script now processes only the durable `adci_zoom_cleanup` queue; it never deletes unrelated/untracked host meetings.

Provider references: [Supabase session IDs](https://supabase.com/docs/guides/auth/sessions), [Data API pre-request checks and their Storage/Realtime limits](https://supabase.com/docs/guides/api/securing-your-api), and [Zoom meeting state/deletion APIs](https://developers.zoom.us/docs/api/meetings/).

## 3. Production configuration

Copy every variable in `.env.example` into the production Vercel project. Use production-only server secrets for Supabase service access, Razorpay, SMTP, cron, R2, Agora and Zoom. Ensure no server secret begins with `NEXT_PUBLIC_`.

- Supabase email confirmation is enabled; Site URL is `https://lms.adcionline.com`; redirect allow-list contains only approved production and development origins.
- Create the first `super_admin`, enroll MFA, then confirm the initial-admin bootstrap cannot be claimed by another account.
- Configure Razorpay live keys and webhook `https://lms.adcionline.com/api/payments/webhook`; subscribe to captured-payment and refund events.
- Configure SMTP with aligned SPF, DKIM and DMARC.
- Configure the Vercel cron with a high-entropy `CRON_SECRET`.
- Configure Zoom Server-to-Server OAuth and Meeting SDK credentials, and Agora App ID/certificate.

Create a private R2 bucket with an Object Read & Write token restricted to that bucket. Do not attach a public custom domain. Apply this CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://lms.adcionline.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "Range"],
    "ExposeHeaders": ["ETag", "Accept-Ranges", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

## 4. Staging acceptance

Use separate learner, instructor, finance/support and super-administrator accounts against staging copies of every provider.

- Learner: confirm email, sign in, recover password, edit profile, purchase, receive receipt, consume every lesson type, submit quiz/assignment, join Agora and Zoom sessions, download and publicly verify a certificate, use community/support, then sign out.
- Staff: enforce MFA, test each role boundary, create/publish/retire content, schedule/delete paid live sessions, grade work, answer support, moderate community content, manage enrolments/refunds and inspect audit/report data.
- Failure paths: declined/duplicate payment, duplicate/refund webhook, expired enrolment/session, upload too large or wrong type, unavailable provider, retrying email, expired quiz, refresh during assessment and rollback after a failed live-series creation.
- Devices and access: keyboard-only navigation, visible focus, screen-reader labels, 200% zoom, reduced motion, phone/tablet/desktop layouts and current Chrome/Edge/Safari/Firefox.
- Load: test expected concurrent logins, lesson playback URL generation, live-class joins, quiz submission and notification dispatch without using production learner data.

## 5. Go-live and observation

Enable Supabase backups/PITR, R2 versioning, a Vercel log drain and external monitoring before promotion. `/api/health` must return HTTP 200 with both checks `ok`. Promote the tested immutable Vercel deployment, place one live Razorpay purchase/refund with an authorised account, verify email delivery, and observe the dashboards for at least 30 minutes.

Record the release commit, migration head, Vercel deployment, test evidence, restore point, approver and rollback target. Follow `OPERATIONS_RUNBOOK.md` for incidents and rollback.
