import { enrollStudent } from "./enrollments.server";
import {
  fixtureModule,
  fixtureLesson,
  fixturePerson,
  fixturePurchase,
} from "~/test/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  getLessonSavedState,
  getSavedLessons,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const LATER = new Date("2026-11-02T12:00:00.000Z");
const LATEST = new Date("2026-11-03T12:00:00.000Z");
let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let firstLesson: typeof schema.lessons.$inferSelect;
let secondLesson: typeof schema.lessons.$inferSelect;
let otherStudent: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = fixtureModule(db, {
    courseId: base.course.id,
    title: "Basics",
    position: 1,
  });
  firstLesson = fixtureLesson(db, {
    moduleId: module.id,
    title: "First lesson",
    position: 1,
  });
  secondLesson = fixtureLesson(db, {
    moduleId: module.id,
    title: "Second lesson",
    position: 2,
  });
  otherStudent = fixturePerson(db, {
    name: "Another Student",
    email: "another@example.com",
    role: schema.UserRole.Student,
  });
});

afterEach(() => db.$client.close());

describe("Bookmarks and Notes", () => {
  it("starts empty, toggles a Bookmark on and off, and never duplicates it", () => {
    expect(getLessonSavedState(db, base.user.id, firstLesson.id)).toEqual({
      bookmarked: false,
      note: null,
    });
    expect(toggleBookmark(db, base.user.id, firstLesson.id, NOW)).toBe(true);
    expect(
      getLessonSavedState(db, base.user.id, firstLesson.id).bookmarked
    ).toBe(true);
    expect(toggleBookmark(db, base.user.id, firstLesson.id, LATER)).toBe(false);
    expect(getSavedLessons(db, base.user.id).savedBookmarks).toEqual([]);
    toggleBookmark(db, base.user.id, firstLesson.id, LATEST);
    expect(getSavedLessons(db, base.user.id).savedBookmarks).toHaveLength(1);
  });

  it("trims a Note while preserving plain text, Markdown characters and line breaks", () => {
    expect(
      saveNote(
        db,
        base.user.id,
        firstLesson.id,
        "  # My thought\n*Keep this literal*  ",
        NOW
      )
    ).toEqual({ ok: true });
    expect(getLessonSavedState(db, base.user.id, firstLesson.id).note).toEqual({
      body: "# My thought\n*Keep this literal*",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces one Note and advances last edited without changing its creation time", () => {
    saveNote(db, base.user.id, firstLesson.id, "Original", NOW);
    saveNote(db, base.user.id, firstLesson.id, "Revised", LATER);
    expect(getLessonSavedState(db, base.user.id, firstLesson.id).note).toEqual({
      body: "Revised",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(getSavedLessons(db, base.user.id).savedNotes).toHaveLength(1);
  });

  it("accepts exactly 2,000 trimmed characters and refuses 2,001 without overwriting the Note", () => {
    expect(
      saveNote(db, base.user.id, firstLesson.id, `  ${"a".repeat(2000)}  `, NOW)
    ).toEqual({ ok: true });
    expect(
      saveNote(db, base.user.id, firstLesson.id, "b".repeat(2001), LATER)
    ).toEqual({ ok: false, error: "Note must be 2,000 characters or fewer." });
    expect(
      getLessonSavedState(db, base.user.id, firstLesson.id).note
    ).toMatchObject({ body: "a".repeat(2000), updatedAt: NOW.toISOString() });
  });

  it("keeps each Student's Lesson state private, including when they edit or empty a Note", () => {
    toggleBookmark(db, base.user.id, firstLesson.id, NOW);
    saveNote(db, base.user.id, firstLesson.id, "Private", NOW);
    expect(getLessonSavedState(db, otherStudent.id, firstLesson.id)).toEqual({
      bookmarked: false,
      note: null,
    });
    expect(getSavedLessons(db, base.instructor.id)).toEqual({
      savedBookmarks: [],
      savedNotes: [],
    });
    const platformAdmin = fixturePerson(db, {
      name: "Platform Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    });
    expect(getSavedLessons(db, platformAdmin.id)).toEqual({
      savedBookmarks: [],
      savedNotes: [],
    });
    saveNote(db, otherStudent.id, firstLesson.id, "Their own thought", LATER);
    saveNote(db, otherStudent.id, firstLesson.id, "  \n ", LATEST);
    expect(
      getLessonSavedState(db, otherStudent.id, firstLesson.id).note
    ).toEqual({
      body: "",
      createdAt: LATER.toISOString(),
      updatedAt: LATEST.toISOString(),
    });
    expect(
      getLessonSavedState(db, base.user.id, firstLesson.id).note?.body
    ).toBe("Private");
  });

  it("lists only the Student's rows, newest first, with Lesson and Course references", () => {
    toggleBookmark(db, base.user.id, firstLesson.id, NOW);
    toggleBookmark(db, base.user.id, secondLesson.id, LATER);
    saveNote(db, base.user.id, firstLesson.id, "First", NOW);
    saveNote(db, base.user.id, secondLesson.id, "Second", LATER);
    saveNote(db, base.user.id, firstLesson.id, "Edited first", LATEST);
    toggleBookmark(db, otherStudent.id, firstLesson.id, LATEST);
    saveNote(
      db,
      otherStudent.id,
      firstLesson.id,
      "Someone else's Note",
      LATEST
    );

    const saved = getSavedLessons(db, base.user.id);
    expect(saved.savedBookmarks.map((row) => row.lessonTitle)).toEqual([
      "Second lesson",
      "First lesson",
    ]);
    expect(saved.savedNotes.map((row) => row.body)).toEqual([
      "Edited first",
      "Second",
    ]);
    for (const row of [...saved.savedBookmarks, ...saved.savedNotes]) {
      expect(row).toMatchObject({
        courseId: base.course.id,
        courseTitle: "Test Course",
        courseSlug: "test-course",
        moduleTitle: "Basics",
      });
      expect([firstLesson.id, secondLesson.id]).toContain(row.lessonId);
    }
  });

  it("keeps Bookmarks and Notes after an approved Refund so a returning Student can recover them", async () => {
    const notifications = fakeNotifications();
    const platformAdmin = fixturePerson(db, {
      name: "Platform Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    });
    const purchase = fixturePurchase(db, {
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      createdAt: NOW.toISOString(),
    });
    expect(
      await enrollStudent(db, base.user.id, base.course.id, NOW, notifications)
    ).toMatchObject({ ok: true });
    toggleBookmark(db, base.user.id, firstLesson.id, NOW);
    saveNote(db, base.user.id, firstLesson.id, "Keep for later", NOW);
    const before = getSavedLessons(db, base.user.id);

    const request = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not what I expected",
      LATER,
      notifications
    );
    if (!request.ok) throw new Error(request.error);
    expect(
      await approveRefundRequest(
        db,
        request.refundRequestId,
        platformAdmin.id,
        null,
        LATEST,
        notifications
      )
    ).toMatchObject({ ok: true });
    expect(getSavedLessons(db, base.user.id)).toEqual(before);
    // The refund removed Enrollment; a fresh Enrollment restores the same data.
    expect(
      await enrollStudent(
        db,
        base.user.id,
        base.course.id,
        LATEST,
        notifications
      )
    ).toMatchObject({ ok: true });
    expect(getLessonSavedState(db, base.user.id, firstLesson.id)).toMatchObject(
      { bookmarked: true, note: { body: "Keep for later" } }
    );
  });
});
