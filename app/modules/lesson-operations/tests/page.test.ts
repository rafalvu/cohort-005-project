import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  courses,
  lessonProgress,
  lessons,
  modules,
  users,
  UserRole,
  LessonProgressStatus,
} from "~/db/schema";
import { getLessonPage } from "../index.server";
import { lessonFixture, requestFor } from "./fixtures";

let f: Awaited<ReturnType<typeof lessonFixture>>;
beforeEach(async () => {
  f = await lessonFixture();
});
afterEach(() => f.db.$client.close());

it("returns only public preview fields, including adjacent lessons and curriculum", async () => {
  await f.privateData();
  const before = f.history();
  const page = await getLessonPage(f.db, await requestFor(null), f.target);
  expect(JSON.parse(JSON.stringify(page))).toEqual({
    kind: "preview",
    denial: "enrollment",
    canViewContent: false,
    course: { id: f.course.id, title: "Test Course", slug: "test-course" },
    lesson: {
      id: f.lesson.id,
      title: "Lesson 2",
      durationMinutes: 10,
      href: "/courses/test-course/lessons/2",
    },
    module: { id: f.section.id, title: "Getting started" },
    curriculum: [
      {
        id: f.section.id,
        title: "Getting started",
        lessons: [
          {
            id: f.previous.id,
            title: "Lesson 1",
            durationMinutes: 10,
            href: "/courses/test-course/lessons/1",
          },
          {
            id: f.lesson.id,
            title: "Lesson 2",
            durationMinutes: 10,
            href: "/courses/test-course/lessons/2",
          },
          {
            id: f.next.id,
            title: "Lesson 3",
            durationMinutes: 10,
            href: "/courses/test-course/lessons/3",
          },
        ],
      },
    ],
    prevLesson: {
      id: f.previous.id,
      title: "Lesson 1",
      durationMinutes: 10,
      href: "/courses/test-course/lessons/1",
    },
    nextLesson: {
      id: f.next.id,
      title: "Lesson 3",
      durationMinutes: 10,
      href: "/courses/test-course/lessons/3",
    },
    instructorName: "Test Instructor",
    enrollmentHref: "/courses/test-course",
    purchaseHref: "/courses/test-course/purchase",
  });
  expect(f.history()).toEqual(before);
});

it("gives qualified Students the full lesson without quiz answer keys and starts their progress", async () => {
  await f.enroll();
  await f.privateData();
  f.purchase("US");
  const page = await getLessonPage(f.db, await requestFor(f.user.id), f.target);
  expect(page).toMatchObject({
    kind: "content",
    canViewContent: true,
    canParticipate: true,
    lesson: {
      id: f.lesson.id,
      videoUrl: "https://video.example/secret-1",
      githubRepoUrl: "https://code.example/secret-1",
    },
    contentHtml: "<p>Protected body 1</p>\n",
    lessonStatus: "in_progress",
    lastWatchPosition: 120,
    watchProgress: 20,
    bookmarked: true,
    note: { body: "Secret personal note" },
    comments: [{ body: "Secret discussion" }],
    quiz: {
      questions: [
        {
          questionText: "Secret question",
          options: [{ optionText: "Secret option" }],
        },
      ],
    },
  });
  expect(JSON.stringify(page)).not.toContain("isCorrect");
  expect(JSON.stringify(page)).not.toContain("correctOptionId");
  expect(f.history().progress).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        userId: f.user.id,
        lessonId: f.lesson.id,
        status: "in_progress",
      }),
    ])
  );
});

it.each([
  "signed out",
  "stale session",
  "unenrolled",
  "country blocked",
  "demoted owner",
])(
  "gives %s visitors a safe preview without changing their retained history",
  async (viewer) => {
    await f.privateData();
    let userId: number | null = f.user.id;
    if (viewer === "signed out") userId = null;
    if (viewer === "stale session") userId = 999999;
    if (viewer === "country blocked") {
      await f.enroll();
      f.purchase("IN");
    }
    if (viewer === "demoted owner") {
      userId = f.instructor.id;
      f.db
        .update(users)
        .set({ role: UserRole.Student })
        .where(eq(users.id, userId))
        .run();
    }
    const before = f.history();
    f.notifications.sent.length = 0;
    const page = await getLessonPage(f.db, await requestFor(userId), f.target);
    expect(page).toMatchObject({
      kind: "preview",
      canViewContent: false,
      denial: viewer === "country blocked" ? "country" : "enrollment",
    });
    const serialized = JSON.stringify(page);
    for (const forbidden of [
      "Protected body",
      "secret-",
      "Secret assessment",
      "Secret question",
      "Secret option",
      "Secret discussion",
      "Secret personal note",
      '"content"',
      '"contentHtml"',
      '"videoUrl"',
      '"githubRepoUrl"',
      '"quiz"',
      '"comments"',
      '"bookmarked"',
      '"note"',
      '"lessonStatus"',
      '"lessonProgressMap"',
      '"watchProgress"',
      '"lastWatchPosition"',
      '"bestAttempt"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(f.history()).toEqual(before);
    expect(f.notifications.sent).toEqual([]);
  }
);

it.each([UserRole.Instructor, UserRole.Admin])(
  "lets %s inspect protected content without Student participation",
  async (role) => {
    const person =
      role === UserRole.Instructor ? f.instructor : f.addPerson(role);
    const before = f.history();
    const page = await getLessonPage(
      f.db,
      await requestFor(person.id),
      f.target
    );
    expect(page).toMatchObject({
      kind: "content",
      canModerate: true,
      canParticipate: false,
      enrolled: false,
      contentHtml: "<p>Protected body 1</p>\n",
    });
    expect(f.history()).toEqual(before);
  }
);

it.each([UserRole.Instructor, UserRole.Admin])(
  "still withholds automatic progress from an enrolled, country-blocked %s",
  async (role) => {
    const person =
      role === UserRole.Instructor ? f.instructor : f.addPerson(role);
    await f.enroll(person.id);
    f.purchase("IN", person.id);
    const before = f.history();
    const page = await getLessonPage(
      f.db,
      await requestFor(person.id),
      f.target
    );
    expect(page).toMatchObject({
      kind: "content",
      canParticipate: false,
      enrolled: true,
      lessonStatus: null,
      lessonProgressMap: {},
    });
    expect(f.history()).toEqual(before);
  }
);

it.each([UserRole.Instructor, UserRole.Admin])(
  "records Student progress for an enrolled, country-qualified %s",
  async (role) => {
    const person =
      role === UserRole.Instructor ? f.instructor : f.addPerson(role);
    await f.enroll(person.id);
    f.purchase("US", person.id);
    const page = await getLessonPage(
      f.db,
      await requestFor(person.id),
      f.target
    );
    expect(page).toMatchObject({
      kind: "content",
      canParticipate: true,
      lessonStatus: "in_progress",
    });
    expect(f.history().progress).toEqual([
      expect.objectContaining({
        userId: person.id,
        lessonId: f.lesson.id,
        status: "in_progress",
      }),
    ]);
  }
);

it("uses the live role and retains a demoted owner's qualifying Enrollment", async () => {
  const request = await requestFor(f.instructor.id);
  expect(await getLessonPage(f.db, request, f.target)).toMatchObject({
    kind: "content",
    canModerate: true,
  });
  f.db
    .update(users)
    .set({ role: UserRole.Student })
    .where(eq(users.id, f.instructor.id))
    .run();
  expect(await getLessonPage(f.db, request, f.target)).toMatchObject({
    kind: "preview",
  });
  await f.enroll(f.instructor.id);
  expect(await getLessonPage(f.db, request, f.target)).toMatchObject({
    kind: "content",
    canModerate: false,
    canParticipate: true,
  });
});

it("does not grant another Instructor an ownership exemption", async () => {
  const otherInstructor = f.addPerson(UserRole.Instructor);
  expect(
    await getLessonPage(f.db, await requestFor(otherInstructor.id), f.target)
  ).toMatchObject({ kind: "preview" });
  expect(f.history().progress).toEqual([]);
});

it("preserves completed history and scopes personal Notes and Bookmarks to the current person", async () => {
  await f.enroll();
  await f.privateData();
  f.db
    .insert(lessonProgress)
    .values({
      userId: f.user.id,
      lessonId: f.lesson.id,
      status: LessonProgressStatus.Completed,
      completedAt: "2026-11-01T12:00:00.000Z",
    })
    .run();
  const before = f.history();
  expect(
    await getLessonPage(f.db, await requestFor(f.user.id), f.target)
  ).toMatchObject({ lessonStatus: "completed" });
  expect(f.history()).toEqual(before);
  expect(
    await getLessonPage(f.db, await requestFor(f.instructor.id), f.target)
  ).toMatchObject({ bookmarked: false, note: null });
});

it.each([
  undefined,
  null,
  "",
  "0",
  "-1",
  "1.5",
  "2e0",
  "NaN",
  "Infinity",
  " 2",
  "9007199254740992",
])(
  "rejects malformed lesson identifier %s before returning data or changing history",
  async (lessonId) => {
    const before = f.history();
    await expect(
      getLessonPage(f.db, await requestFor(null), {
        slug: f.course.slug,
        lessonId,
      })
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(f.history()).toEqual(before);
  }
);

it.each(["missing lesson", "missing course", "foreign course"])(
  "rejects a %s target even for a Platform Admin",
  async (scenario) => {
    const admin = f.addPerson(UserRole.Admin);
    let target = { ...f.target };
    if (scenario === "missing lesson") target.lessonId = "999999";
    if (scenario === "missing course") target.slug = "does-not-exist";
    if (scenario === "foreign course") {
      const other = f.db
        .insert(courses)
        .values({
          ...f.course,
          id: undefined,
          title: "Other course",
          slug: "other",
        })
        .returning()
        .get();
      const section = f.db
        .insert(modules)
        .values({ courseId: other.id, title: "Other section", position: 0 })
        .returning()
        .get();
      const lesson = f.db
        .insert(lessons)
        .values({ moduleId: section.id, title: "Other lesson", position: 0 })
        .returning()
        .get();
      target.lessonId = String(lesson.id);
    }
    const before = f.history();
    await expect(
      getLessonPage(f.db, await requestFor(admin.id), target)
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(f.history()).toEqual(before);
  }
);
