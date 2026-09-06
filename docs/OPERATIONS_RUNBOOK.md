# ADCI LMS operations runbook

## Ownership and alerts

Assign a named primary and backup release owner before launch. Route Vercel application errors, Supabase database/auth alerts, failed Vercel cron runs and an external HTTPS monitor for `/api/health` to the on-call channel. Alert after two consecutive health failures and for elevated HTTP 429/500 rates, payment-webhook failures, email-delivery backlog or database resource saturation.

Vercel logs include an `x-request-id` response header and structured JSON for uncaught server errors. Connect the production project to a retained log drain and build dashboards by `service`, `area`, HTTP status and request ID. Do not place tokens, request bodies, payment payloads or learner content in logs.

## Daily checks

- `/api/health` returns HTTP 200 with database and configuration checks `ok`.
- Vercel cron `/api/notifications/dispatch` completed successfully.
- `adci_email_deliveries` has no growing due/failed backlog.
- `adci_payment_webhook_events` has no recurring `processing_error`.
- Supabase database, auth and connection-pool usage remain below alert thresholds.

## Backup and restore

Enable Supabase daily backups and point-in-time recovery appropriate to the paid plan. Before every migration release, record the latest restorable timestamp and export schema metadata. R2 object versioning is recommended for protected course assets; retain versions long enough to recover accidental curriculum deletion.

At least quarterly, restore the latest database backup into an isolated non-production project, apply its matching environment configuration, and run the learner/admin acceptance suite. Record restore duration, missing objects and corrective work. A backup is not considered verified until this exercise succeeds.

## Release and rollback

1. Require green CI and CodeQL checks on the exact commit.
2. Create a database restore point and verify no failed migration is recorded.
3. Run `supabase db push --dry-run`, review the SQL list, then `supabase db push` from the release commit.
4. Deploy the same commit to a Vercel preview wired to a staging Supabase/R2/Razorpay configuration.
5. Complete the acceptance checklist in `PRODUCTION_RELEASE.md`.
6. Promote the verified deployment and monitor health, errors, payments and email for at least 30 minutes.

For an application-only incident, use Vercel Instant Rollback to the last known-good immutable deployment. Do not reverse a database migration by deleting tables or columns. Deploy a tested forward-fix migration unless the release owner has validated a dedicated down migration against a restored copy. Disable affected course offers or live-session creation when containment is safer than an immediate data change.

## Incident response

For suspected credential exposure, disable the affected integration, rotate the secret at the provider, update the Vercel environment, redeploy, invalidate related sessions/tokens and review audit/provider logs. For payment discrepancies, preserve webhook and order records, suspend fulfilment only if necessary, and reconcile against Razorpay before modifying entitlements. Document timeline, user impact, containment, recovery and follow-up work.

## Data retention

Document the institution-approved retention periods for academic records, certificates, invoices, support/community content, security logs and failed notification data. Review deletion requests against statutory and academic-record obligations. Never delete financial evidence solely because course access has ended. Audit retention and privileged memberships quarterly.
