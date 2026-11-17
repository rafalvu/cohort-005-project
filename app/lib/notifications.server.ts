import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { notifications } from "~/db/schema";

type Database = BetterSQLite3Database<typeof schema>;

export type NotificationEvent = { sourceEventKey: string } & (
  | { kind: "question_created"; lessonId: number; questionId: number }
  | {
      kind: "reply_created";
      lessonId: number;
      questionId: number;
      replyId: number;
    }
  | {
      kind: "refund_requested" | "refund_approved" | "refund_declined";
      refundRequestId: number;
      purchaseId: number;
    }
  | { kind: "seat_claimed"; teamId: number; seatId: number }
);

/**
 * Storage boundary only. Producers must pass their source transaction so failure
 * rolls back the action too. This nested synchronous transaction also makes a
 * standalone multi-recipient write atomic. No network work belongs here.
 * Stable source identities and source retry guards remain the producer's duty.
 */
export function createNotifications(
  db: Database,
  event: NotificationEvent,
  recipientIds: readonly number[],
  now = new Date()
) {
  const createdAt = now.toISOString();
  return db.transaction((tx) => {
    const created = [];
    for (const recipientId of new Set(recipientIds)) {
      const row = tx
        .insert(notifications)
        .values({ ...event, recipientId, createdAt })
        .onConflictDoNothing({
          target: [notifications.sourceEventKey, notifications.recipientId],
        })
        .returning()
        .get();
      if (row) created.push(row);
    }
    return created;
  });
}

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.number().int().positive(),
});
const pageSchema = z.object({
  recipientId: z.number().int().positive(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.nullish(),
});
export type NotificationCursor = z.infer<typeof cursorSchema>;

/** Internal storage paging, NOT an authorized application read API.
 * The later lifecycle layer must enforce current access and retention before
 * exposing Notifications, counts or pagination to a recipient.
 */
export function listStoredNotifications(
  db: Database,
  input: z.input<typeof pageSchema>
) {
  const { recipientId, limit, cursor } = pageSchema.parse(input);
  const rows = db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        cursor
          ? or(
              lt(notifications.createdAt, cursor.createdAt),
              and(
                eq(notifications.createdAt, cursor.createdAt),
                lt(notifications.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
