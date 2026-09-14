# Website fixes — 14 September 2026

The seven application defects from the website review are repaired locally. The earlier storage-provider regression is included. Production configuration remains an owner action, as agreed; no live settings or deployment were changed.

## What changed

- Curriculum deletion now commits before file removal. Database triggers capture each deleted asset in a private cleanup queue in the same transaction, including lesson/module/course cascades. Failed storage removals stay queued for retry; failed database deletions do not enqueue anything. The existing nightly notification job retries cleanup, so no additional cron is needed. Direct deletion of an attached R2 object is refused.
- Quiz answers and review flags save in click order. Failed answer changes restore the last successfully saved choice.
- Live sessions keep their existing extension limit but cannot expire before their scheduled end. The admin schedule uses the same rule.
- Certificate and invoice print rules are scoped to their own document. Certificate landscape printing is retained.
- A failed Razorpay script is removed so another checkout attempt can load it again.
- Recovery links display a password/confirmation form after account and MFA verification. Reloading preserves the recovery form, expired links offer another email, and successful updates show confirmation.
- Video/audio errors obtain a newly authorized signed URL, preserve playback position, and resume only if the recording was playing. Fresh failures do not cause an endless retry loop, and a late response cannot replace a newly selected lesson. Signed-link lifetimes and authorization checks are unchanged.

## Apply the database changes before releasing the app

Use the existing Supabase release process to inspect and apply the pending migration chain. Do not rename older applied migrations. The three new files are:

1. `202609140001_restore_lesson_storage_provider.sql`
2. `202609140002_preserve_scheduled_live_duration.sql`
3. `202609140003_durable_lesson_file_cleanup.sql`

Release the application after the migrations. Reload existing admin and learner tabs. Confirm the existing `/api/notifications/dispatch` cron still runs; its result now includes `fileCleanup`. Pending failures remain in `adci_lesson_file_cleanup` with `last_error` for server-side inspection. It processes 20 queued files per run, rotating failures behind other pending work. Larger deletions may require additional runs of the existing cron endpoint using its server-only cron credential.

## Hosting settings to apply yourself

The live health check reported `database: ok` and `configuration: incomplete`. It does not reveal the missing variable names, and this workspace has no connected hosting credentials, so the exact missing production settings could not be identified. Compare the **Production** environment in Vercel against this complete required list:

| Integration | Required variables |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| App and scheduled jobs | `NEXT_PUBLIC_APP_URL` (use `https://lms.adcionline.com`), `CRON_SECRET` |
| Zoom | `ZOOM_ACCOUNT_ID`, `ZOOM_API_CLIENT_ID`, `ZOOM_API_CLIENT_SECRET`, `ZOOM_HOST_USER_ID`, `ZOOM_MEETING_SDK_CLIENT_ID`, `ZOOM_MEETING_SDK_CLIENT_SECRET` |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |

Use the real credentials for the existing production services, not the placeholder values in `.env.example`. Keep server credentials server-only. Redeploy after changing environment settings, then verify `https://lms.adcionline.com/api/health` returns HTTP 200 with both checks `ok`. A successful configuration check confirms presence, not the validity of each provider credential.

In Supabase Authentication URL Configuration, allow `https://lms.adcionline.com/?reset-password=1` as a redirect URL. Retain the current site URL and other valid redirect entries. Existing recovery links without that query parameter are still handled via the recovery event.

## Validation

The regression checks cover quiz ordering and failed saves, checkout retry, media position/resume and late-response handling, database deletion refusal, storage retry, both storage providers, cleanup queue permissions/cascades/rollback, and live duration. Browser tests cover password recovery, expired links, print visibility for both documents, and the existing desktop/mobile flows. Typecheck, lint, all logic/Zoom/session/database/rate-limit tests, 24 desktop/mobile browser tests and the production build passed.

Production payment, email, deletion, and meeting actions were not performed during validation.
