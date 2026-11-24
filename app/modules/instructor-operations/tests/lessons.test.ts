import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createLesson,
  renameLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  moveLesson,
  getLessonEditor,
  getCurriculumSectionEditor,
} from "../lessons.server";
import { createTestDb, type TestDb } from "~/test/setup";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import {
  demote,
  populateLesson,
  requestAs,
  seedEditor,
} from "./course-editor-fixtures";
import { enrollStudent } from "~/lib/enrollments.server";

let db: TestDb;
let fixture: ReturnType<typeof seedEditor>;
let notifications: ReturnType<typeof fakeNotifications>;
beforeEach(() => {
  db = createTestDb();
  fixture = seedEditor(db);
  notifications = fakeNotifications();
});
afterEach(() => db.$client.close());

it("lets the current owning Instructor inspect the full lesson editor with its quiz", async () => {
  const { quiz } = await populateLesson(
    db,
    fixture.lesson.id,
    fixture.user.id,
    notifications
  );
  expect(
    await getLessonEditor(
      db,
      await requestAs(fixture.instructor.id),
      fixture.course.id,
      fixture.lesson.id
    )
  ).toMatchObject({
    course: { id: fixture.course.id, title: fixture.course.title },
    module: { id: fixture.section.id },
    lesson: {
      id: fixture.lesson.id,
      title: "First lesson",
      durationMinutes: 5,
    },
    quiz: { id: quiz.id, lessonId: fixture.lesson.id },
  });
});

it("lets a Platform Admin inspect a curriculum section with lesson totals and Instructor details", async () => {
  expect(
    await getCurriculumSectionEditor(
      db,
      await requestAs(fixture.admin.id),
      fixture.course.id,
      fixture.section.id
    )
  ).toMatchObject({
    course: {
      id: fixture.course.id,
      title: fixture.course.title,
      slug: fixture.course.slug,
      instructorName: fixture.instructor.name,
      instructorBio: fixture.instructor.bio,
      instructorAvatarUrl: fixture.instructor.avatarUrl,
    },
    module: {
      id: fixture.section.id,
      lessons: [
        { id: fixture.lesson.id, title: "First lesson", durationMinutes: 5 },
      ],
    },
    totalLessons: 1,
    totalDuration: 5,
  });
});

it("creates a trimmed lesson at the end of its actual curriculum section", async () => {
  const request = await requestAs(fixture.instructor.id);
  expect(
    await createLesson(db, request, fixture.course.id, {
      moduleId: fixture.section.id,
      title: "  New lesson  ",
    })
  ).toEqual({ success: true, field: "lesson" });
  expect(
    await getCurriculumSectionEditor(
      db,
      request,
      fixture.course.id,
      fixture.section.id
    )
  ).toMatchObject({
    module: {
      lessons: [
        { title: "First lesson", position: 1 },
        {
          title: "New lesson",
          position: 2,
          content: null,
          videoUrl: null,
          durationMinutes: null,
          githubRepoUrl: null,
        },
      ],
    },
    totalLessons: 2,
  });
});

it("lets a Platform Admin rename an existing lesson without changing its other fields", async () => {
  const request = await requestAs(fixture.admin.id);
  expect(
    await renameLesson(db, request, fixture.course.id, {
      lessonId: fixture.lesson.id,
      title: "  Renamed  ",
    })
  ).toEqual({ success: true, field: "lesson" });
  expect(
    (await getLessonEditor(db, request, fixture.course.id, fixture.lesson.id))
      .lesson
  ).toEqual({ ...fixture.lesson, title: "Renamed" });
});

it("updates every submitted lesson field and preserves fields omitted from later saves", async () => {
  const request = await requestAs(fixture.instructor.id);
  expect(
    await updateLesson(db, request, fixture.course.id, fixture.lesson.id, {
      intent: "update-lesson",
      title: "  New title  ",
      content: "# Lesson\n\nCode examples",
      videoUrl: " https://example.com/video ",
      githubRepoUrl: " https://github.com/example/course ",
      durationMinutes: "12",
    })
  ).toEqual({ success: true });
  const saved = await getLessonEditor(
    db,
    request,
    fixture.course.id,
    fixture.lesson.id
  );
  expect(saved.lesson).toMatchObject({
    title: "New title",
    content: "# Lesson\n\nCode examples",
    videoUrl: "https://example.com/video",
    githubRepoUrl: "https://github.com/example/course",
    durationMinutes: 12,
  });
  await updateLesson(db, request, fixture.course.id, fixture.lesson.id, {
    intent: "update-lesson",
    content: "Revised",
  });
  expect(
    (await getLessonEditor(db, request, fixture.course.id, fixture.lesson.id))
      .lesson
  ).toEqual({ ...saved.lesson, content: "Revised" });
});

it("reorders the complete lesson list within one curriculum section", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Second lesson",
  });
  const before = await getCurriculumSectionEditor(
    db,
    request,
    fixture.course.id,
    fixture.section.id
  );
  const ids = before.module.lessons.map((lesson) => lesson.id).reverse();
  expect(
    await reorderLessons(db, request, fixture.course.id, {
      moduleId: fixture.section.id,
      lessonIds: JSON.stringify(ids),
    })
  ).toEqual({ success: true, field: "lesson-reorder" });
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.section.id
      )
    ).module.lessons
  ).toMatchObject([
    { title: "Second lesson", position: 1 },
    { title: "First lesson", position: 2 },
  ]);
});

it("moves a lesson between sections and closes and opens the appropriate position gaps", async () => {
  const request = await requestAs(fixture.admin.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Source sibling",
  });
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.secondSection.id,
    title: "Destination sibling",
  });
  expect(
    await moveLesson(db, request, fixture.course.id, {
      lessonId: fixture.lesson.id,
      targetModuleId: fixture.secondSection.id,
      targetPosition: "1",
    })
  ).toEqual({ success: true, field: "lesson-move" });
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.section.id
      )
    ).module.lessons
  ).toMatchObject([{ title: "Source sibling", position: 1 }]);
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.secondSection.id
      )
    ).module.lessons
  ).toMatchObject([
    { title: "First lesson", position: 1 },
    { title: "Destination sibling", position: 2 },
  ]);
});

it("deletes a populated lesson with all dependent records and archives its discussion Notifications", async () => {
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  expect(notifications.feedOf(fixture.instructor.id)).toHaveLength(1);
  const request = await requestAs(fixture.instructor.id);
  expect(
    await deleteLesson(
      db,
      request,
      fixture.course.id,
      { lessonId: fixture.lesson.id },
      notifications
    )
  ).toEqual({ success: true, field: "lesson" });
  await expect(
    getLessonEditor(db, request, fixture.course.id, fixture.lesson.id)
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.section.id
      )
    ).module.lessons
  ).toEqual([]);
  expect(notifications.feedOf(fixture.instructor.id)).toEqual([]);
  for (const table of [
    "lessons",
    "quizzes",
    "quiz_questions",
    "quiz_options",
    "quiz_attempts",
    "quiz_answers",
    "comments",
    "notes",
    "bookmarks",
    "lesson_progress",
    "video_watch_events",
  ]) {
    expect(
      db.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get()
    ).toEqual({ count: 0 });
  }
});

const operationNames = [
  "section",
  "editor",
  "create",
  "rename",
  "update",
  "delete",
  "move",
  "reorder",
] as const;
type Operation = (typeof operationNames)[number];
type Inputs = {
  courseId?: unknown;
  lessonId?: unknown;
  moduleId?: unknown;
  command?: unknown;
};
function perform(operation: Operation, request: Request, inputs: Inputs = {}) {
  const courseId = Object.hasOwn(inputs, "courseId")
    ? inputs.courseId
    : fixture.course.id;
  const lessonId = Object.hasOwn(inputs, "lessonId")
    ? inputs.lessonId
    : fixture.lesson.id;
  const moduleId = Object.hasOwn(inputs, "moduleId")
    ? inputs.moduleId
    : fixture.section.id;
  const command = (fallback: unknown) =>
    Object.hasOwn(inputs, "command") ? inputs.command : fallback;
  switch (operation) {
    case "section":
      return getCurriculumSectionEditor(db, request, courseId, moduleId);
    case "editor":
      return getLessonEditor(db, request, courseId, lessonId);
    case "create":
      return createLesson(
        db,
        request,
        courseId,
        command({ moduleId, title: "Added" })
      );
    case "rename":
      return renameLesson(
        db,
        request,
        courseId,
        command({ lessonId, title: "Renamed" })
      );
    case "update":
      return updateLesson(
        db,
        request,
        courseId,
        lessonId,
        command({ intent: "update-lesson", content: "Changed" })
      );
    case "delete":
      return deleteLesson(
        db,
        request,
        courseId,
        command({ lessonId }),
        notifications
      );
    case "move":
      return moveLesson(
        db,
        request,
        courseId,
        command({
          lessonId,
          targetModuleId: fixture.secondSection.id,
          targetPosition: 1,
        })
      );
    case "reorder":
      return reorderLessons(
        db,
        request,
        courseId,
        command({ moduleId, lessonIds: JSON.stringify([lessonId]) })
      );
  }
}

it.each(operationNames)(
  "permits the current owning Instructor and a Platform Admin to use %s",
  async (operation) => {
    for (const userId of [fixture.instructor.id, fixture.admin.id]) {
      if (operation === "delete")
        await createLesson(
          db,
          await requestAs(fixture.instructor.id),
          fixture.course.id,
          { moduleId: fixture.section.id, title: "For deletion" }
        );
      const section = await getCurriculumSectionEditor(
        db,
        await requestAs(fixture.instructor.id),
        fixture.course.id,
        fixture.section.id
      );
      const lessonId = section.module.lessons[0]?.id;
      if (lessonId === undefined) throw new Error("Expected a lesson");
      await expect(
        perform(operation, await requestAs(userId), { lessonId })
      ).resolves.toBeDefined();
      if (operation === "move")
        await moveLesson(
          db,
          await requestAs(fixture.instructor.id),
          fixture.course.id,
          { lessonId, targetModuleId: fixture.section.id, targetPosition: 1 }
        );
    }
  }
);

for (const person of [
  "signed-out",
  "stale",
  "student",
  "unrelated-instructor",
  "demoted-owner",
] as const) {
  it.each(operationNames)(
    `rejects ${person} %s without changing records or Notifications`,
    async (operation) => {
      await populateLesson(
        db,
        fixture.lesson.id,
        fixture.user.id,
        notifications
      );
      if (person === "demoted-owner") {
        demote(db, fixture.instructor.id);
        await enrollStudent(
          db,
          fixture.instructor.id,
          fixture.course.id,
          new Date(),
          notifications
        );
      }
      const request = await requestAs(
        person === "signed-out"
          ? undefined
          : person === "stale"
            ? 99999
            : person === "student"
              ? fixture.user.id
              : person === "unrelated-instructor"
                ? fixture.otherInstructor.id
                : fixture.instructor.id
      );
      const before = db.$client.serialize();
      const sent = [...notifications.sent];
      const feed = notifications.feedOf(fixture.instructor.id);
      await expect(perform(operation, request)).rejects.toMatchObject({
        init: {
          status: person === "signed-out" || person === "stale" ? 401 : 403,
        },
      });
      expect(db.$client.serialize()).toEqual(before);
      expect(notifications.sent).toEqual(sent);
      expect(notifications.feedOf(fixture.instructor.id)).toEqual(feed);
    }
  );
}

it.each(operationNames)(
  "checks live identity before malformed %s input",
  async (operation) => {
    await expect(
      perform(operation, await requestAs(99999), {
        courseId: "invalid",
        command: null,
      })
    ).rejects.toMatchObject({ init: { status: 401 } });
  }
);

it.each(operationNames)(
  "checks malformed %s identifiers before permission or ancestry",
  async (operation) => {
    await expect(
      perform(operation, await requestAs(fixture.user.id), {
        courseId: "1junk",
        lessonId: 99999,
        moduleId: 99999,
      })
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
);

for (const person of ["student", "admin"] as const) {
  it.each(operationNames)(
    `resolves missing %s courses before ${person} permission`,
    async (operation) => {
      await expect(
        perform(
          operation,
          await requestAs(
            person === "student" ? fixture.user.id : fixture.admin.id
          ),
          { courseId: 99999 }
        )
      ).rejects.toMatchObject({ init: { status: 404 } });
    }
  );
  it.each(operationNames)(
    `rejects cross-course %s targets for a ${person}`,
    async (operation) => {
      const before = db.$client.serialize();
      await expect(
        perform(
          operation,
          await requestAs(
            person === "student" ? fixture.user.id : fixture.admin.id
          ),
          { courseId: fixture.otherCourse.id }
        )
      ).rejects.toMatchObject({ init: { status: 404 } });
      expect(db.$client.serialize()).toEqual(before);
      expect(notifications.sent).toEqual([]);
    }
  );
}

it.each([
  "",
  "1junk",
  "1.5",
  1.5,
  0,
  -1,
  true,
  null,
  Number.MAX_SAFE_INTEGER + 1,
])("rejects malformed lesson/section identifiers %j", async (id) => {
  const request = await requestAs(fixture.admin.id);
  for (const operation of operationNames) {
    if (operation === "reorder") continue;
    await expect(
      perform(operation, request, { lessonId: id, moduleId: id })
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
});

it.each([
  "section",
  "editor",
  "create",
  "rename",
  "update",
  "delete",
  "move",
  "reorder",
] as const)(
  "rejects missing %s targets before permission",
  async (operation) => {
    const before = db.$client.serialize();
    await expect(
      perform(operation, await requestAs(fixture.user.id), {
        lessonId: 99999,
        moduleId: 99999,
      })
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each(["create", "rename", "update", "delete", "move", "reorder"] as const)(
  "validates complete %s commands before resolving a missing course",
  async (operation) => {
    await expect(
      perform(operation, await requestAs(fixture.user.id), {
        courseId: 99999,
        command: {},
      })
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
);

it("preserves the existing blank-media and blank-duration save behavior while allowing content to be cleared", async () => {
  const request = await requestAs(fixture.instructor.id);
  await updateLesson(db, request, fixture.course.id, fixture.lesson.id, {
    intent: "update-lesson",
    content: "Body",
    videoUrl: "video",
    githubRepoUrl: "repo",
    durationMinutes: "12",
  });
  await updateLesson(db, request, fixture.course.id, fixture.lesson.id, {
    intent: "update-lesson",
    content: "",
    videoUrl: " ",
    githubRepoUrl: "",
    durationMinutes: "",
  });
  expect(
    (await getLessonEditor(db, request, fixture.course.id, fixture.lesson.id))
      .lesson
  ).toMatchObject({
    content: "",
    videoUrl: "video",
    githubRepoUrl: "repo",
    durationMinutes: 12,
  });
  await updateLesson(db, request, fixture.course.id, fixture.lesson.id, {
    intent: "update-lesson",
    durationMinutes: "0",
  });
  expect(
    (await getLessonEditor(db, request, fixture.course.id, fixture.lesson.id))
      .lesson.durationMinutes
  ).toBe(0);
});

it.each([
  "1junk",
  "-1",
  "1.5",
  "1e3",
  "9007199254740992",
  "Infinity",
  " ",
  null,
  true,
  12,
])(
  "rejects malformed duration %j before target or permission checks",
  async (durationMinutes) => {
    const before = db.$client.serialize();
    await expect(
      updateLesson(
        db,
        await requestAs(fixture.user.id),
        99999,
        fixture.lesson.id,
        { intent: "update-lesson", content: "Changed", durationMinutes }
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each([
  "broken",
  "{}",
  "null",
  "[true]",
  '["1"]',
  "[0]",
  "[-1]",
  "[1.5]",
  "[9007199254740992]",
  "[1,1]",
  "[]",
])(
  "rejects malformed or incomplete reorder %s without changing any records",
  async (lessonIds) => {
    const before = db.$client.serialize();
    await expect(
      reorderLessons(db, await requestAs(fixture.admin.id), fixture.course.id, {
        moduleId: fixture.section.id,
        lessonIds,
      })
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.sent).toEqual([]);
  }
);

it("rejects an incomplete reorder of a populated section", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Second lesson",
  });
  const before = db.$client.serialize();
  await expect(
    reorderLessons(db, request, fixture.course.id, {
      moduleId: fixture.section.id,
      lessonIds: JSON.stringify([fixture.lesson.id]),
    })
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(db.$client.serialize()).toEqual(before);
});

it.each(["same-course-section", "foreign-course", "missing"] as const)(
  "validates every reorder member before writing when a later lesson is %s",
  async (target) => {
    const request = await requestAs(fixture.admin.id);
    const moduleId =
      target === "same-course-section"
        ? fixture.secondSection.id
        : fixture.otherSection.id;
    const courseId =
      target === "same-course-section"
        ? fixture.course.id
        : fixture.otherCourse.id;
    await createLesson(db, request, courseId, {
      moduleId,
      title: "Other lesson",
    });
    const other = (
      await getCurriculumSectionEditor(db, request, courseId, moduleId)
    ).module.lessons[0];
    if (!other) throw new Error("Expected another lesson");
    db.$client.exec(
      "CREATE TRIGGER prevent_early_reorder BEFORE UPDATE ON lessons BEGIN SELECT RAISE(ABORT, 'Write before validation'); END"
    );
    const before = db.$client.serialize();
    await expect(
      reorderLessons(db, request, fixture.course.id, {
        moduleId: fixture.section.id,
        lessonIds: JSON.stringify([
          fixture.lesson.id,
          target === "missing" ? 99999 : other.id,
        ]),
      })
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it("accepts the complete empty reorder of an empty section", async () => {
  await expect(
    reorderLessons(db, await requestAs(fixture.admin.id), fixture.course.id, {
      moduleId: fixture.secondSection.id,
      lessonIds: "[]",
    })
  ).resolves.toEqual({ success: true, field: "lesson-reorder" });
});

it.each(["missing", "foreign"] as const)(
  "validates a %s move destination before updating the source",
  async (destination) => {
    const request = await requestAs(fixture.admin.id);
    await createLesson(db, request, fixture.course.id, {
      moduleId: fixture.section.id,
      title: "Source sibling",
    });
    db.$client.exec(
      "CREATE TRIGGER prevent_early_move BEFORE UPDATE ON lessons BEGIN SELECT RAISE(ABORT, 'Write before validation'); END"
    );
    const before = db.$client.serialize();
    await expect(
      moveLesson(db, request, fixture.course.id, {
        lessonId: fixture.lesson.id,
        targetModuleId:
          destination === "missing" ? 99999 : fixture.otherSection.id,
        targetPosition: 1,
      })
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each([0, -1, 1.5, "1junk", "", true, 2, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid move position %j without changing either section",
  async (targetPosition) => {
    const before = db.$client.serialize();
    await expect(
      moveLesson(db, await requestAs(fixture.admin.id), fixture.course.id, {
        lessonId: fixture.lesson.id,
        targetModuleId: fixture.secondSection.id,
        targetPosition,
      })
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it("moves within the same section and appends to an existing destination", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Second",
  });
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Third",
  });
  await moveLesson(db, request, fixture.course.id, {
    lessonId: fixture.lesson.id,
    targetModuleId: fixture.section.id,
    targetPosition: 3,
  });
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.section.id
      )
    ).module.lessons
  ).toMatchObject([
    { title: "Second", position: 1 },
    { title: "Third", position: 2 },
    { title: "First lesson", position: 3 },
  ]);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.secondSection.id,
    title: "Destination first",
  });
  await moveLesson(db, request, fixture.course.id, {
    lessonId: fixture.lesson.id,
    targetModuleId: fixture.secondSection.id,
    targetPosition: 2,
  });
  expect(
    (
      await getCurriculumSectionEditor(
        db,
        request,
        fixture.course.id,
        fixture.secondSection.id
      )
    ).module.lessons
  ).toMatchObject([
    { title: "Destination first", position: 1 },
    { title: "First lesson", position: 2 },
  ]);
});

it("rolls back every earlier lesson position when a later reorder write fails", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Second",
  });
  const ids = (
    await getCurriculumSectionEditor(
      db,
      request,
      fixture.course.id,
      fixture.section.id
    )
  ).module.lessons
    .map((lesson) => lesson.id)
    .reverse();
  db.$client.exec(
    `CREATE TRIGGER stop_late_reorder BEFORE UPDATE ON lessons WHEN NEW.id = ${fixture.lesson.id} BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END`
  );
  const before = db.$client.serialize();
  await expect(
    reorderLessons(db, request, fixture.course.id, {
      moduleId: fixture.section.id,
      lessonIds: JSON.stringify(ids),
    })
  ).rejects.toThrow();
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
});

it("rolls back both sections when the final destination write fails during a move", async () => {
  const request = await requestAs(fixture.instructor.id);
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.section.id,
    title: "Source sibling",
  });
  await createLesson(db, request, fixture.course.id, {
    moduleId: fixture.secondSection.id,
    title: "Destination sibling",
  });
  const destination = (
    await getCurriculumSectionEditor(
      db,
      request,
      fixture.course.id,
      fixture.secondSection.id
    )
  ).module.lessons[0];
  if (!destination) throw new Error("Expected a destination lesson");
  db.$client.exec(
    `CREATE TRIGGER stop_late_move BEFORE UPDATE ON lessons WHEN NEW.id = ${destination.id} BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END`
  );
  const before = db.$client.serialize();
  await expect(
    moveLesson(db, request, fixture.course.id, {
      lessonId: fixture.lesson.id,
      targetModuleId: fixture.secondSection.id,
      targetPosition: 1,
    })
  ).rejects.toThrow();
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
});

it("rolls back all dependent deletion writes and retains Notifications if deleting the lesson fails", async () => {
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  db.$client.exec(
    "CREATE TRIGGER stop_lesson_delete BEFORE DELETE ON lessons BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END"
  );
  const before = db.$client.serialize();
  const feed = notifications.feedOf(fixture.instructor.id);
  const sent = [...notifications.sent];
  await expect(
    deleteLesson(
      db,
      await requestAs(fixture.instructor.id),
      fixture.course.id,
      { lessonId: fixture.lesson.id },
      notifications
    )
  ).rejects.toThrow();
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.feedOf(fixture.instructor.id)).toEqual(feed);
  expect(notifications.sent).toEqual(sent);
});

it("preserves another course's populated lesson and Notifications when deleting a lesson", async () => {
  const request = await requestAs(fixture.admin.id);
  await createLesson(db, request, fixture.otherCourse.id, {
    moduleId: fixture.otherSection.id,
    title: "Other lesson",
  });
  const other = (
    await getCurriculumSectionEditor(
      db,
      request,
      fixture.otherCourse.id,
      fixture.otherSection.id
    )
  ).module.lessons[0];
  if (!other) throw new Error("Expected another lesson");
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  await populateLesson(db, other.id, fixture.user.id, notifications);
  const otherEditor = await getLessonEditor(
    db,
    request,
    fixture.otherCourse.id,
    other.id
  );
  const otherFeed = notifications.feedOf(fixture.otherInstructor.id);
  await deleteLesson(
    db,
    request,
    fixture.course.id,
    { lessonId: fixture.lesson.id },
    notifications
  );
  expect(
    await getLessonEditor(db, request, fixture.otherCourse.id, other.id)
  ).toEqual(otherEditor);
  expect(notifications.feedOf(fixture.otherInstructor.id)).toEqual(otherFeed);
  expect(
    db.$client.prepare("SELECT count(*) AS count FROM quiz_attempts").get()
  ).toEqual({ count: 1 });
  expect(
    db.$client.prepare("SELECT count(*) AS count FROM notes").get()
  ).toEqual({ count: 1 });
});
