import { createComment } from "~/lib/comments.server";
import { getInstructorAnalytics } from "~/modules/instructor-analytics/index.server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import {
  getInstructorWorkspace,
  getCourseCreation,
  createInstructorCourse,
  getStudentRoster,
  getInstructorReport,
  getInstructorQuestions,
  replyToDiscussionQuestion,
} from "../reporting.server";
import {
  reportingRequest,
  newCourseCommand,
  recordPurchase,
  seedQuestions,
  removeQuestionAncestor,
  transferCourse,
} from "./reporting-fixtures";
import {
  demote,
  requestAs,
  seedEditor,
  populateLesson,
} from "./course-editor-fixtures";

let db: TestDb;
let fixture: ReturnType<typeof seedEditor>;
beforeEach(() => {
  db = createTestDb();
  fixture = seedEditor(db);
});
afterEach(() => db.$client.close());

it("lists only the current Instructor's courses with their lesson and Enrollment counts", async () => {
  await enrollStudent(
    db,
    fixture.user.id,
    fixture.course.id,
    new Date(),
    fakeNotifications()
  );
  const result = await getInstructorWorkspace(
    db,
    await requestAs(fixture.instructor.id)
  );
  expect(result.courses).toHaveLength(1);
  expect(result.courses[0]).toMatchObject({
    id: fixture.course.id,
    lessonCount: 1,
    enrollmentCount: 1,
  });
});

it.each(["student", "admin", "demoted", "signed out", "stale"])(
  "keeps the Instructor landing page closed to %s people",
  async (kind) => {
    if (kind === "demoted") demote(db, fixture.instructor.id);
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "admin"
          ? fixture.admin.id
          : kind === "demoted"
            ? fixture.instructor.id
            : kind === "stale"
              ? 99999
              : undefined;
    await expect(
      getInstructorWorkspace(db, await requestAs(id))
    ).rejects.toMatchObject({
      init: { status: kind === "signed out" || kind === "stale" ? 401 : 403 },
    });
  }
);

it("provides categories and creates the current Instructor's draft with its public slug", async () => {
  const request = await requestAs(fixture.instructor.id);
  expect(await getCourseCreation(db, request)).toMatchObject({
    categories: [{ id: fixture.category.id, name: "Programming" }],
  });
  const course = await createInstructorCourse(
    db,
    await reportingRequest(
      fixture.instructor.id,
      newCourseCommand(fixture.category.id)
    )
  );
  expect(course).toMatchObject({
    title: "New Instructor Course",
    slug: "new-instructor-course",
    status: "draft",
    instructorId: fixture.instructor.id,
    coverImageUrl: null,
  });
  expect((await getInstructorWorkspace(db, request)).courses).toHaveLength(2);
});

it.each(["student", "admin", "demoted", "signed out", "stale"])(
  "denies %s creation loaders and direct creation without writes",
  async (kind) => {
    if (kind === "demoted") demote(db, fixture.instructor.id);
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "admin"
          ? fixture.admin.id
          : kind === "demoted"
            ? fixture.instructor.id
            : kind === "stale"
              ? 99999
              : undefined;
    const status = kind === "signed out" || kind === "stale" ? 401 : 403;
    const before = db.$client.serialize();
    await expect(
      getCourseCreation(db, await requestAs(id))
    ).rejects.toMatchObject({ init: { status } });
    await expect(
      createInstructorCourse(
        db,
        await reportingRequest(id, newCourseCommand(fixture.category.id))
      )
    ).rejects.toMatchObject({ init: { status } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each([
  { categoryId: "invalid", status: 400 },
  { categoryId: "1suffix", status: 400 },
  { categoryId: "0", status: 400 },
  { categoryId: "99999", status: 404 },
])(
  "checks creation category $categoryId before role without writes",
  async ({ categoryId, status }) => {
    const before = db.$client.serialize();
    await expect(
      createInstructorCourse(
        db,
        await reportingRequest(fixture.admin.id, {
          ...newCourseCommand(fixture.category.id),
          categoryId,
        })
      )
    ).rejects.toMatchObject({ init: { status } });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it("rejects duplicate course slugs and empty titles without creating another course", async () => {
  const command = newCourseCommand(fixture.category.id);
  await createInstructorCourse(
    db,
    await reportingRequest(fixture.instructor.id, command)
  );
  const before = db.$client.serialize();
  for (const title of [command.title, "  ", "!!!"]) {
    await expect(
      createInstructorCourse(
        db,
        await reportingRequest(fixture.instructor.id, { ...command, title })
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
  expect(db.$client.serialize()).toEqual(before);
});

it("returns enrolled Student progress and best quiz results to the owning Instructor and Platform Admin", async () => {
  const notifications = fakeNotifications();
  await enrollStudent(
    db,
    fixture.user.id,
    fixture.course.id,
    new Date(),
    notifications
  );
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  for (const id of [fixture.instructor.id, fixture.admin.id]) {
    expect(
      await getStudentRoster(db, await requestAs(id), fixture.course.id)
    ).toMatchObject({
      course: { id: fixture.course.id },
      quizCount: 1,
      students: [
        {
          userId: fixture.user.id,
          email: fixture.user.email,
          lapsed: false,
          progress: 100,
          quizScores: [{ bestScore: 1, passed: true }],
        },
      ],
    });
  }
});

it.each(["student", "other", "demoted", "signed out", "stale"])(
  "protects roster privacy from %s people",
  async (kind) => {
    if (kind === "demoted") demote(db, fixture.instructor.id);
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "other"
          ? fixture.otherInstructor.id
          : kind === "demoted"
            ? fixture.instructor.id
            : kind === "stale"
              ? 99999
              : undefined;
    await expect(
      getStudentRoster(db, await requestAs(id), fixture.course.id)
    ).rejects.toMatchObject({
      init: { status: kind === "signed out" || kind === "stale" ? 401 : 403 },
    });
  }
);

it.each(["1junk", "", "0", "-1", "1.1", true, "9007199254740992", 99999])(
  "rejects malformed or absent roster target %s before permission",
  async (target) => {
    for (const id of [fixture.user.id, fixture.admin.id]) {
      await expect(
        getStudentRoster(db, await requestAs(id), target)
      ).rejects.toMatchObject({
        init: { status: target === 99999 ? 404 : 400 },
      });
    }
  }
);

it("retains lapsed Students and their history after Enrollment ends", async () => {
  const notifications = fakeNotifications();
  await populateLesson(db, fixture.lesson.id, fixture.user.id, notifications);
  recordPurchase(db, fixture.user.id, fixture.course.id, 5000);
  expect(
    await getStudentRoster(
      db,
      await requestAs(fixture.instructor.id),
      fixture.course.id
    )
  ).toMatchObject({
    students: [
      {
        userId: fixture.user.id,
        lapsed: true,
        progress: 100,
        quizScores: [{ bestScore: 1 }],
      },
    ],
  });
});

it.each(["instructor", "admin"])(
  "preserves the independent analytics output and filters for %s",
  async (kind) => {
    const now = new Date("2026-11-24T12:00:00Z");
    recordPurchase(db, fixture.user.id, fixture.course.id, 5000);
    recordPurchase(db, fixture.user.id, fixture.otherCourse.id, 2000);
    await enrollStudent(
      db,
      fixture.user.id,
      fixture.course.id,
      now,
      fakeNotifications()
    );
    const userId = kind === "admin" ? fixture.admin.id : fixture.instructor.id;
    for (const search of [
      "",
      "?range=30d&tab=course&course=" + fixture.course.id,
      "?instructor=" +
        fixture.otherInstructor.id +
        "&course=" +
        fixture.otherCourse.id,
      "?range=invalid&course=bad",
    ]) {
      const request = await reportingRequest(userId, undefined, search);
      expect(await getInstructorReport(db, request, now)).toEqual(
        getInstructorAnalytics(db, {
          viewer: { userId, isAdmin: kind === "admin" },
          searchParams: new URL(request.url).searchParams,
          now,
        })
      );
    }
    expect(
      (await getInstructorReport(db, await reportingRequest(userId), now))
        .summary.grossCents
    ).toBe(kind === "admin" ? 7000 : 5000);
  }
);

it.each(["student", "demoted", "signed out", "stale"])(
  "protects aggregate analytics from %s people",
  async (kind) => {
    if (kind === "demoted") demote(db, fixture.instructor.id);
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "demoted"
          ? fixture.instructor.id
          : kind === "stale"
            ? 99999
            : undefined;
    await expect(
      getInstructorReport(db, await requestAs(id), new Date())
    ).rejects.toMatchObject({
      init: { status: kind === "signed out" || kind === "stale" ? 401 : 403 },
    });
  }
);

it("scopes rendered unanswered Discussion Questions to owned courses or the whole platform", async () => {
  const { question, otherQuestion } = await seedQuestions(
    db,
    fixture,
    fakeNotifications()
  );
  const instructor = await getInstructorQuestions(
    db,
    await requestAs(fixture.instructor.id)
  );
  expect(instructor.isAdmin).toBe(false);
  expect(instructor.questions.map((entry) => entry.id)).toEqual([question.id]);
  expect(instructor.questions[0]?.bodyHtml).toContain(
    "<strong>My question</strong>"
  );
  expect(instructor.questions[0]?.bodyHtml).not.toContain("<script>");
  const admin = await getInstructorQuestions(
    db,
    await requestAs(fixture.admin.id)
  );
  expect(admin.isAdmin).toBe(true);
  expect(admin.questions.map((entry) => entry.id)).toEqual([
    otherQuestion.id,
    question.id,
  ]);
});

it.each(["student", "demoted", "signed out", "stale"])(
  "denies %s access to the question queue",
  async (kind) => {
    if (kind === "demoted") demote(db, fixture.instructor.id);
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "demoted"
          ? fixture.instructor.id
          : kind === "stale"
            ? 99999
            : undefined;
    await expect(
      getInstructorQuestions(db, await requestAs(id))
    ).rejects.toMatchObject({
      init: { status: kind === "signed out" || kind === "stale" ? 401 : 403 },
    });
  }
);

it.each(["instructor", "admin"])(
  "posts a Discussion Reply as %s, removes answered work and notifies its author",
  async (kind) => {
    const notifications = fakeNotifications();
    const { question } = await seedQuestions(db, fixture, notifications);
    notifications.sent.length = 0;
    const authorId =
      kind === "admin" ? fixture.admin.id : fixture.instructor.id;
    expect(
      await replyToDiscussionQuestion(
        db,
        await reportingRequest(authorId, {
          intent: "reply",
          commentId: String(question.id),
          body: "  Here is the answer.  ",
        }),
        notifications,
        new Date("2026-11-24T13:00:00Z")
      )
    ).toEqual({ ok: true });
    expect(
      (await getInstructorQuestions(db, await requestAs(fixture.instructor.id)))
        .questions
    ).toEqual([]);
    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0]).toMatchObject({
      kind: "discussion-reply",
      recipient: { id: fixture.user.id },
      actor: { id: authorId },
      data: {
        questionId: question.id,
        lessonId: fixture.lesson.id,
        snippet: "Here is the answer.",
      },
    });
  }
);

it.each(["student", "other", "demoted", "signed out", "stale"])(
  "rejects a direct %s reply without writes or Notifications",
  async (kind) => {
    const notifications = fakeNotifications();
    const { question } = await seedQuestions(db, fixture, notifications);
    if (kind === "demoted") {
      await enrollStudent(
        db,
        fixture.instructor.id,
        fixture.course.id,
        new Date(),
        notifications
      );
      demote(db, fixture.instructor.id);
    }
    const id =
      kind === "student"
        ? fixture.user.id
        : kind === "other"
          ? fixture.otherInstructor.id
          : kind === "demoted"
            ? fixture.instructor.id
            : kind === "stale"
              ? 99999
              : undefined;
    notifications.sent.length = 0;
    const before = db.$client.serialize();
    await expect(
      replyToDiscussionQuestion(
        db,
        await reportingRequest(id, {
          intent: "reply",
          commentId: String(question.id),
          body: "Answer",
        }),
        notifications
      )
    ).rejects.toMatchObject({
      init: { status: kind === "signed out" || kind === "stale" ? 401 : 403 },
    });
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.sent).toEqual([]);
  }
);

it("authorizes the question's actual course despite caller-supplied owned course and lesson identifiers", async () => {
  const notifications = fakeNotifications();
  const { otherQuestion } = await seedQuestions(db, fixture, notifications);
  notifications.sent.length = 0;
  const before = db.$client.serialize();
  await expect(
    replyToDiscussionQuestion(
      db,
      await reportingRequest(fixture.instructor.id, {
        intent: "reply",
        commentId: String(otherQuestion.id),
        courseId: String(fixture.course.id),
        lessonId: String(fixture.lesson.id),
        body: "Wrong course",
      }),
      notifications
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
});

it.each([
  { intent: "other", commentId: "1", body: "Answer", status: 400 },
  { intent: "reply", commentId: "1junk", body: "Answer", status: 400 },
  { intent: "reply", commentId: "0", body: "Answer", status: 400 },
  { intent: "reply", commentId: "1.5", body: "Answer", status: 400 },
  { intent: "reply", commentId: "99999", body: "", status: 400 },
  { intent: "reply", commentId: "99999", body: "x".repeat(5001), status: 400 },
  { intent: "reply", commentId: "99999", body: "Answer", status: 404 },
])(
  "rejects invalid reply commands before permission ($intent/$commentId/$status)",
  async ({ status, ...command }) => {
    const notifications = fakeNotifications();
    const before = db.$client.serialize();
    for (const id of [fixture.user.id, fixture.admin.id]) {
      await expect(
        replyToDiscussionQuestion(
          db,
          await reportingRequest(id, command),
          notifications
        )
      ).rejects.toMatchObject({ init: { status } });
    }
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.sent).toEqual([]);
  }
);

it("rejects a reply to a Discussion Reply before permission and without side effects", async () => {
  const notifications = fakeNotifications();
  const { question } = await seedQuestions(db, fixture, notifications);
  const reply = await createComment(
    db,
    fixture.user.id,
    fixture.lesson.id,
    question.id,
    "Follow up",
    new Date(),
    notifications
  );
  if (!reply.ok) throw new Error(reply.error);
  notifications.sent.length = 0;
  const before = db.$client.serialize();
  for (const id of [fixture.user.id, fixture.admin.id]) {
    await expect(
      replyToDiscussionQuestion(
        db,
        await reportingRequest(id, {
          intent: "reply",
          commentId: String(reply.comment.id),
          body: "Too deep",
        }),
        notifications
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  }
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
});

it.each(["lesson", "section", "course"] as const)(
  "requires the question's actual %s to exist even for a Platform Admin",
  async (ancestor) => {
    const notifications = fakeNotifications();
    const { question } = await seedQuestions(db, fixture, notifications);
    removeQuestionAncestor(db, fixture, ancestor);
    notifications.sent.length = 0;
    const before = db.$client.serialize();
    for (const id of [fixture.user.id, fixture.admin.id]) {
      await expect(
        replyToDiscussionQuestion(
          db,
          await reportingRequest(id, {
            intent: "reply",
            commentId: String(question.id),
            body: "Answer",
          }),
          notifications
        )
      ).rejects.toMatchObject({ init: { status: 404 } });
    }
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.sent).toEqual([]);
  }
);

it("rechecks ownership when replying after an earlier authorized queue read", async () => {
  const notifications = fakeNotifications();
  const { question } = await seedQuestions(db, fixture, notifications);
  const request = await reportingRequest(fixture.instructor.id);
  expect((await getInstructorQuestions(db, request)).questions).toHaveLength(1);
  transferCourse(db, fixture.course.id, fixture.otherInstructor.id);
  notifications.sent.length = 0;
  const before = db.$client.serialize();
  const post = new Request(request, {
    method: "POST",
    body: new URLSearchParams({
      intent: "reply",
      commentId: String(question.id),
      body: "Old owner's answer",
    }),
  });
  await expect(
    replyToDiscussionQuestion(db, post, notifications)
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
});

it.each(["creation", "reply"])(
  "rejects malformed and duplicate %s forms after live authentication",
  async (operation) => {
    const notifications = fakeNotifications();
    const invoke = (request: Request) =>
      operation === "creation"
        ? createInstructorCourse(db, request)
        : replyToDiscussionQuestion(db, request, notifications);
    const command =
      operation === "creation"
        ? newCourseCommand(fixture.category.id)
        : { intent: "reply", commentId: "1", body: "Answer" };
    const duplicate = new URLSearchParams(command);
    duplicate.append(
      operation === "creation" ? "categoryId" : "commentId",
      "2"
    );
    const before = db.$client.serialize();
    await expect(
      invoke(await reportingRequest(fixture.user.id, duplicate))
    ).rejects.toMatchObject({ init: { status: 400 } });
    for (const id of [undefined, 99999, fixture.user.id]) {
      const auth = await reportingRequest(id);
      const invalid = new Request(auth, {
        method: "POST",
        body: "bad body",
        headers: {
          Cookie: auth.headers.get("Cookie") ?? "",
          "Content-Type": "application/json",
        },
      });
      await expect(invoke(invalid)).rejects.toMatchObject({
        init: { status: id === fixture.user.id ? 400 : 401 },
      });
    }
    expect(db.$client.serialize()).toEqual(before);
    expect(notifications.sent).toEqual([]);
  }
);

it("checks current role on a previously authenticated Instructor request", async () => {
  const request = await requestAs(fixture.instructor.id);
  await getInstructorWorkspace(db, request);
  demote(db, fixture.instructor.id);
  for (const operation of [
    getInstructorWorkspace,
    getCourseCreation,
    getInstructorQuestions,
  ]) {
    await expect(operation(db, request)).rejects.toMatchObject({
      init: { status: 403 },
    });
  }
  await expect(
    getInstructorReport(db, request, new Date())
  ).rejects.toMatchObject({ init: { status: 403 } });
  await expect(
    getStudentRoster(db, request, fixture.course.id)
  ).rejects.toMatchObject({ init: { status: 403 } });
});
