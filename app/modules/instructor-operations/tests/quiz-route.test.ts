import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import {
  action,
  loader,
} from "~/routes/instructor.$courseId.lessons.$lessonId.quiz";
import { createTestDb, type TestDb } from "~/test/setup";
import { requestAs, seedEditor } from "./course-editor-fixtures";
import {
  quizRequest,
  saveRequest,
  quizContent,
  editableQuiz,
} from "./quiz-fixtures";

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
let fixture: ReturnType<typeof seedEditor>;
beforeEach(() => {
  db = createTestDb();
  fixture = seedEditor(db);
  database.current = db;
});
afterEach(() => {
  db.$client.close();
  database.current = undefined;
});

function args(
  request: Request,
  courseId = String(fixture.course.id),
  lessonId = String(fixture.lesson.id)
) {
  return {
    request,
    params: { courseId, lessonId },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/instructor/:courseId/lessons/:lessonId/quiz",
  };
}

it("authenticates stale direct actions before parsing a malformed body", async () => {
  const request = new Request(await requestAs(99999), {
    method: "POST",
    body: "not form data",
  });
  await expect(action(args(request, "invalid"))).rejects.toMatchObject({
    init: { status: 401 },
  });
});

it("validates the complete loader target without truncating identifiers", async () => {
  await expect(
    loader(
      args(await requestAs(fixture.instructor.id), `${fixture.course.id}suffix`)
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
});

it("rejects a stale loader session", async () => {
  await expect(loader(args(await requestAs(99999)))).rejects.toMatchObject({
    init: { status: 401 },
  });
});

it.each(["save-quiz", "delete-quiz"])(
  "guards direct %s independently of its loader",
  async (intent) => {
    const before = db.$client.serialize();
    const request =
      intent === "save-quiz"
        ? await saveRequest(fixture.user.id)
        : await quizRequest(fixture.user.id, { intent });
    await expect(action(args(request))).rejects.toMatchObject({
      init: { status: 403 },
    });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it("throws malformed nested data before permission on a direct action", async () => {
  const request = await saveRequest(fixture.user.id, {
    ...quizContent(),
    passingScore: 101,
  });
  await expect(action(args(request))).rejects.toMatchObject({
    init: { status: 400 },
  });
});

it("rejects nonexistent numeric questions before a direct action writes", async () => {
  const content = quizContent();
  content.questions[0].id = "12345678";
  const before = db.$client.serialize();
  await expect(
    action(args(await saveRequest(fixture.instructor.id, content)))
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(db.$client.serialize()).toEqual(before);
});

it("wires save, editor read, and deletion with their existing success responses", async () => {
  expect(await action(args(await saveRequest(fixture.instructor.id)))).toEqual({
    success: true,
  });
  const editor = await loader(args(await requestAs(fixture.instructor.id)));
  expect(editor).toMatchObject({
    existingQuiz: {
      title: "Course assessment",
      passingScore: 0.8,
      questions: [
        { options: [{ isCorrect: false }, { isCorrect: true }] },
        { options: [{ isCorrect: false }, { isCorrect: true }] },
      ],
    },
  });
  expect(
    await action(
      args(await quizRequest(fixture.instructor.id, { intent: "delete-quiz" }))
    )
  ).toEqual({ success: true, deleted: true });
  expect(
    (await loader(args(await requestAs(fixture.instructor.id)))).existingQuiz
  ).toBeNull();
});

it("supports reopening and saving a replacement, then deleting and recreating the quiz", async () => {
  await action(args(await saveRequest(fixture.instructor.id)));
  const initial = (await loader(args(await requestAs(fixture.instructor.id))))
    .existingQuiz;
  if (!initial) throw new Error("Expected initial quiz");
  for (const title of ["First edit", "Second edit"]) {
    const reopened = (
      await loader(args(await requestAs(fixture.instructor.id)))
    ).existingQuiz;
    if (!reopened) throw new Error("Expected reopened quiz");
    expect(
      await action(
        args(
          await saveRequest(
            fixture.instructor.id,
            {
              ...editableQuiz(reopened),
              title,
            },
            reopened.id
          )
        )
      )
    ).toEqual({ success: true });
    expect(
      (await loader(args(await requestAs(fixture.instructor.id)))).existingQuiz
        ?.title
    ).toBe(title);
  }
  const beforeStaleSave = db.$client.serialize();
  await expect(
    action(
      args(await saveRequest(fixture.instructor.id, editableQuiz(initial)))
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(db.$client.serialize()).toEqual(beforeStaleSave);
  const latest = (await loader(args(await requestAs(fixture.instructor.id))))
    .existingQuiz;
  if (!latest) throw new Error("Expected latest quiz");
  expect(
    await action(
      args(
        await quizRequest(fixture.instructor.id, {
          intent: "delete-quiz",
          quizId: String(latest.id),
        })
      )
    )
  ).toEqual({ success: true, deleted: true });
  expect(await action(args(await saveRequest(fixture.instructor.id)))).toEqual({
    success: true,
  });
  expect(
    (await loader(args(await requestAs(fixture.instructor.id)))).existingQuiz
      ?.title
  ).toBe("Course assessment");
});
