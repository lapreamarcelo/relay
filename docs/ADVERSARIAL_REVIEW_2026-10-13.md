# Adversarial review — 13 October 2026

This is the checked issue list for the current working tree. Findings were read
again by the root reviewer, reproduced in a regression test before the relevant
fix, and assigned a verification case below. Existing uncommitted Video Studio
work has been preserved. Final integrated verification results appear at the end.

The numbered steps describe the original failure and the expected fixed result.
Use disposable local accounts and assets for API/storage cases. The automated
route tests mock authentication, SQL and R2 while executing production handlers;
worker integration tests use isolated schemas in a disposable PostgreSQL server.
No live social post or cloud asset was changed by this review.

## 1. Unfiled media and music crossed account boundaries — high

1. As account A, upload an image or music file without a project folder.
2. As account B, open All or Unfiled, then try renaming, moving or deleting A's key.
3. Before: B could discover and mutate the file; batch music rotation could use it.
4. Now: B cannot list it; mutations return 404 without storage writes. A retains access.

Fix: owner-specific object prefixes, shared ownership checks, and batch selection
filtering. Test: `apps/web/lib/media-ownership.test.ts` (upload, signing, staging,
listing, mutation, legacy recovery and music selection).
RED: `/tmp/relay-review-media-red.log`.

Deployment: old root keys have no owner metadata. See [legacy recovery](MEDIA_OWNERSHIP.md).
`RELAY_LEGACY_MEDIA_OWNER_ID` must only name a verified owner of all legacy root files.
Existing public playback URLs remain public; this fixes Relay's management access.

## 2. Renaming project media cleared a saved video's folder — medium

1. Create a video with a source clip or music track from a project folder.
2. Rename that asset in Media, then reload the saved video.
3. Before: its URL changed, but `sourceFolderId` or `musicFolderId` became null.
4. Now: renaming preserves the folder; an explicit move updates it appropriately.

Test: `renaming a project asset updates its URL while preserving saved video folder references`
in `media-ownership.test.ts`. RED: `/tmp/relay-review-media-rename-red.log`.

## 3. A past reschedule silently made a post due immediately — high

1. Create a draft or scheduled post with a valid destination.
2. PATCH `/api/v1/posts` with `{ "id": "<post>", "scheduledAt": "2020-01-01T09:00:00Z" }`.
3. Before: 200, with a schedule already due to the worker.
4. Now: 400, with post and destinations unchanged. `scheduledAt: null` remains explicit publish-now.

Test: `single-post rescheduling rejects past dates` in `apps/web/lib/post-routes.test.ts`.

## 4. Editing could remove every destination — medium

1. PATCH an editable post with its content, status and `targets: []`.
2. Before: 200 and every delivery target removed; a scheduled post could never publish.
3. Now: 400 before mutations; edits require 1–20 destinations.

Test: `editing rejects an empty destination list` in `post-routes.test.ts`.

## 5. Duplicate account IDs created duplicate deliveries — high

1. Edit a post with the same account twice in `targets` (including a whitespace-padded ID).
2. Before: two target rows could send the same content twice.
3. Now: 400 before mutations after normalizing account IDs.

Test: `editing rejects duplicate accounts` in `post-routes.test.ts`.

## 6. Caption-only Instagram feed posts passed validation — medium

1. Create or edit a caption-only Instagram feed post and select Schedule or Publish now.
2. Before: validation accepted it, but the publishing provider requires media.
3. Now: validation requires an image or video. Incomplete drafts can still be saved.

Tests: `Instagram feed posts require media` in `post-routes.test.ts` and
`packages/core/src/post-validation.test.ts`.

## 7. Promoting saved drafts bypassed content validation — high

1. Save an incomplete Instagram or YouTube draft, or use a legacy draft without targets.
2. Promote it with single PATCH `scheduledAt: null`, a future date, or a bulk schedule.
3. Before: the saved invalid plan was queued without validation.
4. Now: 400 and no writes; the current saved plan is read and checked under transaction locks.
   A batch with one invalid plan leaves every member unchanged.

Tests: saved-draft promotion matrix and atomicity cases in `post-routes.test.ts`.
RED: `/tmp/relay-review-post-promotion-red.log`.

## 8. Editing after a worker claim could queue a second publication — high

1. Let a worker claim a due target; hold its provider call before completion.
2. While the parent still says scheduled, edit and publish the post.
3. Before: the route replaced the claimed target and queued a new one while the original upload continued.
4. Now: 409 before writes if a locked target has a lease or has left draft/scheduled.

Tests: edit-state and just-acquired-lease cases in `post-routes.test.ts`.
RED: `/tmp/relay-review-post-edit-race-red.log`.

## 9. A slow upload outlived its lease and could publish twice — high

1. Hold worker A's provider upload beyond the three-minute publishing lease.
2. Run worker B's sweep while A is still uploading.
3. Before: B reclaimed the target and called the provider again.
4. Now: A renews its lease. Each claim has a unique token; stale claims cannot finish or notify.

Test: `a slow upload remains owned` in `apps/worker/src/publishing-regressions.integration.test.ts`.
The test compresses the lease duration and uses two workers against real PostgreSQL.

## 10. Temporary token refresh failures permanently failed posts — medium

1. Make an account refresh lease busy, or have its token refresher temporarily fail.
2. Run a due post through the publishing worker.
3. Before: the post failed immediately.
4. Now: it is deferred with bounded retries and succeeds after recovery; revoked authorization remains terminal.

Tests: token refresh contention/outage and revoked-authorization control in
`publishing-regressions.integration.test.ts`.

## 11. Fresh publications inherited an old draft's analytics age — medium

1. Publish one destination of a 100-day-old draft while another destination remains failed.
2. Collect metrics for the successful destination.
3. Before: the old creation date put it beyond the analytics horizon after one collection.
4. Now: a per-target publication timestamp starts analytics at the actual publication.

Tests: fresh-target and legacy-age cases in `publishing-regressions.integration.test.ts`.
Deployment requires `packages/database/drizzle/0024_target_published_at.sql`.
Legacy rows use the best retained timestamp; already-stopped analytics are not automatically requeued.

## 12. Expired analytics claims could save stale duplicate snapshots — medium

1. Block collector A, expire its lease, then let collector B claim and save the target.
2. Release A's original collection.
3. Before: both saved snapshots, even though A no longer owned the claim.
4. Fixed behavior: only the current claim may save metrics or change the next collection time.

Test: stale analytics takeover cases in `publishing-regressions.integration.test.ts`.

## 13. Draft recovery overwrote an explicit media handoff — medium

1. Leave an unrelated composer draft in local storage.
2. Open Media and click Use in post on a different asset.
3. Before: recovery restored the unrelated caption and media over the chosen asset.
4. Now: explicit handoff data takes precedence; ordinary blank-composer draft recovery remains available.

Test: `a media handoff takes precedence` in `apps/web/e2e/review-regressions.spec.ts`.

## 14. Month navigation skipped February on January 31 — medium

1. With the clock on January 31, open Calendar, click Today, then Next period.
2. Before: JavaScript date overflow advanced into March.
3. Now: February appears; Previous returns to January. Monthly navigation uses day 1.

Test: `calendar month navigation does not skip February` in `review-regressions.spec.ts`.

## 15. Command search included videos unrelated to the query — low

1. Have `launch.mp4` and `holiday.mp4` in Media.
2. Open Cmd/Ctrl+K and search `launch.mp4`.
3. Before: `holiday.mp4` also matched due to an ungrouped boolean expression.
4. Now: every image and video result must match the query.

Test: `command search excludes videos` in `review-regressions.spec.ts`.

## 16. Analytics rendered inconsistent server/client date links — medium

1. Open Analytics with the browser console visible.
2. Before: separate server/client current times produced different export links and React hydration errors.
3. Now: the initial server timestamp supplies the same range on both sides.

Test: `analytics hydrates without server/client date mismatches` in `review-regressions.spec.ts`.

## 17. Legacy trim controls lost linked motion and caption timing — medium

1. Use three four-second clips, link the first two, and put a caption at 9 seconds.
2. Trim the first clip to two seconds through the inspector or timeline handle.
3. Before: the next linked clip retained a four-second motion offset and the caption stayed at 9 seconds.
4. Now: motion offset becomes 2 seconds and the caption moves to 7 seconds.

Tests: inspector and handle trim cases in `apps/web/e2e/review-editor-regressions.spec.ts`.
Both control paths now use the existing timeline edit operation.

## 18. Legacy Duplicate copied a transition without moving later content — medium

1. Use three four-second clips, with a one-second incoming transition on the middle clip.
2. Duplicate that middle clip from Selected footage settings.
3. Before: the copy kept the transition/link clock and later captions did not move.
4. Now: the copy has no incoming transition or linked clock; the full four seconds are inserted and later cues move.

Test: `legacy Duplicate makes room for the full clip` in `review-editor-regressions.spec.ts`.

## 19. Inspector shortcuts hid the section they navigated to — medium

1. Open Video Studio on desktop, then use Camera, Device, Text or other inspector shortcuts.
2. Before: seven shortcuts wrapped into a six-column grid, making the sticky toolbar taller than the scroll offset.
3. Now: shortcuts occupy one row and the destination heading remains below the toolbar.

Test: `studio shortcuts reach every inspector section` in `apps/web/e2e/video-layout.spec.ts`.
RED: `/tmp/relay-review-browser-baseline.log`.

## 20. Expected project-access denials returned server errors — low

1. As B, list A's media project, or rename/delete a key in A's project.
2. Repeat with a nonexistent project ID.
3. Before: the expected denial returned 500, suggesting an infrastructure failure.
4. Now: 404 and no storage mutations; genuine R2 failures still return 500.

Tests: project ownership/missing-project and infrastructure-error controls in
`media-ownership.test.ts`. RED: `/tmp/relay-review-issue20-red.log`.

## 21. Mobile composer clipped the publish action — medium

1. At 320, 375 or 430 pixels wide, choose an image from Media, then select Instagram.
2. Look at the bottom scheduling controls, Save draft and Schedule post.
3. Before: the single footer row overflowed and partially hid the final action.
4. Fixed behavior: scheduling occupies one row and both full-width actions occupy
   the next, with safe-area padding and the date/timezone still available.

Test: `mobile composer actions remain fully visible` at all three widths in
`review-regressions.spec.ts`. RED: `/tmp/relay-review-mobile-footer-red.log`.

## Verification and scope

All 21 issues above have a regression that failed before its fix and passed
afterward. The root reviewer checked the implementation and integration results.

Completed checks against the final production build:

- `./node_modules/.bin/turbo run test typecheck`: all 15 tasks passed, including
  250 web unit/route cases. Log: `/tmp/relay-review-final-checks.log`.
- PostgreSQL worker integration suites: 21 passed, no skips. The tests used
  isolated schemas on a disposable local database, including two-worker lease
  takeover and stale-result scenarios. Log: `/tmp/relay-review-final-worker-integration.log`.
- `next build --webpack`: passed. Log: `/tmp/relay-review-final-production-build.log`.
- Final Chromium desktop/Android run of `demo`, `modal-layout`, `video-layout`,
  `review-regressions`, and `review-editor-regressions`: 90 passed; 12 deliberately
  skipped on the inapplicable device project. Log: `/tmp/relay-review-final-ui.log`.
- The phone cases visit all 11 main pages at 320, 375 and 430 pixels, check
  horizontal overflow, verify both composer actions fit, and save a draft.
  Manual browser inspection also confirmed the repaired composer and draft action.
- iPhone 13 WebKit/Safari emulation: 19 passed, covering the review regressions,
  all main-page navigation at the three phone widths, dialogs and reconnect flow.
  Log: `/tmp/relay-review-final-safari.log`.
- GPU suite, run serially in Chromium: 6 passed, including licensed model edges,
  screen fidelity, transparency, transitions, shared canvas and media fallback.
  Log: `/tmp/relay-review-gpu-final.log`.
- `git diff --check`: passed.

Preview density/resize and failed-export cancellation/retry/download checks passed
on both desktop and mobile (4 cases). Log: `/tmp/relay-review-export-hidpi-final.log`.
Real MP4 export passed on desktop and mobile (one case per device). Assertions
check 1080-square dimensions, H264/AAC, duration, timed-label pixels/fades, filename
and actual browser playback. Logs: `/tmp/relay-review-real-export-long.log` and
`/tmp/relay-review-real-export-mobile-final.log`. The mobile run used the final
build; the desktop run used the same renderer before the final composer CSS and
media error-status changes. No production renderer change was needed.

The earlier broad interactive run passed 159 cases and exposed 12 remaining
failures. Rechecked failures came from outdated selectors and software-rendering
deadlines; fixture updates retain the original behavior assertions. A separate
Safari run exposed unsupported mobile WebKit wheel input; its replacement also
proves scrolling works after the modal closes. The camera/variants/timeline rerun passed 13 cases
with 3 device-specific skips. The full suite is not represented as a single clean
run: passing subsets and targeted reruns are reported separately.

The local production app is available at `http://127.0.0.1:3022/demo`. Browser
tests use demo data and mocked remote services. The installed pnpm launcher has a
toolchain-version mismatch, so checks used the workspace's local binaries directly.

To rerun the database regressions, set `RELAY_PUBLISHING_TEST_DATABASE_URL` to a
disposable PostgreSQL database and run the worker's `test:publishing` script. It
includes both the existing provider-session suite and the new review regressions.

Before deployment, apply migration `0024_target_published_at.sql` and review the
legacy media recovery instructions. Neither the real database nor the cloud
bucket was migrated during this review.

Authentication/API-key scopes, account/brand ownership and OAuth state boundaries
received an additional read-only pass with no confirmed security defect. Ignored
non-owned brand account IDs were considered ambiguous partial-success behavior,
not added to the bug list without an established contract.

Browser test fixtures were updated for the existing text-only video canvas,
front/back label layers and seventh inspector shortcut. Mobile folder movement
uses its existing Move folder dialog, because native mouse drag is not a touch
interaction. These fixture corrections are not counted as product bugs.

External provider publishing remains simulated. Lease renewal cannot guarantee
exactly-once external effects during a database outage or cancel an upload already
accepted by a provider. Browser emulation does not replace a physical-device pass.
