# ADCI LMS

The learning-management platform for Anees Defence Career Institute. It includes learner courses, protected lesson assets, live classes, quizzes, assignments, certificates, commerce, support, reporting, role-based administration and MFA-protected staff access.

## Local setup

1. Install Node.js 20 or newer and pnpm.
2. Copy `.env.example` to `.env.local` and add the project values.
3. Run `pnpm install`.
4. Run `pnpm dev` and open `http://localhost:3000`.

Local environment files are ignored by Git. Never commit the Supabase service-role key, Razorpay secrets, SMTP password or cron secret.

## Database

Run the SQL files in `supabase/migrations` in filename order. Existing projects only need migrations they have not already applied. The final readiness batch is `202608010003` through `202608010009`.

## Video storage

Lesson videos are stored in Cloudflare R2 (zero egress fees, so serving cost stays flat regardless of playback volume). Create an R2 bucket and API token in the Cloudflare dashboard, then set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` in your environment. Uploads and playback go through `app/api/storage/r2-upload-url` and `app/api/storage/r2-playback-url`, which mint short-lived presigned URLs after checking the caller's role/enrolment in Supabase. Lesson assets uploaded before this change remain in Supabase Storage and keep working (`storage_provider` on each asset row tracks which backend it lives in).

The R2 bucket must remain private and needs an explicit browser CORS policy. Use the exact policy and upload limits in `docs/PRODUCTION_RELEASE.md` before testing uploads.

Before uploading large lecture catalogs, use `scripts/bulk_optimize_videos.py` to create web-optimized H.264/AAC MP4 files. Windows installation and bulk usage instructions are in `docs/BULK_VIDEO_OPTIMIZATION.md`.

## Production

The application uses the standard Next.js build: `pnpm build`. The public service check is available at `/api/health`. See `docs/PRODUCTION_RELEASE.md` for the complete release checklist.

## Paid private live sessions

The Live schedule workspace creates one-time or weekly paid sessions on any selected day. Each occurrence becomes a separate one-lesson course and Razorpay offer, so a purchase unlocks only that date. Apply migration `202608120001_bookable_agora_series.sql`.

Agora Live and Zoom Live are separate choices. Agora runs inside the LMS using `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE`.

Zoom Live uses the paid Zoom host account while keeping meeting links private. Create a Server-to-Server OAuth app and a Meeting SDK app in the Zoom App Marketplace, add meeting read/write and user token permissions, then configure the six `ZOOM_*` values shown in `.env.example`. The LMS creates approval-required meetings, checks the exact paid enrolment, asks for an account-bound personal code, and automatically approves only that buyer's unique Zoom registrant token without exposing a join link. Apply `202608210001_zoom_live_sessions.sql` before enabling the Zoom Live button.
