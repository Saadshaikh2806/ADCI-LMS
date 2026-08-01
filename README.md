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

## Production

The application uses the standard Next.js build: `pnpm build`. The public service check is available at `/api/health`. See `docs/PRODUCTION_RELEASE.md` for the complete release checklist.
