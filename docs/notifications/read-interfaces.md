# Notifications read interfaces (#17)

Implementation starts from integration revision `d09a82cf4805ce40b24df477c0b95379a1eec04a`.
The existing `CADENCE_NOTIFICATIONS_ENABLED=true` gate must be explicitly enabled for Notifications reads and writes; this slice does not activate it.

## Application contract

`GET /api/notifications` returns `items`, `unreadCount`, `nextCursor` and a nullable `item`. Query parameters:

- `filter=all|unread` (default All), `limit=1..100` (default 50).
- `cursor` is the returned JSON cursor, URL-encoded by the caller. Ordering is descending UTC creation time, then descending row ID. Count covers the recipient's whole eligible unread history, independently of the page/filter.
- `id` resolves an exact selected item. Loading detail does not mark it read, so automatic initial display is safe.

`POST /api/notifications` accepts form data `intent=read&id=…` or `intent=read-all`. The server derives identity from the session; caller recipient IDs and watermarks have no authority. POST requires the same Origin and rejects cross-site Fetch Metadata. Read-all captures the maximum stored row ID synchronously at action invocation, before asynchronous session/body processing, and only acknowledges eligible recipient rows at or below it. Both actions preserve existing read timestamps.

The shared resolver verifies typed source relationships and current authorization for every list/detail/count/read path. Discussion access uses the existing course access resolver with the recipient's request (including country/PPP and staff exceptions). Deleted Discussion Questions are unavailable as question events; live replies may retain the deleted question placeholder. Buyer outcomes depend on Purchase ownership, not Enrollment. Team targets require current Team Admin membership in that exact team. Every path excludes rows at or beyond 90 days from creation.

Targets carry live domain state and exact destinations:

- Discussion: lesson URL with `questionId`, selecting one authorized thread. State distinguishes answered, unanswered and deleted questions.
- Refund Request: `/admin/refunds?refundRequestId=…`, selecting that request's current status even after another Platform Admin decides it. Existing stale-decision guards remain authoritative; reading does not decide it.
- Buyer outcome: `/api/purchases/:purchaseId?refundRequestId=…`, a buyer-only JSON resource returning the exact Purchase and Refund Request for the later detail UI. Enrollment loss does not invalidate ownership.
- Seat: `/team?teamId=…`, selecting that team's Seat list and buyer-owned Team Licences rather than the first membership. Buy more seats is available only for the team current checkout can target (the first administered team).

Invalid, missing or unauthorized detail targets return generic `Unavailable` responses. Independent destination navigation never mutates Notification reads.

## Verification

The approved seam is actual route loaders/actions against real migrated SQLite; the only substituted domain collaborator is MailTransport for the refund decision scenario.

Eleven vertical red→green cycles in `app/test/notification-reads.test.ts` established: authenticated recipient history; cursor/count/expiry/detail agreement; idempotent private reads and CSRF; invocation-watermark concurrent arrivals; own-request PPP and alternative staff access plus surviving replies; another Platform Admin's decision and buyer access after Enrollment removal; exact multiple-team destinations; exact buyer/refund destinations; selected lesson navigation; current discussion task state; generic malformed-target responses and activation gating. Every cycle was run failing before its implementation and then passing. The initial tracer failed because the route module did not exist; subsequent failures were missing behavior or incorrect observable response data/status.

`PATH=/opt/homebrew/bin:$PATH` is required here because the installed SQLite native module targets the ARM Node runtime. `npm run typecheck` precedes `npm run test`. The initial complete test run passed application tests but the existing WebSocket proxy test could not bind a socket under the sandbox (`listen EPERM`); the complete suite passes with local socket permission.

## Boundaries

No Notifications UI, refresh loop, proactive access cleanup, bounded physical expiry deletion, email changes or production authentication are introduced. The buyer destination is a JSON resource intended for the later UI, not a new rendered Purchase screen. Navigation here is verified at destination loader boundaries; browser layout/navigation verification remains required with the UI and integrated verification slices. The existing development identity cookie is a test facility, not trusted production authentication. List/count authorization currently evaluates the retained recipient history; no production-scale performance claim is made.
