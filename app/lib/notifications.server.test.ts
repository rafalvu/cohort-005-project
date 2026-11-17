import * as schema from "~/db/schema";
import {
  createNotifications,
  listStoredNotifications,
} from "./notifications.server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, seedDiscussionData } from "~/test/setup";
import { notifications } from "~/db/schema";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.$client.close());
it("starts with empty Notifications and enforces recipient/event uniqueness", () => {
  const { user, lesson, question } = seedDiscussionData(db);
  expect(db.select().from(notifications).all()).toEqual([]);
  const row = {
    recipientId: user.id,
    sourceEventKey: "question:1",
    kind: "question_created" as const,
    questionId: question.id,
    lessonId: lesson.id,
  };
  db.insert(notifications).values(row).run();
  expect(() => db.insert(notifications).values(row).run()).toThrow();
});

it("creates recipient rows atomically inside the source transaction and only ignores event retries", () => {
  const { user, instructor, question, lesson } = seedDiscussionData(db);
  const event = {
    sourceEventKey: "question:1",
    kind: "question_created" as const,
    questionId: question.id,
    lessonId: lesson.id,
  };
  db.transaction((tx) =>
    createNotifications(tx, event, [user.id, instructor.id, user.id])
  );
  createNotifications(db, event, [user.id]);
  expect(db.select().from(notifications).all()).toHaveLength(2);
  expect(() =>
    db.transaction((tx) => {
      tx.insert(schema.users)
        .values({
          name: "Rolled back",
          email: "rollback@example.com",
          role: schema.UserRole.Student,
        })
        .run();
      createNotifications(tx, { ...event, sourceEventKey: "question:2" }, [
        user.id,
        99999,
      ]);
    })
  ).toThrow(/FOREIGN KEY/);
  expect(db.select().from(schema.users).all()).toHaveLength(2);
  expect(db.select().from(notifications).all()).toHaveLength(2);
});

it("pages equal timestamps deterministically without repeats when newer activity arrives", () => {
  const { user, instructor, question, lesson } = seedDiscussionData(db);
  const event = {
    kind: "question_created" as const,
    questionId: question.id,
    lessonId: lesson.id,
  };
  const now = new Date("2026-11-17T12:00:00.000Z");
  for (const key of ["one", "two", "three"])
    createNotifications(db, { ...event, sourceEventKey: key }, [user.id], now);
  createNotifications(
    db,
    { ...event, sourceEventKey: "private" },
    [instructor.id],
    now
  );
  const page = listStoredNotifications(db, { recipientId: user.id, limit: 2 });
  expect(page.rows.map((r) => r.sourceEventKey)).toEqual(["three", "two"]);
  createNotifications(db, { ...event, sourceEventKey: "four" }, [user.id], now);
  const last = listStoredNotifications(db, {
    recipientId: user.id,
    limit: 2,
    cursor: page.nextCursor,
  });
  expect(last.rows.map((r) => r.sourceEventKey)).toEqual(["one"]);
  expect(last.nextCursor).toBeNull();
  expect(() =>
    listStoredNotifications(db, { recipientId: user.id, limit: 0 })
  ).toThrow();
});

it("rejects invalid persisted contexts and non-UTC timestamps, and never reuses deleted row IDs", () => {
  const { user, lesson, question } = seedDiscussionData(db);
  const row = {
    recipientId: user.id,
    sourceEventKey: "question:1",
    kind: "question_created" as const,
    questionId: question.id,
    lessonId: lesson.id,
  };
  expect(() =>
    db
      .insert(notifications)
      .values({ ...row, questionId: null })
      .run()
  ).toThrow(/CHECK/);
  expect(() =>
    db
      .insert(notifications)
      .values({ ...row, sourceEventKey: " " })
      .run()
  ).toThrow(/CHECK/);
  expect(() =>
    db
      .insert(notifications)
      .values({ ...row, createdAt: "yesterday" })
      .run()
  ).toThrow(/CHECK/);
  expect(() =>
    db
      .insert(notifications)
      .values({ ...row, readAt: "2026-11-17T13:00:00+01:00" })
      .run()
  ).toThrow(/CHECK/);
  const first = db.insert(notifications).values(row).returning().get();
  db.delete(notifications).run();
  const next = db.insert(notifications).values(row).returning().get();
  expect(next.id).toBeGreaterThan(first.id);
});

it("persists typed discussion, refund and Seat contexts without copied content", () => {
  const { user, instructor, question, lesson, course } = seedDiscussionData(db);
  const reply = db
    .insert(schema.comments)
    .values({
      userId: instructor.id,
      lessonId: lesson.id,
      parentId: question.id,
      body: "Private reply",
    })
    .returning()
    .get();
  const purchase = db
    .insert(schema.purchases)
    .values({ userId: user.id, courseId: course.id, amountPaid: 7900 })
    .returning()
    .get();
  const request = db
    .insert(schema.refunds)
    .values({ purchaseId: purchase.id, reason: "Private reason" })
    .returning()
    .get();
  const team = db.insert(schema.teams).values({}).returning().get();
  const seat = db
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: course.id,
      purchaseId: purchase.id,
      code: "TEST-SEAT",
    })
    .returning()
    .get();
  createNotifications(
    db,
    {
      kind: "reply_created",
      sourceEventKey: "reply:1",
      lessonId: lesson.id,
      questionId: question.id,
      replyId: reply.id,
    },
    [user.id]
  );
  for (const kind of [
    "refund_requested",
    "refund_approved",
    "refund_declined",
  ] as const) {
    createNotifications(
      db,
      {
        kind,
        sourceEventKey: kind,
        purchaseId: purchase.id,
        refundRequestId: request.id,
      },
      [user.id]
    );
  }
  createNotifications(
    db,
    {
      kind: "seat_claimed",
      sourceEventKey: "seat:1",
      teamId: team.id,
      seatId: seat.id,
    },
    [user.id]
  );
  const rows = listStoredNotifications(db, { recipientId: user.id }).rows;
  expect(rows).toHaveLength(5);
  expect(rows.find((row) => row.kind === "reply_created")).toMatchObject({
    questionId: question.id,
    replyId: reply.id,
    lessonId: lesson.id,
    readAt: null,
  });
  expect(rows.find((row) => row.kind === "refund_approved")).toMatchObject({
    purchaseId: purchase.id,
    refundRequestId: request.id,
  });
  expect(rows.find((row) => row.kind === "seat_claimed")).toMatchObject({
    teamId: team.id,
    seatId: seat.id,
  });
  expect(JSON.stringify(rows)).not.toContain("Private");
  expect(() =>
    db.$client.prepare("UPDATE notifications SET kind = 'unknown'").run()
  ).toThrow(/CHECK/);
  expect(() =>
    db
      .insert(notifications)
      .values({
        recipientId: user.id,
        kind: "seat_claimed",
        sourceEventKey: "bad-seat",
        teamId: team.id,
        seatId: 99999,
      })
      .run()
  ).toThrow(/FOREIGN KEY/);
  expect(() =>
    createNotifications(
      db,
      {
        kind: "seat_claimed",
        sourceEventKey: "atomic-seat",
        teamId: team.id,
        seatId: seat.id,
      },
      [user.id, 99999]
    )
  ).toThrow(/FOREIGN KEY/);
  expect(
    listStoredNotifications(db, { recipientId: user.id }).rows
  ).toHaveLength(5);
});
