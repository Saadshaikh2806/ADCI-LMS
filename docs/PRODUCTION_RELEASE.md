# ADCI LMS production release checklist

Use this checklist after the complete feature batch has been pushed. It keeps database changes, secrets and final testing in one controlled release.

## 1. Apply pending database changes

Open the Supabase SQL Editor for the ADCI project and run each file once, in this order:

1. `202608010003_quiz_attempt_hardening.sql`
2. `202608010004_unified_learning_search.sql`
3. `202608010005_learner_live_class_workspace.sql`
4. `202608010006_learner_assessment_centre.sql`
5. `202608010007_support_ticketing.sql`
6. `202608010008_unified_event_notifications.sql`
7. `202608010009_r2_video_storage.sql`
8. `202608020001_harden_r2_asset_access.sql`
9. `202608020002_fix_r2_lesson_playback.sql`

If some are already applied, start from the first unapplied file. Do not rename tables or paste only part of a function; run each whole file.

## 2. Confirm Supabase settings

- Authentication email confirmation is enabled.
- Site URL is `https://lms.adcionline.com`.
- Redirect URLs include `https://lms.adcionline.com/**` and the localhost URL used for development.
- SMTP sender and reply-to addresses are configured and deliver outside spam.
- The first administrator has an active `super_admin` membership.
- Storage buckets and policies from the lesson-assets migration are present.

## 3. Confirm hosting environment variables

Copy every variable named in `.env.example` into the production hosting project. Production must use server-only values for the Supabase service-role key, Razorpay secrets, SMTP password, cron secret and R2 credentials. Do not prefix those values with `NEXT_PUBLIC_`.

Before deploying, create the R2 bucket and an API token (Object Read & Write scope, restricted to that bucket) in the Cloudflare dashboard — this is a manual step, not covered by any migration or script here. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` from that token.

Add this CORS policy to the R2 bucket. Replace or extend the origins if the production or local address changes:

```json
[
  {
    "AllowedOrigins": [
      "https://lms.adcionline.com",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Accept-Ranges", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

The application accepts MP4/WebM videos up to 2 GB, MP3/M4A/WAV/OGG audio up to 250 MB, and PDF files up to 50 MB. Keep the bucket private; do not connect a public custom domain to it.

After changing environment values, redeploy the latest `main` branch and confirm `/api/health` returns `{"status":"ok"}`.

## 4. Final end-to-end acceptance test

Create separate learner, instructor and administrator test accounts.

- Learner: confirm email, sign in, update profile, enrol/purchase, play every lesson type, submit a quiz, submit an assignment, join a live class, download a certificate, create a support ticket and sign out.
- Instructor: schedule a live class, create content, publish an assessment, grade an assignment, answer a support or community item, and confirm only authorised admin sections appear.
- Administrator: manage people and enrolments, publish a course and announcement, process commerce actions, review reports/audit activity, and test MFA on a fresh login.
- Notifications: confirm announcement, support reply, assignment grade, assessment publication and live-class reminder badges; check each deep link and preference switch.
- Recovery: test password reset, expired session handling, refresh while a quiz is active, missing-page screen and failed-network screen.
- Responsive: repeat the main learner and admin flows on phone width and desktop width.

## 5. External service reminders

- Razorpay: replace test keys with live keys only after the final test order/refund cycle, register the production webhook URL, and verify its signing secret.
- SMTP: keep SPF, DKIM and DMARC aligned with the sender domain when moving away from Gmail.
- Monitoring: configure an external uptime check for `/api/health` and review Vercel function errors after release.
