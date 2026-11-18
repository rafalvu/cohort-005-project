import { and, eq, or, sql, lte, inArray, gt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { notifications, UserRole, TeamMemberRole } from "~/db/schema";

type Database = BetterSQLite3Database<typeof schema>;

// Persistent access only: country/PPP restrictions belong to the recipient's
// request and must never erase history merely because someone travels.
const discussionAccess = sql`exists (
  select 1 from comments q
  join lessons l on l.id = q.lesson_id
  join modules m on m.id = l.module_id
  join courses c on c.id = m.course_id
  join users u on u.id = ${notifications.recipientId}
  where q.id = ${notifications.questionId}
    and l.id = ${notifications.lessonId} and q.parent_id is null
    and (u.role = ${UserRole.Admin} or c.instructor_id = u.id or exists (
      select 1 from enrollments e where e.user_id = u.id and e.course_id = c.id
    ))
    and ((${notifications.kind} = 'question_created' and q.deleted_at is null)
      or (${notifications.kind} = 'reply_created' and exists (
        select 1 from comments r where r.id = ${notifications.replyId}
          and r.parent_id = q.id and r.lesson_id = l.id and r.deleted_at is null
      )))
)`;

const persistentAccess = sql`(
  (${notifications.kind} in ('question_created', 'reply_created') and ${discussionAccess})
  or (${notifications.kind} in ('refund_requested', 'refund_approved', 'refund_declined') and exists (
    select 1 from refunds r join purchases p on p.id = r.purchase_id
    join users u on u.id = ${notifications.recipientId}
    where r.id = ${notifications.refundRequestId} and p.id = ${notifications.purchaseId}
      and ((${notifications.kind} = 'refund_requested' and u.role = ${UserRole.Admin})
        or (${notifications.kind} in ('refund_approved', 'refund_declined') and p.user_id = u.id))
  ))
  or (${notifications.kind} = 'seat_claimed' and exists (
    select 1 from coupons s join team_members tm on tm.team_id = s.team_id
    where s.id = ${notifications.seatId} and s.team_id = ${notifications.teamId}
      and s.redeemed_at is not null and tm.user_id = ${notifications.recipientId}
      and tm.role = ${TeamMemberRole.Admin}
  ))
)`;

/** Run in the access mutation's transaction; all remaining capacities count. */
export function pruneRecipientNotifications(db: Database, recipientId: number) {
  db.delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        sql`not ${persistentAccess}`
      )
    )
    .run();
}

/** A soft-deleted question remains a placeholder for live reply targets. */
export function pruneDeletedCommentNotifications(
  db: Database,
  commentId: number
) {
  db.delete(notifications)
    .where(
      or(
        and(
          eq(notifications.kind, "question_created"),
          eq(notifications.questionId, commentId)
        ),
        eq(notifications.replyId, commentId)
      )
    )
    .run();
}

export function notificationCutoff(now = new Date()) {
  return new Date(now.getTime() - 90 * 86400000).toISOString();
}

const sweepPositions = new WeakMap<Database, number>();

/** No timer: idle databases may retain expired rows, which reads still exclude. */
export function cleanupNotifications(db: Database, now = new Date()) {
  const expired = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(lte(notifications.createdAt, notificationCutoff(now)))
    .orderBy(notifications.createdAt, notifications.id)
    .limit(100)
    .all();
  if (expired.length)
    db.delete(notifications)
      .where(
        inArray(
          notifications.id,
          expired.map((row) => row.id)
        )
      )
      .run();
  // Keyset progress prevents a prefix of valid rows from starving stale rows.
  // A process restart safely restarts the sweep; no domain rows are touched.
  const batch = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(gt(notifications.id, sweepPositions.get(db) ?? 0))
    .orderBy(notifications.id)
    .limit(100)
    .all();
  if (batch.length)
    db.delete(notifications)
      .where(
        and(
          inArray(
            notifications.id,
            batch.map((row) => row.id)
          ),
          sql`not ${persistentAccess}`
        )
      )
      .run();
  sweepPositions.set(db, batch.length === 100 ? (batch.at(-1)?.id ?? 0) : 0);
}
