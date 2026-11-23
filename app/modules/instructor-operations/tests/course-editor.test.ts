import { lessons } from "~/db/schema";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { getNote } from "~/lib/notes.server";
import { isBookmarked } from "~/lib/bookmarks.server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCourseEditor,
  updateCourseSettings,
  createCourseSection,
  renameCourseSection,
  reorderCourseSections,
  deleteCourseSection,
} from "../course-editor.server";
import { createTestDb, type TestDb } from "~/test/setup";
import {
  requestAs,
  seedEditor,
  populateLesson,
  demote,
} from "./course-editor-fixtures";

let db: TestDb;
let fixture: ReturnType<typeof seedEditor>;
beforeEach(() => {
  db = createTestDb();
  fixture = seedEditor(db);
});
afterEach(() => db.$client.close());

describe("course editor", () => {
  it("returns the owning Instructor's complete course curriculum", async () => {
    const editor = await getCourseEditor(
      db,
      await requestAs(fixture.instructor.id),
      String(fixture.course.id)
    );
    expect(editor).toMatchObject({
      course: {
        id: fixture.course.id,
        title: "Test Course",
        modules: [
          { title: "First section", lessons: [{ title: "First lesson" }] },
          { title: "Second section", lessons: [] },
        ],
      },
      lessonCount: 1,
      enrollmentCount: 0,
      students: [],
      quizCount: 0,
    });
  });
});

it("changes course settings while preserving integer-cent pricing", async () => {
  const request = await requestAs(fixture.instructor.id);
  await updateCourseSettings(db, request, fixture.course.id, {
    intent: "update-price",
    price: "12.345",
  });
  expect(
    (await getCourseEditor(db, request, fixture.course.id)).course.price
  ).toBe(1235);
});

it.each([
  [{ intent: "update-title", title: "  New title  " }, { title: "New title" }],
  [
    { intent: "update-description", description: "  New description  " },
    { description: "New description" },
  ],
  [{ intent: "update-status", status: "draft" }, { status: "draft" }],
  [
    { intent: "update-ppp-enabled", pppEnabled: "false" },
    { pppEnabled: false },
  ],
  [
    { intent: "update-sales-copy", salesCopy: "  ## New sales copy  " },
    { salesCopy: "## New sales copy" },
  ],
])("changes course setting %j", async (command, expected) => {
  const request = await requestAs(fixture.instructor.id);
  await updateCourseSettings(db, request, fixture.course.id, command);
  expect(
    (await getCourseEditor(db, request, fixture.course.id)).course
  ).toMatchObject(expected);
});

it("creates and renames curriculum sections in the owning course", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createCourseSection(db, request, fixture.course.id, {
    title: "  Third section  ",
  });
  const editor = await getCourseEditor(db, request, fixture.course.id);
  const section = editor.course.modules.at(-1);
  expect(section).toMatchObject({ title: "Third section", position: 3 });
  await renameCourseSection(db, request, fixture.course.id, {
    moduleId: section?.id,
    title: "  Revised section  ",
  });
  expect(
    (await getCourseEditor(db, request, fixture.course.id)).course.modules.at(
      -1
    )
  ).toMatchObject({ title: "Revised section", position: 3 });
});

it("reorders every section atomically", async () => {
  const request = await requestAs(fixture.instructor.id);
  await reorderCourseSections(db, request, fixture.course.id, {
    moduleIds: JSON.stringify([fixture.secondSection.id, fixture.section.id]),
  });
  expect(
    (await getCourseEditor(db, request, fixture.course.id)).course.modules.map(
      ({ title, position }) => ({ title, position })
    )
  ).toEqual([
    { title: "Second section", position: 1 },
    { title: "First section", position: 2 },
  ]);
});

it("deletes a populated section and archives only its discussion Notifications", async () => {
  const notifications = fakeNotifications();
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  expect(notifications.feedOf(fixture.instructor.id)).toHaveLength(1);
  await deleteCourseSection(
    db,
    await requestAs(fixture.instructor.id),
    fixture.course.id,
    { moduleId: fixture.section.id },
    notifications
  );
  expect(
    (
      await getCourseEditor(
        db,
        await requestAs(fixture.instructor.id),
        fixture.course.id
      )
    ).course.modules.map((section) => section.title)
  ).toEqual(["Second section"]);
  expect(getNote(db, fixture.user.id, fixture.lesson.id)).toBeUndefined();
  expect(isBookmarked(db, fixture.user.id, fixture.lesson.id)).toBe(false);
  expect(notifications.feedOf(fixture.instructor.id)).toEqual([]);
});

it("includes enrolled Student progress and best quiz scores in the guarded read", async () => {
  const notifications = fakeNotifications();
  await enrollStudent(
    db,
    fixture.user.id,
    fixture.course.id,
    new Date("2026-11-23"),
    notifications
  );
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  const editor = await getCourseEditor(
    db,
    await requestAs(fixture.admin.id),
    fixture.course.id
  );
  expect(editor).toMatchObject({
    enrollmentCount: 1,
    quizCount: 1,
    students: [
      {
        name: "Test User",
        email: "test@example.com",
        progress: 100,
        quizScores: [
          {
            quizTitle: "Lesson quiz",
            lessonTitle: "First lesson",
            bestScore: 1,
            passed: true,
          },
        ],
      },
    ],
  });
});

const operations = [
  {
    name: "read",
    call: (request: Request, courseId: unknown) =>
      getCourseEditor(db, request, courseId),
  },
  {
    name: "settings",
    call: (request: Request, courseId: unknown) =>
      updateCourseSettings(db, request, courseId, {
        intent: "update-title",
        title: "Changed",
      }),
  },
  {
    name: "create section",
    call: (request: Request, courseId: unknown) =>
      createCourseSection(db, request, courseId, { title: "New" }),
  },
  {
    name: "rename section",
    call: (request: Request, courseId: unknown) =>
      renameCourseSection(db, request, courseId, {
        moduleId: fixture.section.id,
        title: "Changed",
      }),
  },
  {
    name: "reorder sections",
    call: (request: Request, courseId: unknown) =>
      reorderCourseSections(db, request, courseId, {
        moduleIds: JSON.stringify([
          fixture.secondSection.id,
          fixture.section.id,
        ]),
      }),
  },
  {
    name: "delete section",
    call: (request: Request, courseId: unknown) =>
      deleteCourseSection(
        db,
        request,
        courseId,
        { moduleId: fixture.section.id },
        fakeNotifications()
      ),
  },
];

for (const operation of operations) {
  describe(operation.name, () => {
    it.each([undefined, 99999])(
      "authenticates live identity %s before invalid input",
      async (userId) => {
        const before = db.$client.serialize();
        await expect(
          operation.call(await requestAs(userId), "invalid")
        ).rejects.toMatchObject({ init: { status: 401 } });
        expect(db.$client.serialize()).toEqual(before);
      }
    );
    it.each(["1junk", "", 0, -1, 1.5, true, null, 9007199254740992])(
      "rejects malformed course identifier %s before checking authority",
      async (courseId) => {
        await expect(
          operation.call(await requestAs(fixture.user.id), courseId)
        ).rejects.toMatchObject({ init: { status: 400 } });
      }
    );
    it("returns 404 for missing courses even to a Platform Admin", async () => {
      await expect(
        operation.call(await requestAs(fixture.admin.id), 99999)
      ).rejects.toMatchObject({ init: { status: 404 } });
    });
    it("rejects unrelated Instructors without changing records", async () => {
      const before = db.$client.serialize();
      await expect(
        operation.call(
          await requestAs(fixture.otherInstructor.id),
          fixture.course.id
        )
      ).rejects.toMatchObject({ init: { status: 403 } });
      expect(db.$client.serialize()).toEqual(before);
    });
    it("rejects a demoted owner even with Enrollment", async () => {
      await enrollStudent(
        db,
        fixture.instructor.id,
        fixture.course.id,
        new Date(),
        fakeNotifications()
      );
      const request = await requestAs(fixture.instructor.id);
      demote(db, fixture.instructor.id);
      const before = db.$client.serialize();
      await expect(
        operation.call(request, fixture.course.id)
      ).rejects.toMatchObject({ init: { status: 403 } });
      expect(db.$client.serialize()).toEqual(before);
    });
    it("permits Platform Admin management without Enrollment", async () => {
      await expect(
        operation.call(await requestAs(fixture.admin.id), fixture.course.id)
      ).resolves.toBeDefined();
    });
  });
}

it.each([
  { intent: "unknown" },
  { intent: "update-title", title: " " },
  { intent: "update-description", description: " " },
  { intent: "update-status", status: "bad" },
  { intent: "update-price", price: "12garbage" },
  { intent: "update-price", price: "Infinity" },
  { intent: "update-price", price: "" },
  { intent: "update-price", price: "-1" },
  { intent: "update-price", price: "10000" },
  { intent: "update-ppp-enabled", pppEnabled: "yes" },
  { intent: "update-sales-copy", salesCopy: " " },
])(
  "rejects malformed setting %j before authority and leaves records unchanged",
  async (command) => {
    const before = db.$client.serialize();
    await expect(
      updateCourseSettings(
        db,
        await requestAs(fixture.user.id),
        fixture.course.id,
        command
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each([
  "broken JSON",
  "null",
  "{}",
  "[1,1]",
  "[0]",
  "[-1]",
  "[1.5]",
  '["1"]',
  "[]",
])(
  "rejects malformed/incomplete reorder %s without writes",
  async (moduleIds) => {
    const before = db.$client.serialize();
    await expect(
      reorderCourseSections(
        db,
        await requestAs(fixture.instructor.id),
        fixture.course.id,
        { moduleIds }
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each(["foreign", "missing"])(
  "rejects every member of a %s-section reorder before any update",
  async (kind) => {
    const before = db.$client.serialize();
    const moduleIds = JSON.stringify([
      fixture.secondSection.id,
      kind === "foreign" ? fixture.otherSection.id : 99999,
    ]);
    await expect(
      reorderCourseSections(
        db,
        await requestAs(fixture.admin.id),
        fixture.course.id,
        { moduleIds }
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each(["rename", "delete"])(
  "rejects a foreign-section %s before checking permission and preserves Notifications",
  async (operation) => {
    const notifications = fakeNotifications();
    await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
    const before = db.$client.serialize();
    const feed = notifications.feedOf(fixture.instructor.id);
    const request = await requestAs(fixture.user.id);
    const command = { moduleId: fixture.otherSection.id, title: "Changed" };
    await expect(
      operation === "rename"
        ? renameCourseSection(db, request, fixture.course.id, command)
        : deleteCourseSection(
            db,
            request,
            fixture.course.id,
            command,
            notifications
          )
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.feedOf(fixture.instructor.id)).toEqual(feed);
    expect(notifications.sent).toHaveLength(1);
  }
);

it("rolls back populated-section deletion if a later local write fails and keeps Notifications", async () => {
  const notifications = fakeNotifications();
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  db.$client.exec(
    "CREATE TRIGGER stop_section_delete BEFORE DELETE ON modules BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END"
  );
  const before = db.$client.serialize();
  const feed = notifications.feedOf(fixture.instructor.id);
  await expect(
    deleteCourseSection(
      db,
      await requestAs(fixture.instructor.id),
      fixture.course.id,
      { moduleId: fixture.section.id },
      notifications
    )
  ).rejects.toThrow("Simulated write failure");
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.feedOf(fixture.instructor.id)).toEqual(feed);
});

it("rolls back earlier section positions if a later reorder write fails", async () => {
  db.$client.exec(
    `CREATE TRIGGER stop_section_reorder BEFORE UPDATE ON modules WHEN NEW.id = ${fixture.section.id} BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END`
  );
  const before = db.$client.serialize();
  await expect(
    reorderCourseSections(
      db,
      await requestAs(fixture.instructor.id),
      fixture.course.id,
      {
        moduleIds: JSON.stringify([
          fixture.secondSection.id,
          fixture.section.id,
        ]),
      }
    )
  ).rejects.toThrow("Simulated write failure");
  expect(db.$client.serialize()).toEqual(before);
});

it("deleting one populated section preserves the other course and its Notifications", async () => {
  const notifications = fakeNotifications();
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  const otherLesson = db
    .insert(lessons)
    .values({
      moduleId: fixture.otherSection.id,
      title: "Unrelated lesson",
      position: 1,
    })
    .returning()
    .get();
  await populateLesson(db, otherLesson.id, fixture.user.id, notifications);
  const otherEditor = await getCourseEditor(
    db,
    await requestAs(fixture.admin.id),
    fixture.otherCourse.id
  );
  const otherNote = getNote(db, fixture.user.id, otherLesson.id);
  const feed = notifications.feedOf(fixture.otherInstructor.id);
  await deleteCourseSection(
    db,
    await requestAs(fixture.admin.id),
    fixture.course.id,
    { moduleId: fixture.section.id },
    notifications
  );
  expect(
    await getCourseEditor(
      db,
      await requestAs(fixture.admin.id),
      fixture.otherCourse.id
    )
  ).toEqual(otherEditor);
  expect(getNote(db, fixture.user.id, otherLesson.id)).toEqual(otherNote);
  expect(isBookmarked(db, fixture.user.id, otherLesson.id)).toBe(true);
  expect(notifications.feedOf(fixture.otherInstructor.id)).toEqual(feed);
});
