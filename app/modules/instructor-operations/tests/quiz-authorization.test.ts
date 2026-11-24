import { afterEach, beforeEach, expect, it } from "vitest";
import {
  getQuizEditor,
  updateQuizEditor,
} from "~/modules/instructor-operations/quiz.server";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { createTestDb, type TestDb } from "~/test/setup";
import { demote, requestAs, seedEditor } from "./course-editor-fixtures";
import {
  createQuiz,
  createQuizLesson,
  editableQuiz,
  quizContent,
  quizRequest,
  saveRequest,
  addAttempt,
} from "./quiz-fixtures";

let db: TestDb;
let fixture: Awaited<ReturnType<typeof seedEditor>>;
let quiz: Awaited<ReturnType<typeof createQuiz>>;
let otherQuiz: typeof quiz;
let siblingQuiz: typeof quiz;
let notifications: ReturnType<typeof fakeNotifications>;
beforeEach(async () => {
  db = createTestDb();
  fixture = await seedEditor(db);
  quiz = await createQuiz(
    db,
    fixture.instructor.id,
    fixture.course.id,
    fixture.lesson.id
  );
  otherQuiz = await createQuizLesson(
    db,
    fixture.otherInstructor.id,
    fixture.otherCourse.id,
    fixture.otherSection.id
  );
  siblingQuiz = await createQuizLesson(
    db,
    fixture.instructor.id,
    fixture.course.id,
    fixture.secondSection.id
  );
  notifications = fakeNotifications();
  await addAttempt(db, fixture.user.id, fixture.course, quiz, notifications);
});
afterEach(() => db.$client.close());

async function rejectsUnchanged(
  operation: () => Promise<unknown>,
  status: number
) {
  const before = db.$client.serialize();
  const sent = [...notifications.sent];
  const feed = await notifications.feedOf(fixture.instructor.id);
  await expect(operation()).rejects.toMatchObject({ init: { status } });
  expect(db.$client.serialize().equals(before)).toBe(true);
  expect(notifications.sent).toEqual(sent);
  expect(await notifications.feedOf(fixture.instructor.id)).toEqual(feed);
}

type Operation = "read" | "save" | "delete";
async function operate(
  operation: Operation,
  userId: number | undefined,
  courseId: unknown = fixture.course.id,
  lessonId: unknown = fixture.lesson.id
) {
  if (operation === "read")
    return getQuizEditor(db, await requestAs(userId), courseId, lessonId);
  const request =
    operation === "save"
      ? await saveRequest(userId, editableQuiz(quiz), quiz.id)
      : await quizRequest(userId, {
          intent: "delete-quiz",
          quizId: String(quiz.id),
        });
  return updateQuizEditor(db, request, courseId, lessonId);
}

it.each(["read", "save", "delete"] as const)(
  "permits Platform Admin %s of another Instructor's quiz",
  async (operation) => {
    await expect(operate(operation, fixture.admin.id)).resolves.toBeDefined();
  }
);

it.each(["read", "save", "delete"] as const)(
  "rejects an enrolled Student, unrelated Instructor, and demoted owner for %s",
  async (operation) => {
    await rejectsUnchanged(() => operate(operation, fixture.user.id), 403);
    await rejectsUnchanged(
      () => operate(operation, fixture.otherInstructor.id),
      403
    );
    await enrollStudent(
      db,
      fixture.instructor.id,
      fixture.course.id,
      new Date("2026-11-24T12:00:00Z"),
      notifications
    );
    const request = await requestAs(fixture.instructor.id);
    demote(db, fixture.instructor.id);
    if (operation === "read") {
      await rejectsUnchanged(
        () => getQuizEditor(db, request, fixture.course.id, fixture.lesson.id),
        403
      );
    } else {
      await rejectsUnchanged(
        () => operate(operation, fixture.instructor.id),
        403
      );
    }
  }
);

it.each(["read", "save", "delete"] as const)(
  "authenticates signed-out and stale identities before malformed %s input",
  async (operation) => {
    for (const userId of [undefined, 99999]) {
      if (operation === "read") {
        await rejectsUnchanged(
          () => operate(operation, userId, "bad", "bad"),
          401
        );
      } else {
        const request = new Request(await requestAs(userId), {
          method: "POST",
          body: "not form data",
        });
        await rejectsUnchanged(
          () => updateQuizEditor(db, request, "bad", "bad"),
          401
        );
      }
    }
  }
);

it.each(["read", "save", "delete"] as const)(
  "validates %s target identifiers before existing-course permission",
  async (operation) => {
    for (const invalid of [
      "",
      "0",
      "-1",
      "1.5",
      "1suffix",
      "9007199254740992",
      true,
      null,
    ]) {
      await rejectsUnchanged(
        () => operate(operation, fixture.user.id, invalid),
        400
      );
      await rejectsUnchanged(
        () => operate(operation, fixture.user.id, fixture.course.id, invalid),
        400
      );
    }
  }
);

it.each(["read", "save", "delete"] as const)(
  "resolves %s course and actual lesson section before checking permission",
  async (operation) => {
    for (const userId of [fixture.user.id, fixture.admin.id]) {
      await rejectsUnchanged(() => operate(operation, userId, 99999), 404);
      await rejectsUnchanged(
        () => operate(operation, userId, fixture.course.id, 99999),
        404
      );
      await rejectsUnchanged(
        () => operate(operation, userId, fixture.course.id, otherQuiz.lessonId),
        404
      );
      await rejectsUnchanged(
        () =>
          operate(operation, userId, fixture.otherCourse.id, fixture.lesson.id),
        404
      );
    }
  }
);

it.each(["save-quiz", "delete-quiz"])(
  "rejects foreign, sibling, and missing quiz IDs for %s before permission",
  async (intent) => {
    for (const userId of [fixture.user.id, fixture.admin.id]) {
      for (const quizId of [otherQuiz.id, siblingQuiz.id, 99999]) {
        const request =
          intent === "save-quiz"
            ? await saveRequest(userId, editableQuiz(quiz), quizId)
            : await quizRequest(userId, { intent, quizId: String(quizId) });
        await rejectsUnchanged(
          () =>
            updateQuizEditor(db, request, fixture.course.id, fixture.lesson.id),
          404
        );
      }
    }
  }
);

it.each([
  "foreign question",
  "sibling question",
  "missing question",
  "missing eight-digit question",
  "foreign option",
  "sibling option",
  "missing option",
  "another local question's option",
  "existing option under temporary question",
])("rejects %s without replacing any assessment", async (kind) => {
  for (const userId of [fixture.user.id, fixture.admin.id]) {
    const content = editableQuiz(quiz);
    const question = content.questions[1];
    if (kind === "foreign question")
      question.id = String(otherQuiz.questions[0].id);
    if (kind === "sibling question")
      question.id = String(siblingQuiz.questions[0].id);
    if (kind === "missing question") question.id = "99999";
    if (kind === "missing eight-digit question") question.id = "12345678";
    if (kind === "foreign option")
      question.options[0].id = String(otherQuiz.questions[0].options[0].id);
    if (kind === "sibling option")
      question.options[0].id = String(siblingQuiz.questions[0].options[0].id);
    if (kind === "missing option") question.options[0].id = "99999";
    if (kind === "another local question's option") {
      question.options[0].id = String(quiz.questions[0].options[0].id);
      content.questions[0].options[0].id = "new-replaced";
    }
    if (kind === "existing option under temporary question")
      question.id = "new-a1b2c3d4";
    const request = await saveRequest(userId, content, quiz.id);
    await rejectsUnchanged(
      () => updateQuizEditor(db, request, fixture.course.id, fixture.lesson.id),
      404
    );
  }
});

it("accepts legacy base36 temporary items and prefixed all-digit temporary items", async () => {
  const content = quizContent();
  content.questions[0].id = "a1234567";
  content.questions[0].options[0].id = "b1234567";
  content.questions[1].id = "new-12345678";
  content.questions[1].options[0].id = "new-87654321";
  await expect(
    updateQuizEditor(
      db,
      await saveRequest(fixture.instructor.id, content, quiz.id),
      fixture.course.id,
      fixture.lesson.id
    )
  ).resolves.toEqual({ success: true });
});
