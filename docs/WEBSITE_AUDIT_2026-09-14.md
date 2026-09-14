# Website review — 14 September 2026

Follow-up: the application findings below have local repairs. Production configuration is being applied by the owner. See [Website fixes and rollout](WEBSITE_FIXES_2026-09-14.md); the findings below preserve the original audit evidence.

Reviewed local HEAD `7ab3728b082f` with the pending recorded-lesson playback repair from this task. The production health endpoint reports the same deployed commit. Eight additional findings follow; the earlier missing-storage-provider bug is tracked separately at the end.

## Findings

### 1. Production reports incomplete configuration — P1, observed live

At 13:51:57 UTC, `GET https://lms.adcionline.com/api/health` returned HTTP 503:

```json
{"status":"unavailable","version":"7ab3728b082f","checks":{"database":"ok","configuration":"incomplete"}}
```

At least one required server setting is absent or blank. The public endpoint deliberately does not disclose which one, so this check does not establish which integration is affected. Compare the deployed environment against `lib/config/production.ts:3`, then recheck health. Database connectivity passed.

### 2. Deletion can remove files while retaining the lesson — P1, reproduced with isolated dependencies

Location: `lib/supabase/admin.ts:717–732`.

`deleteAdciAcademicEntity` deletes the R2 and Supabase files before calling the database deletion RPC. If that final call fails, such as a connection failure, changed course status, or database constraint, the lesson remains with pointers to deleted files. The interface reports failure, although irreversible file deletion already happened. Partial storage deletion failures have a similar problem.

The reproduction executed the actual helper with successful file removal and a rejected database call. Observed order: `file-deleted`, then `database-rejected`. No live objects were deleted.

Repair: authorize and commit curriculum deletion together with a durable cleanup record in the database, then remove files from that recorded list with retries. Simply swapping the two browser calls loses the metadata and authorization context needed for cleanup.

### 3. Rapid answer changes can save the wrong quiz choice — P1, reproduced with delayed responses

Locations: `components/StudentQuizRunner.tsx:246–273`; `supabase/migrations/202608010003_quiz_attempt_hardening.sql:376–392`.

Each answer click starts an independent save. Select A and then B while the network is slow: if B reaches the database first and A arrives afterward, the final saved answer is A while the screen still shows B. The database overwrites the answer without a revision check. Waiting for all saves before submission does not fix their order.

The reproduction executed the actual answer handler and completed the two requests in reverse order. The visible selection was index 1; the last persisted selection was index 0.

Repair: serialize changes per question or reject stale answer revisions on the server. Include review-flag updates in the ordering rules.

### 4. Eight-hour sessions expire after six hours — P2, reproduced in PostgreSQL

Locations: `supabase/migrations/202609080005_live_class_runtime_state.sql:29`; `app/api/live-sessions/create-series/route.ts:41`; `supabase/migrations/202608210001_zoom_live_sessions.sql:96`.

Both creation layers accept sessions up to 480 minutes, but the shared phase function marks every session ended six hours after its scheduled start. A permitted eight-hour class therefore stops accepting joins with two scheduled hours remaining. Other features that consume this phase also treat it as finished.

The actual SQL phase function returned `ended` for a class started seven hours ago, still running, with its scheduled end one hour in the future.

Repair: make the accepted session duration and expiry ceiling consistent, while preserving the intended limit on extensions.

### 5. Invoice printing produces hidden content — P2, reproduced in Chromium print mode

Locations: `app/globals.css:1988`; `app/globals.css:2213–2217`; `components/StudentCommerce.tsx:239`.

The global certificate print rule hides every element using `visibility:hidden !important`. The later invoice rule uses `visibility:visible` without `!important`, so it cannot reveal the invoice. The Print / save PDF button therefore produces an empty invoice area.

Using the actual stylesheet and an invoice fixture in Chromium print mode, computed visibility of the invoice heading was `hidden`.

Repair: scope certificate print styles to an open certificate, and scope invoice print styles to an open invoice. Check both outputs afterward.

### 6. Checkout retry hangs after a script-loading failure — P2, reproduced with isolated DOM events

Location: `components/StudentCommerce.tsx:68–86`.

If Razorpay's script fails to load, the rejected script element remains in the document. The next checkout attempt finds it and waits for a load/error event that already fired. The checkout promise never settles and the button stays on Opening secure checkout.

The reproduction triggered the first script's error event, retried the actual loader, and confirmed that no replacement script or new request was created and the retry remained pending.

Repair: remove failed script elements or explicitly track and retry their failure state.

### 7. Password recovery does not prompt for a new password — P2, source-confirmed; recovery email not sent

Locations: `components/AuthGate.tsx:131–134`, `components/AuthGate.tsx:184–187`.

Recovery emails return to the homepage. The authentication callback ignores the event type, including `PASSWORD_RECOVERY`, and treats the recovery session as an ordinary login. There is no recovery-specific new-password form. Users land in the workspace and must independently discover the password change in Settings.

Repair: route recovery sessions to a new-password/confirmation form and show completion after the password update succeeds. Verify expired links and MFA-enabled accounts too.

### 8. Long media sessions have no signed-URL renewal — P2, source-confirmed; production expiry not exercised

Locations: `app/api/storage/r2-playback-url/route.ts:61`; `components/StudentCoursePlayer.tsx:111–133` and its media elements.

R2 playback links expire after 15 minutes. The player fetches a link only when the selected lesson or asset changes, and has no expiry renewal or media-error recovery. A fresh request after expiry, for example seeking to an unbuffered section after a long pause, uses the expired link. Already-buffered or already-open transfers may continue, so this does not imply every video stops exactly at 15 minutes.

Repair: refresh authorization and obtain a new signed URL when needed, preserving playback position. Verify seeking and resuming after expiry with a long recording.

## Checks completed

- 18 existing Playwright tests passed across desktop Chromium and mobile Chromium, including login, registration/recovery entry screens, public verification, legal-page accessibility, headers, 404 handling, session handoff, rejected session claims, and Zoom navigation.
- Production `/`, `/verify`, `/legal/privacy`, `/legal/terms`, and `/legal/refunds` each returned HTTP 200 at widths 1440 and 390. No document-level horizontal overflow or uncaught page errors were observed.
- Five isolated reproductions passed by confirming the defects described above. Runnable local harness: `node tmp/website-audit-checks.mjs`. It does not modify production data.
- Typecheck, lint, automated logic/database/session/Zoom tests, release checks, and production build passed immediately before this audit during the preceding playback repair. They were not rerun without application changes.
- Source review covered authentication, learner playback/progress, quizzes, assignments, live schedules, checkout/payment routes, certificates, admin curriculum storage/deletion, and selected supporting search, community, support, account, and group workflows.

## Limits and existing repair

Production learner/admin workflows were not exercised with real accounts. No real payment, email, lesson deletion, upload, enrolment change, or live meeting was initiated. This is a broad functional review, not proof that every workflow is defect-free or a penetration test. Findings 7–8 were traced in source rather than reproduced against production.

The earlier recorded-video regression remains a separate pending repair: `202609140001_restore_lesson_storage_provider.sql` restores `storage_provider` dropped by commit `50715bc`. It must be applied to the live database, and the accompanying player message change deployed. This audit did not apply that migration or deploy any changes.

Only this report was added to tracked source during the audit. Existing playback-repair changes were preserved.
