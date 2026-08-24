# Relay product roadmap

Relay is evolving from a capable cross-platform publisher into a dependable operating system for planning, publishing, measuring, and automating social content. Work is ordered to deepen the existing product before expanding its surface area.

## Phase 0 — Stabilize the current release

Goal: make the existing product safe to change, observable in production, accessible, and consistently verifiable.

- Align and pin the local/CI package-manager toolchain so install, test, typecheck, and build commands are reproducible.
- Add end-to-end coverage for registration, OAuth connection, media upload, scheduling, publishing failures, retries, and account deletion.
- Add API integration coverage for authentication, owner boundaries, bulk operations, and idempotency.
- Add worker health reporting for queue depth, publishing latency, provider-error rates, token refresh, and analytics freshness.
- Audit dialogs and menus for focus trapping, focus restoration, Escape handling, keyboard navigation, and reduced-motion support.
- Split the application shell into feature modules with explicit shared contracts.
- Preserve current publishing, analytics, slideshow, API-key, and MCP behavior during the refactor.

Acceptance criteria:

- A fresh supported environment can run install, test, typecheck, and production build without changing dependency metadata.
- Critical publishing workflows have automated regression coverage.
- Operators can distinguish a healthy web process from healthy publishing, token, and analytics workers.
- Core workflows are usable with a keyboard and respect reduced-motion preferences.

## Phase 1 — Complete the publishing workflow

Goal: let a user manage a post through its entire lifecycle without recreating it or touching the database.

- Edit drafts and scheduled posts.
- Reschedule scheduled posts from post details and the calendar.
- Retry individual failed destinations.
- Autosave composer drafts and recover them after closing or reloading.
- Support per-network caption variants while keeping a shared base caption.
- Validate provider requirements before submission: caption length, media type, file constraints, required titles, privacy, and unsupported features.
- Show provider-specific previews and validation results.
- Replace the shortcut-only command menu with real search across posts, media, brands, accounts, and actions.
- Back primary views and filters with URLs so they can be refreshed, bookmarked, and shared.

Acceptance criteria:

- Draft and scheduled content can be opened, changed, saved, published, rescheduled, cancelled, and recovered.
- Failed destinations can be retried without republishing successful destinations.
- Invalid provider payloads are blocked with actionable explanations before scheduling.
- Browser navigation and refresh preserve the active app view.

## Phase 2 — Turn scheduling into campaign planning

Goal: make the calendar the operational center for planning coordinated content.

- Drag scheduled posts to reschedule them.
- Filter the calendar by brand, account, platform, status, and campaign.
- Add bulk select, bulk reschedule, duplicate, cancel, and retry operations.
- Introduce campaigns that group related posts across dates and destinations.
- Add saved post templates and reusable publishing presets.
- Warn about queue conflicts and accidental duplicate scheduling.
- Make brand timezone and local scheduling timezone explicit throughout planning.
- Add best-time recommendations after sufficient historical data exists.

Acceptance criteria:

- Users can plan and modify a multi-post campaign from the calendar.
- Bulk operations are transactional where appropriate and report partial failures clearly.
- Every scheduled timestamp is displayed with an explicit timezone.
- Recommendations are hidden until there is enough trustworthy data and explain their basis.

## Phase 3 — Unlock historical analytics

Goal: turn stored metric snapshots into useful decisions instead of lifetime totals alone.

- Add date ranges and historical trend charts.
- Show growth and period-over-period changes.
- Filter by brand, platform, account, campaign, and content type.
- Add per-post metric history and cross-platform comparisons.
- Compare engagement, reach, saves, and watch time without implying unavailable metrics are zero.
- Identify high-performing formats, platforms, days, and publishing times.
- Export CSV and deliver scheduled performance reports.

Implementation status (August 2026): date ranges, period-over-period growth, historical trend charts, brand/platform/account/campaign/content filters, per-destination rankings, cross-platform comparisons, metric availability, CSV export, and scheduled in-app report delivery are implemented.

Phase 3 also adds the reusable Video Label Studio, shared draggable slideshow/video labels, three label-style shortcuts, named R2 media and music folders, fixed/rotating/random music policies, bulk hook rendering and scheduling, and matching REST/MCP agent tools.

## Phase 4 — Improve media and creative production

Goal: make reusable creative assets easy to organize, adapt, and publish correctly.

- Add media search, tags, folders, favorites, and usage history.
- Detect duplicate uploads and protect assets referenced by scheduled posts.
- Add image cropping and platform safe-area previews.
- Store alt text and accessibility metadata.
- Add slideshow templates, brand presets, reusable text styles, and stronger reordering tools.
- Produce platform-specific aspect ratios from one campaign asset set.
- Later, add video trimming, captioning, and thumbnail selection.

## Phase 5 — Add collaboration and automation controls

Goal: support teams and agents with clear authority, review, and accountability.

- Add workspaces and owner, admin, editor, contributor, and reviewer roles.
- Add approvals, comments, mentions, and change history.
- Add per-brand permissions and an audit log.
- Deliver publish, failure, expiry, and analytics events through webhooks and optional notifications.
- Add API-key expiration, rotation, usage logs, rate limits, and narrower scopes.
- Expand MCP tools only after the matching UI and API workflows are stable.

## Phase 6 — Expand reach and growth capabilities

Goal: help mature Relay workspaces distribute and learn more broadly.

- Add providers such as LinkedIn, Threads, Bluesky, and Pinterest according to demand and API readiness.
- Repurpose successful content into channel-appropriate variants.
- Add reusable brand voice and content guidelines.
- Track experiments and content variants.
- Add a content inbox and idea backlog.
- Offer optional AI assistance grounded in the workspace's brand guidance and prior content.

## Architectural principles

- Keep publishing idempotent and preserve worker lease/retry invariants.
- Prefer server-side pagination, filtering, and search over loading entire workspaces into the browser.
- Model provider capabilities explicitly and use the same contracts for validation, previews, APIs, and workers.
- Keep URLs as the source of truth for navigable application state.
- Treat accessibility, observability, data retention, backups, and migration recovery as product requirements.
- Favor workflow depth and reliability over adding providers or broad visual redesigns.
