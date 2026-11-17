import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createTestDb, seedBaseData } from "./setup";
import * as schema from "~/db/schema";

it("migrates an existing database without changing domain rows or backfilling Notifications", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cadence-migration-"));
  const oldMigrations = path.join(dir, "drizzle");
  mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8")
  ) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.idx < 12);
  writeFileSync(
    path.join(oldMigrations, "meta/_journal.json"),
    JSON.stringify(journal)
  );
  for (const entry of journal.entries)
    copyFileSync(
      `drizzle/${entry.tag}.sql`,
      path.join(oldMigrations, `${entry.tag}.sql`)
    );
  const filename = path.join(dir, "existing.db");
  const previous = createTestDb({ filename, migrationsFolder: oldMigrations });
  try {
    const { user, course } = seedBaseData(previous);
    const module = previous
      .insert(schema.modules)
      .values({ courseId: course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    const lesson = previous
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "First lesson", position: 1 })
      .returning()
      .get();
    // Use the historical SQL shape: today's comment model has additional columns.
    const questionId = previous.$client
      .prepare(
        "INSERT INTO comments (lesson_id, user_id, body, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        lesson.id,
        user.id,
        "Existing question",
        new Date().toISOString()
      ).lastInsertRowid;
    const purchase = previous
      .insert(schema.purchases)
      .values({
        userId: user.id,
        courseId: course.id,
        amountPaid: 7900,
        country: "PL",
      })
      .returning()
      .get();
    previous
      .insert(schema.enrollments)
      .values({ userId: user.id, courseId: course.id })
      .run();
    previous
      .insert(schema.lessonProgress)
      .values({
        userId: user.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    previous
      .insert(schema.videoWatchEvents)
      .values({
        userId: user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 42,
      })
      .run();
    previous.$client
      .prepare(
        "INSERT INTO comments (lesson_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        lesson.id,
        user.id,
        questionId,
        "Existing reply",
        new Date().toISOString()
      );
    previous
      .insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        reason: "Existing reason",
        status: schema.RefundStatus.Open,
      })
      .run();
    const team = previous.insert(schema.teams).values({}).returning().get();
    previous
      .insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: user.id,
        role: schema.TeamMemberRole.Admin,
      })
      .run();
    previous
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: course.id,
        purchaseId: purchase.id,
        code: "EXISTING-SEAT",
      })
      .run();
    const tables = [
      schema.users,
      schema.categories,
      schema.courses,
      schema.modules,
      schema.lessons,
      schema.purchases,
      schema.enrollments,
      schema.lessonProgress,
      schema.videoWatchEvents,
      schema.refunds,
      schema.teams,
      schema.teamMembers,
      schema.coupons,
    ];
    const oldComments = previous.$client
      .prepare("SELECT * FROM comments")
      .all();
    const before = tables.map((table) => previous.select().from(table).all());
    previous.$client.close();
    const migrated = createTestDb({ filename });
    try {
      expect(
        tables.map((table) => migrated.select().from(table).all())
      ).toEqual(before);
      expect(
        migrated.$client
          .prepare(
            "SELECT id, lesson_id, user_id, parent_id, body, created_at, edited_at, deleted_at FROM comments"
          )
          .all()
      ).toEqual(oldComments);
      expect(migrated.select().from(schema.notifications).all()).toEqual([]);
      expect(migrated.$client.pragma("foreign_key_check")).toEqual([]);
      expect(migrated.$client.pragma("foreign_keys", { simple: true })).toBe(1);
      const indexes = migrated.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' ORDER BY name"
        )
        .all();
      expect(indexes).toEqual([
        { name: "notifications_event_recipient_idx" },
        { name: "notifications_expiry_idx" },
        { name: "notifications_recipient_order_idx" },
        { name: "notifications_unread_order_idx" },
      ]);
    } finally {
      migrated.$client.close();
    }
  } finally {
    if (previous.$client.open) previous.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
