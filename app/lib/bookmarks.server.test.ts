import { fixtureModule, fixtureLesson, fixturePerson } from "~/test/fixtures";
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { UserRole } from "~/db/schema";
import {
  isBookmarked,
  listBookmarks,
  toggleBookmark,
} from "./bookmarks.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfterNow(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = fixtureModule(db, {
    courseId: base.course.id,
    title: "Basics",
    position: 1,
  });

  lessonIds = [1, 2].map(
    (position) =>
      fixtureLesson(db, {
        moduleId: module.id,
        title: `Lesson ${position}`,
        position,
      }).id
  );
});

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson with no Bookmark", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
  });

  it("removes the Bookmark when toggled again", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on the same Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("listing Bookmarks", () => {
  it("lists only the Student's own Bookmarks, newest first, with their Lesson and Course", () => {
    const other = fixturePerson(db, {
      name: "Other",
      email: "other@example.com",
      role: UserRole.Student,
    });
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], minutesAfterNow(5));
    toggleBookmark(db, other.id, lessonIds[0], minutesAfterNow(10));

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      {
        lesson: {
          id: lessonIds[1],
          title: "Lesson 2",
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
      {
        lesson: {
          id: lessonIds[0],
          title: "Lesson 1",
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
    ]);
  });
});
