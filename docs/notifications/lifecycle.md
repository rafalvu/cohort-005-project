# Notifications access and retention (#18)

Baseline: `35aca5d53fbca34a8b228085fab7ea6c5fd27acd` (accepted #17).
The existing feature activation gate remains unchanged.

## Persistent access and source changes

Platform Admin role changes and refund approval prune the affected recipient's
inaccessible Notifications synchronously inside the source transaction. The
check retains any remaining course ownership, Platform Admin, or Enrollment
capacity. A Claimed Seat that preserves Enrollment therefore preserves discussion
history. Buyer refund outcomes depend on Purchase ownership, not Enrollment.
Soft deletion removes the deleted question's Notification or the deleted reply's
Notification in the same transaction. A deleted question remains a placeholder
for surviving replies. Existing Notification foreign-key cascades handle physical
source deletion, including lessons, comments, Purchases, Refund Requests, Seats,
teams, and recipients. These operations never delete domain data as cleanup.

The persistent authorization predicate deliberately excludes request country/PPP.
A temporary country restriction hides history in all read interfaces but does not
erase it. Restoring access cannot reconstruct already deleted Notifications;
cleanup contains no producer or backfill behavior.

There is currently no team-membership removal or course-ownership reassignment
route. Out-of-band persistent changes are caught by the bounded sweep. Future
access mutation routes must call `pruneRecipientNotifications` for affected people
inside their source transaction, before access can be restored. An external edit
that removes and restores access entirely between sweeps cannot be observed by
request cleanup; operators performing such changes must use the same pruning
boundary during the access change.

## Bounded request cleanup and exact expiry

Authenticated app-layout requests and authenticated Notifications loader/actions
perform cleanup. Each invocation deletes up to 100 expired rows using the expiry
index, then examines at most 100 remaining rows in increasing row-ID order for
persistent eligibility. A per-database sweep cursor advances over eligible rows
and wraps at the end, so valid history does not permanently block stale history.
The cursor is disposable process state: a server restart safely restarts scanning.
Up to 200 Notifications can be deleted per invocation; a page and its child loader
may each invoke cleanup. No scheduler, timer, migration, or new service is needed.
The bound is on Notifications examined/deleted; existing authorization lookups and
list/count queries are not claimed to have constant database cost.

Every interface excludes creation times at or before current UTC time minus
exactly 90 × 24 hours. Reading changes only `readAt`, never `createdAt`. List/detail
eligibility is rechecked after asynchronous authorization; read operations also
recheck before writing, including individual rows in Mark all. This prevents a
request crossing the expiry instant from exposing or acknowledging expired rows.

An idle database can retain physically expired rows indefinitely. They remain
invisible, and later requests progressively delete them. Read and unread rows
expire identically. Empty eligible history means an empty list and zero unread
count; course progress, comments and refund/unanswered task queues keep their own
lifecycles.

## Verification

`app/test/notification-reads.test.ts` uses actual route boundaries with migrated
SQLite. Added red→green slices cover proactive role loss and restoration,
refund-triggered Enrollment loss, deleted question placeholders and reply deletion,
exact UTC expiry and bounded physical deletion, sweep progress past eligible rows,
and crossing the expiry instant during authorization. Additional regression cases
cover overlapping Platform Admin/owner/Claimed Seat access, team membership
restoration, ordinary app requests, and temporary PPP restrictions.

No UI or production provisioning is included. The development identity model and
feature-release requirements remain those documented in the parent specification.

Validation completed in order with the ARM runtime (`PATH=/opt/homebrew/bin:$PATH`):
`npm run typecheck` passed; `npm run test` passed all 480 tests in 21 files.
The full suite required local socket permission for the existing WebSocket proxy
test. The earlier discussion producer test now expects deleted reply history to
be removed, while continuing to assert that the unanswered queue returns without
creating a new Notification. React route review found no component/hook changes;
cleanup imports remain server-only.
