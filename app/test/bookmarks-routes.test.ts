import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LoaderFunction, ActionFunction } from "react-router";
import routes from "~/routes";
import { UserRole } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { createRouteHarness } from "~/test/routes";
import {
  fixtureCourse,
  fixtureLesson,
  fixtureModule,
  fixturePerson,
  fixturePurchase,
} from "~/test/fixtures";
import { enrollStudent } from "~/lib/enrollments.server";
import { approveRefundRequest, raiseRefundRequest } from "~/lib/refunds.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import * as bookmarks from "~/routes/bookmarks";
import * as lesson from "~/routes/courses.$slug.lessons.$lessonId";
import * as roster from "~/routes/instructor.$courseId.students";

let db: ReturnType<typeof createTestDb>;
// Replace the connection, not queries, sessions, access policy or services.
vi.mock("~/db", () => ({
  get db() {
    return db;
  },
}));

// Resolve paths from the real route configuration so a stale URL cannot pass.
function findRoute(file: string): string {
  function search(entries: typeof routes): string | undefined {
    for (const entry of entries) {
      if (entry.file === file && entry.path) return entry.path;
      if (entry.children) {
        const found = search(entry.children);
        if (found) return found;
      }
    }
  }
  const found = search(routes);
  if (!found) throw new Error(`Route not registered: ${file}`);
  return found;
}

const request = createRouteHarness([
  {
    id: "bookmarks",
    path: findRoute("routes/bookmarks.tsx"),
    loader: bookmarks.loader as LoaderFunction,
  },
  {
    id: "lesson",
    path: findRoute("routes/courses.$slug.lessons.$lessonId.tsx"),
    loader: lesson.loader as LoaderFunction,
    action: lesson.action as ActionFunction,
  },
  {
    id: "roster",
    path: findRoute("routes/instructor.$courseId.students.tsx"),
    loader: roster.loader as LoaderFunction,
  },
]);
const NOW = new Date("2026-11-19T12:00:00Z");
const PRIVATE_NOTE = "My private thought # literal *text*";
let base: ReturnType<typeof seedBaseData>;
let admin: ReturnType<typeof fixturePerson>;
let otherStudent: ReturnType<typeof fixturePerson>;
let visitor: ReturnType<typeof fixturePerson>;
let purchase: ReturnType<typeof fixturePurchase>;
let paidCourse: ReturnType<typeof fixtureCourse>;
let lessonPath: string;
let paidLessonPath: string;

beforeEach(async () => {
  db = createTestDb();
  base = seedBaseData(db);
  admin = fixturePerson(db, {
    name: "Platform Admin",
    email: "admin@example.com",
    role: UserRole.Admin,
  });
  otherStudent = fixturePerson(db, {
    name: "Other Student",
    email: "other@example.com",
    role: UserRole.Student,
  });
  visitor = fixturePerson(db, {
    name: "Unenrolled Student",
    email: "visitor@example.com",
    role: UserRole.Student,
  });
  const module = fixtureModule(db, {
    courseId: base.course.id,
    title: "Basics",
    position: 1,
  });
  const firstLesson = fixtureLesson(db, {
    moduleId: module.id,
    title: "First Lesson",
    position: 1,
  });
  lessonPath = `/courses/${base.course.slug}/lessons/${firstLesson.id}`;
  paidCourse = fixtureCourse(db, {
    title: "Paid Course",
    slug: "paid-course",
    description: "A second Course",
    salesCopy: "Learn more",
    categoryId: base.category.id,
    instructorId: base.instructor.id,
    status: base.course.status,
    price: 7900,
  });
  const paidModule = fixtureModule(db, {
    courseId: paidCourse.id,
    title: "Advanced",
    position: 1,
  });
  const paidLesson = fixtureLesson(db, {
    moduleId: paidModule.id,
    title: "Paid Lesson",
    position: 1,
  });
  paidLessonPath = `/courses/${paidCourse.slug}/lessons/${paidLesson.id}`;
  purchase = fixturePurchase(db, {
    userId: base.user.id,
    courseId: base.course.id,
    amountPaid: 7900,
    createdAt: NOW.toISOString(),
  });
  fixturePurchase(db, {
    userId: base.user.id,
    courseId: paidCourse.id,
    amountPaid: 3950,
    country: "IN",
    createdAt: NOW.toISOString(),
  });
  for (const [studentId, courseId] of [
    [base.user.id, base.course.id],
    [otherStudent.id, base.course.id],
    [base.user.id, paidCourse.id],
  ]) {
    const result = await enrollStudent(
      db,
      studentId,
      courseId,
      NOW,
      fakeNotifications()
    );
    if (!result.ok) throw new Error(result.error);
  }
});
afterEach(() => db.$client.close());

async function savePrivateNote(path = lessonPath, country = "US") {
  const response = await request(path, {
    studentId: base.user.id,
    country,
    form: { intent: "save-note", body: PRIVATE_NOTE },
  });
  expect(response.statusCode).toBe(200);
  expect(response.actionData?.lesson).toMatchObject({
    ok: true,
    noteSaved: true,
  });
}

it("registers /bookmarks and requires a signed-in Student", async () => {
  expect(findRoute("routes/bookmarks.tsx")).toBe("bookmarks");
  expect((await request("/bookmarks")).statusCode).toBe(401);
  expect(bookmarks.meta()).toContainEqual({
    title: "Bookmarks and Notes — Cadence",
  });
});

it("saves plain text and toggles a Bookmark through the Lesson action", async () => {
  await savePrivateNote();
  const options = {
    studentId: base.user.id,
    form: { intent: "toggle-bookmark" },
  };
  expect((await request(lessonPath, options)).actionData?.lesson).toMatchObject(
    { bookmarked: true }
  );
  const page = await request("/bookmarks", { studentId: base.user.id });
  expect(page.statusCode).toBe(200);
  expect(page.loaderData.bookmarks).toMatchObject({
    savedNotes: [
      {
        body: PRIVATE_NOTE,
        courseTitle: "Test Course",
        lessonTitle: "First Lesson",
      },
    ],
    savedBookmarks: [
      { courseTitle: "Test Course", lessonTitle: "First Lesson" },
    ],
  });
  expect((await request(lessonPath, options)).actionData?.lesson).toMatchObject(
    { bookmarked: false }
  );
  expect(
    (await request("/bookmarks", { studentId: base.user.id })).loaderData
      .bookmarks
  ).toMatchObject({ savedBookmarks: [] });
});

it("validates the 2,000-character boundary in direct POSTs without overwriting a Note", async () => {
  const accepted = "a".repeat(2000);
  expect(
    (
      await request(lessonPath, {
        studentId: base.user.id,
        form: { intent: "save-note", body: accepted },
      })
    ).statusCode
  ).toBe(200);
  const rejected = await request(lessonPath, {
    studentId: base.user.id,
    form: { intent: "save-note", body: "b".repeat(2001) },
  });
  expect(rejected.statusCode).toBe(400);
  expect(rejected.errors?.lesson).toMatchObject({
    data: "Note must be 2,000 characters or fewer.",
  });
  expect(
    (await request(lessonPath, { studentId: base.user.id })).loaderData.lesson
  ).toMatchObject({ note: { body: accepted } });
});

it("excludes private Note bodies from other Students' and staff loader responses", async () => {
  await savePrivateNote();
  const owner = await request(lessonPath, { studentId: base.user.id });
  expect(owner.loaderData.lesson).toMatchObject({
    note: { body: PRIVATE_NOTE },
  });
  const signedOut = await request(lessonPath);
  expect(signedOut.statusCode).toBe(200);
  expect(signedOut.loaderData.lesson).toMatchObject({
    note: null,
    bookmarked: false,
    canViewContent: false,
  });
  expect(JSON.stringify(signedOut.loaderData)).not.toContain(PRIVATE_NOTE);
  for (const person of [otherStudent, base.instructor, admin]) {
    const page = await request(lessonPath, { studentId: person.id });
    expect(page.statusCode).toBe(200);
    expect(page.loaderData.lesson).toMatchObject({ note: null });
    expect(JSON.stringify(page.loaderData)).not.toContain(PRIVATE_NOTE);
    const list = await request("/bookmarks", { studentId: person.id });
    expect(list.statusCode).toBe(200);
    expect(list.loaderData.bookmarks).toEqual({
      savedBookmarks: [],
      savedNotes: [],
    });
  }
  for (const person of [base.instructor, admin]) {
    const response = await request(`/instructor/${base.course.id}/students`, {
      studentId: person.id,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.loaderData)).toContain(base.user.name);
    expect(JSON.stringify(response.loaderData)).not.toContain(PRIVATE_NOTE);
  }
});

it.each(["toggle-bookmark", "save-note"])(
  "refuses signed-out and unenrolled direct %s requests",
  async (intent) => {
    const form = { intent, body: "Unauthorized" };
    expect((await request(lessonPath, { form })).statusCode).toBe(401);
    expect(
      (await request(lessonPath, { studentId: visitor.id, form })).statusCode
    ).toBe(403);
    expect(
      (await request("/bookmarks", { studentId: visitor.id })).loaderData
        .bookmarks
    ).toEqual({ savedBookmarks: [], savedNotes: [] });
  }
);

it.each(["toggle-bookmark", "save-note"])(
  "refuses %s for missing Lessons or a Lesson from another Course",
  async (intent) => {
    const form = { intent, body: "Wrong Course" };
    const mismatchedPath = paidLessonPath.replace(
      paidCourse.slug,
      base.course.slug
    );
    expect(
      (await request(mismatchedPath, { studentId: base.user.id, form }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await request(`/courses/${base.course.slug}/lessons/999999`, {
          studentId: base.user.id,
          form,
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await request(paidLessonPath, {
          studentId: base.user.id,
          country: "IN",
        })
      ).loaderData.lesson
    ).toMatchObject({ bookmarked: false, note: null });
  }
);

it("hides PPP-blocked data and refuses both write intents, then restores visibility in the purchase country", async () => {
  await savePrivateNote(paidLessonPath, "IN");
  expect(
    (
      await request(paidLessonPath, {
        studentId: base.user.id,
        country: "IN",
        form: { intent: "toggle-bookmark" },
      })
    ).statusCode
  ).toBe(200);
  const blocked = { studentId: base.user.id, country: "US" };
  expect(
    (await request(paidLessonPath, blocked)).loaderData.lesson
  ).toMatchObject({ note: null, bookmarked: false, canViewContent: false });
  expect((await request("/bookmarks", blocked)).loaderData.bookmarks).toEqual({
    savedBookmarks: [],
    savedNotes: [],
  });
  for (const intent of ["toggle-bookmark", "save-note"]) {
    expect(
      (
        await request(paidLessonPath, {
          ...blocked,
          form: { intent, body: "Denied" },
        })
      ).statusCode
    ).toBe(403);
  }
  expect(
    (await request("/bookmarks", { ...blocked, country: "IN" })).loaderData
      .bookmarks
  ).toMatchObject({
    savedNotes: [{ body: PRIVATE_NOTE }],
    savedBookmarks: [{ courseTitle: "Paid Course" }],
  });
});

it("hides refunded Course data, preserves other Courses, and restores the same Note and Bookmark after reenrollment", async () => {
  await savePrivateNote();
  await savePrivateNote(paidLessonPath, "IN");
  expect(
    (
      await request(lessonPath, {
        studentId: base.user.id,
        form: { intent: "toggle-bookmark" },
      })
    ).statusCode
  ).toBe(200);
  const before = (await request(lessonPath, { studentId: base.user.id }))
    .loaderData.lesson;
  const notifications = fakeNotifications();
  const raised = await raiseRefundRequest(
    db,
    purchase.id,
    base.user.id,
    "No longer needed",
    NOW,
    notifications
  );
  if (!raised.ok) throw new Error(raised.error);
  expect(
    await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      NOW,
      notifications
    )
  ).toMatchObject({ ok: true });
  const options = { studentId: base.user.id, country: "IN" };
  expect((await request(lessonPath, options)).loaderData.lesson).toMatchObject({
    note: null,
    bookmarked: false,
    canViewContent: false,
  });
  expect(
    (await request("/bookmarks", options)).loaderData.bookmarks
  ).toMatchObject({
    savedBookmarks: [],
    savedNotes: [{ courseTitle: "Paid Course", body: PRIVATE_NOTE }],
  });
  for (const intent of ["toggle-bookmark", "save-note"]) {
    expect(
      (
        await request(lessonPath, {
          ...options,
          form: { intent, body: "Denied" },
        })
      ).statusCode
    ).toBe(403);
  }
  expect(
    await enrollStudent(db, base.user.id, base.course.id, NOW, notifications)
  ).toMatchObject({ ok: true });
  const restored = (await request(lessonPath, options)).loaderData.lesson;
  expect(restored.note).toEqual(before.note);
  expect(restored.bookmarked).toBe(true);
});
