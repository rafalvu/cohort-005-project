import { and, eq, or, sql, lte, inArray, gt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { notifications } from "~/db/schema";

import { persistentNotificationAccess } from "~/lib/notification-access.server";

type Database = BetterSQLite3Database<typeof schema>;

/** Run in the access mutation's transaction; all remaining capacities count. */
export function pruneRecipientNotifications(db: Database, recipientId: number) {
  db.delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        sql`not ${persistentNotificationAccess}`
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
          sql`not ${persistentNotificationAccess}`
        )
      )
      .run();
  sweepPositions.set(db, batch.length === 100 ? (batch.at(-1)?.id ?? 0) : 0);
}
