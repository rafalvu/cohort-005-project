import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import * as schema from "~/db/schema";
import { listBookmarks } from "~/lib/bookmarks.server";
import { logError } from "~/lib/log.server";
import { listNotes } from "~/lib/notes.server";
import { readPage, PAGE_SIZE } from "~/lib/pagination";
import { listRefundRequestsForReview } from "~/lib/refunds.server";
import { studentRoster } from "~/lib/student-roster.server";
import { plainText } from "~/lib/text";
import { formId } from "~/lib/validation";
import { createTestDb, seedBaseData } from "./setup";

it("rejects invalid IDs and page offsets at the boundary", () => {
  for (const value of [
    undefined,
    "",
    " ",
    "0",
    "-1",
    "1.5",
    "9".repeat(25),
    "12x",
  ]) {
    expect(formId.safeParse(value).success).toBe(false);
    expect(
      readPage(new URL("https://test.invalid/?page=" + String(value)))
    ).toBe(1);
  }
  expect(formId.parse("42")).toBe(42);
  expect(readPage(new URL("https://test.invalid/?page=2"))).toBe(2);
});

it("persists whole cents and canonical UTC timestamps for courses, purchases, and refunds", () => {
  const db = createTestDb();
  const { course, user } = seedBaseData(db);
  const buy = (amountPaid: number) =>
    db
      .insert(schema.purchases)
      .values({ userId: user.id, courseId: course.id, amountPaid })
      .returning()
      .get();
  expect(() =>
    db
      .update(schema.courses)
      .set({ price: 1.25 })
      .where(eq(schema.courses.id, course.id))
      .run()
  ).toThrow();
  expect(() => buy(1.25)).toThrow();
  const purchase = buy(1234);
  const refund = db
    .insert(schema.refunds)
    .values({ purchaseId: purchase.id, reason: "test" })
    .returning()
    .get();
  expect(() =>
    db
      .update(schema.refunds)
      .set({ amountRefunded: 1.25 })
      .where(eq(schema.refunds.id, refund.id))
      .run()
  ).toThrow();
  for (const value of [
    course.createdAt,
    purchase.createdAt,
    refund.requestedAt,
  ])
    expect(new Date(value).toISOString()).toBe(value);
  expect(purchase.amountPaid).toBe(1234);
});

it("retains stack and cause while redacting credentials from logged diagnostics", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("POSTMARK_SERVER_TOKEN", "dummy-value-only");
  try {
    logError(
      "provider failure",
      new Error("Authorization: Bearer test-credential", {
        cause: new Error("dummy-value-only"),
      })
    );
    const written = JSON.stringify(output.mock.calls);
    expect(written).toContain("Caused by");
    expect(written).toContain("standards.test");
    expect(written).not.toMatch(/test-credential|dummy-value-only/);
  } finally {
    vi.unstubAllEnvs();
    output.mockRestore();
  }
});

it("bounds each listing and keeps SQL statement counts constant as the page fills", () => {
  let count = 0;
  const db = createTestDb(() => count++);
  const { user, course } = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: course.id, title: "Module", position: 1 })
    .returning()
    .get();
  function addRow(i: number) {
    const learner = db
      .insert(schema.users)
      .values({
        role: schema.UserRole.Student,
        name: "Student " + i,
        email: i + "@example.test",
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: learner.id, courseId: course.id })
      .run();
    const lesson = db
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "Lesson " + i, position: i })
      .returning()
      .get();
    db.insert(schema.bookmarks)
      .values({ userId: user.id, lessonId: lesson.id })
      .run();
    db.insert(schema.notes)
      .values({
        userId: user.id,
        lessonId: lesson.id,
        body: plainText("a note"),
      })
      .run();
    const purchase = db
      .insert(schema.purchases)
      .values({ userId: learner.id, courseId: course.id, amountPaid: 100 })
      .returning()
      .get();
    db.insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "request" })
      .run();
  }
  const lists = [
    (page: number) =>
      studentRoster(db, course.id, page).students.map((s) => s.userId),
    (page: number) =>
      listRefundRequestsForReview(
        db,
        schema.RefundStatus.Open,
        new Date(),
        page
      ).items.map((r) => r.id),
    (page: number) => listNotes(db, user.id, page).items.map((r) => r.id),
    (page: number) => listBookmarks(db, user.id, page).items.map((r) => r.id),
  ];
  addRow(0);
  const counts = lists.map((read) => {
    count = 0;
    expect(read(1)).toHaveLength(1);
    return count;
  });
  for (let i = 1; i <= PAGE_SIZE; i++) addRow(i);
  lists.forEach((read, i) => {
    count = 0;
    const first = read(1);
    expect(count).toBe(counts[i]);
    expect(first).toHaveLength(PAGE_SIZE);
    const second = read(2);
    expect(second).toHaveLength(1);
    expect(first).not.toContain(second[0]);
  });
});
