import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { courses, enrollments, modules, lessons, purchases } from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { saveNote } from "~/lib/notes.server";
import { toggleBookmark } from "~/lib/bookmarks.server";
import { loader } from "./saved";

const database = vi.hoisted(() => ({
  current: undefined as TestDb | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    if (!database.current) throw new Error("No test database");
    return database.current;
  },
}));
let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  database.current = db;
});
afterEach(() => {
  db.$client.close();
  database.current = undefined;
});
async function args(userId: number | null) {
  const url = "http://localhost/saved";
  const headers = new Headers({ "CF-IPCountry": "US" });
  if (userId !== null)
    headers.set("Cookie", await setCurrentUserId(new Request(url), userId));
  return {
    request: new Request(url, { headers }),
    params: {},
    context: new RouterContextProvider(),
    url: new URL(url),
    pattern: "/saved",
  };
}

it.each([null, 999999])(
  "rejects signed-out or stale Saved identity %s",
  async (userId) => {
    await expect(loader(await args(userId))).rejects.toMatchObject({
      init: { status: 401 },
    });
  }
);

it("retains only the person's own Notes and Bookmarks after country restriction and Enrollment loss", async () => {
  const section = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "Section", position: 0 })
    .returning()
    .get();
  const lesson = db
    .insert(lessons)
    .values({ moduleId: section.id, title: "Lesson", position: 0 })
    .returning()
    .get();
  db.update(courses)
    .set({ price: 7900, pppEnabled: true })
    .where(eq(courses.id, base.course.id))
    .run();
  const now = new Date();
  await enrollStudent(
    db,
    base.user.id,
    base.course.id,
    now,
    fakeNotifications()
  );
  db.insert(purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      country: "IN",
      amountPaid: 7900,
    })
    .run();
  saveNote(db, base.user.id, lesson.id, "My retained Note", now);
  toggleBookmark(db, base.user.id, lesson.id, now);
  saveNote(db, base.instructor.id, lesson.id, "Other person's Note", now);
  toggleBookmark(db, base.instructor.id, lesson.id, now);
  const before = await loader(await args(base.user.id));
  expect(before.savedNotes).toHaveLength(1);
  expect(before.savedNotes[0]).toMatchObject({
    body: "My retained Note",
    lesson: { id: lesson.id },
  });
  expect(before.savedBookmarks).toHaveLength(1);
  db.delete(enrollments).where(eq(enrollments.userId, base.user.id)).run();
  expect(await loader(await args(base.user.id))).toEqual(before);
});
