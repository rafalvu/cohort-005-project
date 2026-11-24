import { afterEach, beforeEach, expect, it } from "vitest";
import {
  getQuizEditor,
  updateQuizEditor,
} from "~/modules/instructor-operations/quiz.server";
import { QuestionType, quizAttempts, quizAnswers } from "~/db/schema";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { createTestDb, type TestDb } from "~/test/setup";
import { requestAs, seedEditor } from "./course-editor-fixtures";
import {
  saveRequest,
  createQuiz,
  editableQuiz,
  quizRequest,
  addAttempt,
  quizContent,
} from "./quiz-fixtures";

let db: TestDb;
let fixture: ReturnType<typeof seedEditor>;
beforeEach(() => {
  db = createTestDb();
  fixture = seedEditor(db);
});

it("creates an ordered quiz with trimmed text and the configured correct answers", async () => {
  expect(
    await updateQuizEditor(
      db,
      await saveRequest(fixture.instructor.id),
      fixture.course.id,
      fixture.lesson.id
    )
  ).toEqual({ success: true });
  const editor = await getQuizEditor(
    db,
    await requestAs(fixture.instructor.id),
    fixture.course.id,
    fixture.lesson.id
  );
  expect(editor.existingQuiz).toMatchObject({
    lessonId: fixture.lesson.id,
    title: "Course assessment",
    passingScore: 0.8,
    questions: [
      {
        questionText: "Which answer is correct?",
        questionType: QuestionType.MultipleChoice,
        position: 1,
        options: [
          { optionText: "First", isCorrect: false },
          { optionText: "Second", isCorrect: true },
        ],
      },
      {
        questionText: "This is false.",
        questionType: QuestionType.TrueFalse,
        position: 2,
        options: [
          { optionText: "True", isCorrect: false },
          { optionText: "False", isCorrect: true },
        ],
      },
    ],
  });
});
afterEach(() => db.$client.close());

it("lets the owning Instructor inspect a lesson before creating its quiz", async () => {
  const before = db.$client.serialize();
  expect(
    await getQuizEditor(
      db,
      await requestAs(fixture.instructor.id),
      String(fixture.course.id),
      String(fixture.lesson.id)
    )
  ).toMatchObject({
    course: { id: fixture.course.id, title: fixture.course.title },
    lesson: { id: fixture.lesson.id, title: "First lesson" },
    module: { id: fixture.section.id },
    existingQuiz: null,
  });
  expect(db.$client.serialize().equals(before)).toBe(true);
});

it("replaces a quiz and its attempts while keeping edited correct answers and ordering", async () => {
  const quiz = await createQuiz(
    db,
    fixture.instructor.id,
    fixture.course.id,
    fixture.lesson.id
  );
  const notifications = fakeNotifications();
  await addAttempt(db, fixture.user.id, fixture.course, quiz, notifications);
  const sent = [...notifications.sent];
  const content = editableQuiz(quiz);
  content.title = "Replacement quiz";
  content.passingScore = 50;
  content.questions.reverse();
  content.questions[0].options[0].isCorrect = true;
  content.questions[0].options[1].isCorrect = false;
  expect(
    await updateQuizEditor(
      db,
      await saveRequest(fixture.instructor.id, content, quiz.id),
      fixture.course.id,
      fixture.lesson.id
    )
  ).toEqual({ success: true });
  const editor = await getQuizEditor(
    db,
    await requestAs(fixture.instructor.id),
    fixture.course.id,
    fixture.lesson.id
  );
  expect(editor.existingQuiz).toMatchObject({
    title: "Replacement quiz",
    passingScore: 0.5,
    questions: [
      {
        questionText: "This is false.",
        position: 1,
        options: [
          { optionText: "True", isCorrect: true },
          { optionText: "False", isCorrect: false },
        ],
      },
      { questionText: "Which answer is correct?", position: 2 },
    ],
  });
  expect(db.select().from(quizAttempts).all()).toEqual([]);
  expect(db.select().from(quizAnswers).all()).toEqual([]);
  expect(notifications.sent).toEqual(sent);
});

it("deletes a quiz with attempts and permits repeating deletion of a lesson without a quiz", async () => {
  const quiz = await createQuiz(
    db,
    fixture.instructor.id,
    fixture.course.id,
    fixture.lesson.id
  );
  const notifications = fakeNotifications();
  await addAttempt(db, fixture.user.id, fixture.course, quiz, notifications);
  for (const fields of [
    { intent: "delete-quiz", quizId: String(quiz.id) },
    { intent: "delete-quiz" },
  ]) {
    expect(
      await updateQuizEditor(
        db,
        await quizRequest(fixture.instructor.id, fields),
        fixture.course.id,
        fixture.lesson.id
      )
    ).toEqual({ success: true, deleted: true });
  }
  expect(
    (
      await getQuizEditor(
        db,
        await requestAs(fixture.instructor.id),
        fixture.course.id,
        fixture.lesson.id
      )
    ).existingQuiz
  ).toBeNull();
  expect(db.select().from(quizAttempts).all()).toEqual([]);
  expect(db.select().from(quizAnswers).all()).toEqual([]);
});

it.each(["save-quiz", "delete-quiz"])(
  "rolls back all quiz and attempt changes if %s fails after deleting answers",
  async (intent) => {
    const quiz = await createQuiz(
      db,
      fixture.instructor.id,
      fixture.course.id,
      fixture.lesson.id
    );
    const notifications = fakeNotifications();
    await addAttempt(db, fixture.user.id, fixture.course, quiz, notifications);
    db.$client.exec(
      "CREATE TRIGGER fail_quiz_delete BEFORE DELETE ON quizzes BEGIN SELECT RAISE(ABORT, 'late deletion failure'); END"
    );
    const before = db.$client.serialize();
    const sent = [...notifications.sent];
    const request =
      intent === "save-quiz"
        ? await saveRequest(fixture.instructor.id, editableQuiz(quiz), quiz.id)
        : await quizRequest(fixture.instructor.id, {
            intent,
            quizId: String(quiz.id),
          });
    await expect(
      updateQuizEditor(db, request, fixture.course.id, fixture.lesson.id)
    ).rejects.toThrow("late deletion failure");
    expect(db.$client.serialize().equals(before)).toBe(true);
    expect(notifications.sent).toEqual(sent);
  }
);

it("restores the original quiz and attempts when replacement fails while creating later options", async () => {
  const quiz = await createQuiz(
    db,
    fixture.instructor.id,
    fixture.course.id,
    fixture.lesson.id
  );
  const notifications = fakeNotifications();
  await addAttempt(db, fixture.user.id, fixture.course, quiz, notifications);
  const content = editableQuiz(quiz);
  content.questions[1].options[1].text = "Rejected replacement option";
  db.$client.exec(
    "CREATE TRIGGER fail_new_option BEFORE INSERT ON quiz_options WHEN NEW.option_text = 'Rejected replacement option' BEGIN SELECT RAISE(ABORT, 'late creation failure'); END"
  );
  const before = db.$client.serialize();
  const sent = [...notifications.sent];
  await expect(
    updateQuizEditor(
      db,
      await saveRequest(fixture.instructor.id, content, quiz.id),
      fixture.course.id,
      fixture.lesson.id
    )
  ).rejects.toThrow("late creation failure");
  expect(db.$client.serialize().equals(before)).toBe(true);
  expect(notifications.sent).toEqual(sent);
  expect(
    (
      await getQuizEditor(
        db,
        await requestAs(fixture.instructor.id),
        fixture.course.id,
        fixture.lesson.id
      )
    ).existingQuiz
  ).toEqual(quiz);
});

it.each([
  ["blank title", (content) => ({ ...content, title: "  " })],
  ["negative score", (content) => ({ ...content, passingScore: -1 })],
  ["score above 100", (content) => ({ ...content, passingScore: 101 })],
  ["nonnumeric score", (content) => ({ ...content, passingScore: "80" })],
  ["no questions", (content) => ({ ...content, questions: [] })],
  [
    "blank question",
    (content) => ({
      ...content,
      questions: [{ ...content.questions[0], text: " " }],
    }),
  ],
  [
    "invalid question type",
    (content) => ({
      ...content,
      questions: [{ ...content.questions[0], type: "essay" }],
    }),
  ],
  [
    "one option",
    (content) => ({
      ...content,
      questions: [
        { ...content.questions[0], options: [content.questions[0].options[1]] },
      ],
    }),
  ],
  [
    "empty option",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            text: " ",
          })),
        },
      ],
    }),
  ],
  [
    "no correct answer",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            isCorrect: false,
          })),
        },
      ],
    }),
  ],
  [
    "two correct answers",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            isCorrect: true,
          })),
        },
      ],
    }),
  ],
  [
    "nonboolean correct answer",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            isCorrect: "true",
          })),
        },
      ],
    }),
  ],
  [
    "three true/false options",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[1],
          options: [
            ...content.questions[1].options,
            { id: "new-g1b2c3d4", text: "Third", isCorrect: false },
          ],
        },
      ],
    }),
  ],
  [
    "duplicate question IDs",
    (content) => ({
      ...content,
      questions: [content.questions[0], content.questions[0]],
    }),
  ],
  [
    "duplicate option IDs",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            id: "new-b1b2c3d4",
          })),
        },
      ],
    }),
  ],
  [
    "option ID reused across questions",
    (content) => ({
      ...content,
      questions: content.questions.map((q) => ({
        ...q,
        options: content.questions[0].options,
      })),
    }),
  ],
  [
    "blank question ID",
    (content) => ({
      ...content,
      questions: [{ ...content.questions[0], id: "" }],
    }),
  ],
  [
    "negative question ID",
    (content) => ({
      ...content,
      questions: [{ ...content.questions[0], id: "-1" }],
    }),
  ],
  [
    "unsafe question ID",
    (content) => ({
      ...content,
      questions: [{ ...content.questions[0], id: "9007199254740992" }],
    }),
  ],
  [
    "fractional option ID",
    (content) => ({
      ...content,
      questions: [
        {
          ...content.questions[0],
          options: content.questions[0].options.map((o) => ({
            ...o,
            id: "1.5",
          })),
        },
      ],
    }),
  ],
] satisfies [string, (content: ReturnType<typeof quizContent>) => unknown][])(
  "rejects %s before resolving targets or changing the quiz",
  async (_name, change) => {
    await createQuiz(
      db,
      fixture.instructor.id,
      fixture.course.id,
      fixture.lesson.id
    );
    const before = db.$client.serialize();
    await expect(
      updateQuizEditor(
        db,
        await saveRequest(fixture.user.id, change(quizContent())),
        99999,
        99999
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize().equals(before)).toBe(true);
  }
);

it.each([
  { intent: "save-quiz", wizardData: "broken" },
  { intent: "save-quiz", wizardData: "null" },
  { intent: "save-quiz" },
  { intent: "delete-quiz", quizId: "1suffix" },
  { intent: "delete-quiz", unexpected: "field" },
  { intent: "unknown" },
])(
  "throws 400 for malformed command %j without changing quiz records",
  async (fields) => {
    await createQuiz(
      db,
      fixture.instructor.id,
      fixture.course.id,
      fixture.lesson.id
    );
    const before = db.$client.serialize();
    const request = await quizRequest(fixture.user.id, fields);
    await expect(
      updateQuizEditor(db, request, fixture.course.id, fixture.lesson.id)
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(db.$client.serialize().equals(before)).toBe(true);
  }
);

it.each(["malformed body", "duplicate fields", "file field"])(
  "rejects %s as 400",
  async (kind) => {
    const body = new FormData();
    body.set("intent", "delete-quiz");
    if (kind === "duplicate fields") body.append("intent", "delete-quiz");
    if (kind === "file field") body.set("quizId", new Blob(["1"]), "quiz.txt");
    const request = new Request(await requestAs(fixture.user.id), {
      method: "POST",
      body: kind === "malformed body" ? "not form data" : body,
    });
    await expect(
      updateQuizEditor(db, request, fixture.course.id, fixture.lesson.id)
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
);
