# ADCI LMS

The learning-management platform for Anees Defence Career Institute. It includes learner courses, protected lesson assets, live classes, quizzes, assignments, certificates, commerce, support, reporting, role-based administration and MFA-protected staff access.

## Local setup

1. Install Node.js 20 or newer and pnpm.
2. Copy `.env.example` to `.env.local` and add the project values.
3. Run `pnpm install`.
4. Run `pnpm dev` and open `http://localhost:3000`.

Local environment files are ignored by Git. Never commit the Supabase service-role key, Razorpay secrets, SMTP password or cron secret.

## Database

Use the Supabase CLI to apply the ordered SQL files in `supabase/migrations`. The current migration head is `202609080002_verified_active_sessions.sql`; CI proves that the complete chain applies to an empty local project.

## Video storage

Lesson videos are stored in Cloudflare R2 (zero egress fees, so serving cost stays flat regardless of playback volume). Create an R2 bucket and API token in the Cloudflare dashboard, then set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` in your environment. Uploads and playback go through `app/api/storage/r2-upload-url` and `app/api/storage/r2-playback-url`, which mint short-lived presigned URLs after checking the caller's role/enrolment in Supabase. Lesson assets uploaded before this change remain in Supabase Storage and keep working (`storage_provider` on each asset row tracks which backend it lives in).

The R2 bucket must remain private and needs an explicit browser CORS policy. Use the exact policy and upload limits in `docs/PRODUCTION_RELEASE.md` before testing uploads.

Before uploading large lecture catalogs, use `scripts/bulk_optimize_videos.py` to create web-optimized H.264/AAC MP4 files. Windows installation and bulk usage instructions are in `docs/BULK_VIDEO_OPTIMIZATION.md`.

## Production

Run `pnpm verify`, `pnpm audit:production` and `pnpm test:e2e` before release. The public readiness check is available at `/api/health`. See `docs/PRODUCTION_RELEASE.md` for deployment gates and `docs/OPERATIONS_RUNBOOK.md` for backup, monitoring, rollback and incident procedures.

## Paid private live sessions

The Live schedule workspace creates one-time or weekly paid sessions on any selected day. Each occurrence becomes a separate one-lesson course and Razorpay offer, so a purchase unlocks only that date. Apply migration `202608120001_bookable_agora_series.sql`.

Live sessions run on Zoom. Apply `202609080004_remove_agora_live.sql` to retire any legacy in-LMS (Agora) sessions.

Zoom Live uses the paid Zoom host account while keeping meeting links private. Create a Server-to-Server OAuth app and a Meeting SDK app in the Zoom App Marketplace, add meeting read/write and user token permissions, then configure the six `ZOOM_*` values shown in `.env.example`. The LMS creates approval-required meetings, checks the signed-in account's exact paid enrolment, and automatically approves only that buyer's unique Zoom registrant token without exposing a join link. Apply `202608210001_zoom_live_sessions.sql` before enabling the Zoom Live button.

A class stays joinable while its Zoom meeting actually runs. Past the scheduled end it shows an **Extended** tag; when the host ends it for all (or `starts_at + 6h` passes) it expires and joins stop. `202609080005_live_class_runtime_state.sql` adds this. Detection is instant if you set `ZOOM_WEBHOOK_SECRET_TOKEN` and subscribe the Zoom app to *Meeting Started* / *Meeting Ended* (`/api/live-sessions/zoom/webhook`); otherwise the LMS reconciles Zoom state whenever a session is opened.

## Learner groups and bulk access

People → **Groups** builds named segments of learners. Branch and super admins create groups and manage membership; a super admin can then grant courses or live lectures to an entire group (or an ad-hoc selection on the People list) in one action. Grants are one-time — changing a group later never auto-grants or auto-revokes. Apply `202609090001_learner_groups.sql`.
