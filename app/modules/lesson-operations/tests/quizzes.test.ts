import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { submitQuiz } from "../quizzes.server";
import { quizFixture, requestFor } from "./quiz-fixtures";

let fixture: Awaited<ReturnType<typeof quizFixture>>;
beforeEach(async () => {
  fixture = await quizFixture();
});
afterEach(() => fixture.db.$client.close());

it("scores a qualified Student's submitted answers and returns supported feedback", async () => {
  await fixture.enroll();
  fixture.notifications.sent.length = 0;
  const second = fixture.addQuestion();
  const result = await submitQuiz(
    fixture.db,
    await requestFor(fixture.user.id),
    fixture.target,
    fixture.form([
      [fixture.question.id, fixture.correctOption.id],
      [second.question.id, second.incorrectOption.id],
    ])
  );
  expect(result).toEqual({
    quizResult: {
      attemptId: expect.any(Number),
      score: 0.5,
      passed: false,
      grade: "F",
      totalCorrect: 1,
      totalQuestions: 2,
      questionResults: [
        {
          questionId: fixture.question.id,
          correct: true,
          selectedOptionId: fixture.correctOption.id,
          correctOptionId: fixture.correctOption.id,
        },
        {
          questionId: second.question.id,
          correct: false,
          selectedOptionId: second.incorrectOption.id,
          correctOptionId: second.correctOption.id,
        },
      ],
    },
  });
  expect(fixture.state()).toEqual({
    attempts: [
      {
        id: result.quizResult.attemptId,
        userId: fixture.user.id,
        quizId: fixture.quiz.id,
        score: 0.5,
        passed: false,
        attemptedAt: expect.any(String),
      },
    ],
    answers: [
      {
        id: expect.any(Number),
        attemptId: result.quizResult.attemptId,
        questionId: fixture.question.id,
        selectedOptionId: fixture.correctOption.id,
      },
      {
        id: expect.any(Number),
        attemptId: result.quizResult.attemptId,
        questionId: second.question.id,
        selectedOptionId: second.incorrectOption.id,
      },
    ],
    progress: [],
    watched: [],
    notifications: [],
  });
});

it("does not let an owning Instructor submit without Student qualification", async () => {
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.instructor.id),
      fixture.target,
      fixture.form()
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(fixture.state()).toEqual(before);
});

it("rejects a quiz from another course before checking Student qualification", async () => {
  const foreign = await fixture.otherQuiz();
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      fixture.form(
        [[foreign.question.id, foreign.correctOption.id]],
        foreign.quiz.id
      )
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(fixture.state()).toEqual(before);
});

it("rejects a foreign answer after a valid answer without persisting any part of the attempt", async () => {
  await fixture.enroll();
  const foreign = await fixture.otherQuiz();
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      fixture.form([
        [fixture.question.id, fixture.correctOption.id],
        [foreign.question.id, foreign.correctOption.id],
      ])
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(fixture.state()).toEqual(before);
});

it("rejects duplicate question identifiers before ancestry or qualification checks", async () => {
  const form = fixture.form([
    [fixture.question.id, fixture.correctOption.id],
    [fixture.question.id, fixture.correctOption.id],
  ]);
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      { ...fixture.target, lessonId: "9999" },
      form
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(fixture.state()).toEqual(before);
});

it("rolls back an attempt and preceding answers if storing a later answer fails", async () => {
  await fixture.enroll();
  const second = fixture.addQuestion();
  fixture.rejectAnswerWrite(second.correctOption.id);
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      fixture.form([
        [fixture.question.id, fixture.correctOption.id],
        [second.question.id, second.correctOption.id],
      ])
    )
  ).rejects.toThrow("Answer storage unavailable");
  expect(fixture.state()).toEqual(before);
});

describe.each([
  "Student",
  "owning Instructor",
  "other Instructor",
  "Platform Admin",
  "demoted owner",
] as const)("%s participation", (kind) => {
  it("rejects a valid submission without Enrollment", async () => {
    const person = fixture.person(kind);
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(person.id),
        fixture.target,
        fixture.form()
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(fixture.state()).toEqual(before);
  });

  it("allows an Enrollment with no surviving Purchase evidence", async () => {
    const person = fixture.person(kind);
    await fixture.enroll(person.id);
    const before = fixture.state();
    const result = await submitQuiz(
      fixture.db,
      await requestFor(person.id),
      fixture.target,
      fixture.form()
    );
    expect(result.quizResult).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
    });
    expect(fixture.state().attempts).toMatchObject([
      { userId: person.id, quizId: fixture.quiz.id, score: 1, passed: true },
    ]);
    expect(fixture.state().progress).toEqual(before.progress);
    expect(fixture.state().notifications).toEqual(before.notifications);
  });

  it("rejects country-blocked Enrollment without changing any records", async () => {
    const person = fixture.person(kind);
    await fixture.enroll(person.id);
    fixture.purchase("IN", person.id);
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(person.id, "US"),
        fixture.target,
        fixture.form()
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(fixture.state()).toEqual(before);
  });
});

it.each([null, 999999])(
  "rejects signed-out or stale identity %s before malformed command or missing target",
  async (userId) => {
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(userId),
        { slug: "missing", lessonId: "bad" },
        new FormData()
      )
    ).rejects.toMatchObject({ init: { status: 401 } });
    expect(fixture.state()).toEqual(before);
  }
);

it("accepts a surviving qualifying Purchase alongside a blocked Purchase", async () => {
  await fixture.enroll();
  fixture.purchase("IN");
  fixture.purchase("US");
  const result = await submitQuiz(
    fixture.db,
    await requestFor(fixture.user.id),
    fixture.target,
    fixture.form()
  );
  expect(result.quizResult.passed).toBe(true);
});

it("accepts a qualifying Claimed Seat alongside a blocked Individual Purchase", async () => {
  await fixture.claim("US");
  fixture.purchase("IN");
  const result = await submitQuiz(
    fixture.db,
    await requestFor(fixture.user.id),
    fixture.target,
    fixture.form()
  );
  expect(result.quizResult.passed).toBe(true);
});

it("applies a Claimed Seat's ongoing country restriction to quiz participation", async () => {
  await fixture.claim("IN");
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      fixture.form()
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(fixture.state()).toEqual(before);
});

it("preserves a previous attempt, completed progress, Watched time and Notifications when a later attempt is denied", async () => {
  await fixture.enroll();
  await fixture.privateData();
  await submitQuiz(
    fixture.db,
    await requestFor(fixture.user.id),
    fixture.target,
    fixture.form()
  );
  fixture.purchase("IN");
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      fixture.form()
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(fixture.state()).toEqual(before);
});

it.each([
  [6, 0.6, false, "D"],
  [7, 0.7, false, "C"],
  [8, 0.8, true, "B"],
  [9, 0.9, true, "A"],
  [10, 1, true, "A"],
])(
  "preserves the original threshold and grade for %i correct answers",
  async (correctCount, score, passed, grade) => {
    await fixture.enroll();
    const questions = [
      fixture,
      ...Array.from({ length: 9 }, (_, index) =>
        fixture.addQuestion(fixture.quiz.id, index + 1)
      ),
    ];
    const form = fixture.form(
      questions.map((question, index) => [
        question.question.id,
        index < Number(correctCount)
          ? question.correctOption.id
          : question.incorrectOption.id,
      ])
    );
    const result = await submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      form
    );
    expect(result.quizResult).toMatchObject({
      score,
      passed,
      grade,
      totalCorrect: correctCount,
      totalQuestions: 10,
    });
    expect(fixture.state().progress).toEqual([]);
  }
);

it("scores unanswered questions as incorrect and does not invent saved answers or answer-key feedback", async () => {
  await fixture.enroll();
  const result = await submitQuiz(
    fixture.db,
    await requestFor(fixture.user.id),
    fixture.target,
    fixture.form([])
  );
  expect(result.quizResult).toMatchObject({
    score: 0,
    passed: false,
    grade: "F",
    totalCorrect: 0,
    totalQuestions: 1,
    questionResults: [
      {
        questionId: fixture.question.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      },
    ],
  });
  expect(fixture.state().answers).toEqual([]);
});

it.each([
  "",
  "0",
  "-1",
  "1.5",
  "1e0",
  "+1",
  " 1",
  "01",
  "NaN",
  "9007199254740992",
  "1\n",
])(
  "rejects malformed quiz identifier %j before missing ancestry",
  async (quizId) => {
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(fixture.user.id),
        { ...fixture.target, lessonId: "9999" },
        fixture.form([], quizId)
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(fixture.state()).toEqual(before);
  }
);

it.each(["", "0", "-1", "1.5", "01", "1e0", "1\n"])(
  "rejects malformed question identifier %j",
  async (questionId) => {
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(fixture.user.id),
        fixture.target,
        fixture.form([[questionId, fixture.correctOption.id]])
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(fixture.state()).toEqual(before);
  }
);

it.each(["", "0", "-1", "1.5", "01", "1e0", "1\n"])(
  "rejects malformed option identifier %j",
  async (optionId) => {
    const before = fixture.state();
    await expect(
      submitQuiz(
        fixture.db,
        await requestFor(fixture.user.id),
        fixture.target,
        fixture.form([[fixture.question.id, optionId]])
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(fixture.state()).toEqual(before);
  }
);

it.each(["intent", "quizId"])("rejects duplicate %s fields", async (name) => {
  const form = fixture.form();
  form.append(
    name,
    name === "intent" ? "submit-quiz" : String(fixture.quiz.id)
  );
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      form
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(fixture.state()).toEqual(before);
});

it.each(["intent", "quizId"])("rejects a missing %s", async (name) => {
  const form = fixture.form();
  form.delete(name);
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      form
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(fixture.state()).toEqual(before);
});

it("rejects file values and unknown command fields", async () => {
  const before = fixture.state();
  const form = fixture.form();
  form.set(
    `question-${fixture.question.id}`,
    new Blob([String(fixture.correctOption.id)]),
    "answer.txt"
  );
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      form
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  const unknown = fixture.form();
  unknown.set("answer", "1");
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      fixture.target,
      unknown
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(fixture.state()).toEqual(before);
});

it.each([
  "missing quiz",
  "missing question",
  "missing option",
  "foreign question",
  "foreign option",
  "other question option",
  "other lesson quiz",
  "foreign lesson",
  "missing lesson",
  "missing course",
])("rejects %s before permission even for a Platform Admin", async (kind) => {
  const person = fixture.person("Platform Admin");
  const foreign = await fixture.otherQuiz();
  const otherQuestion = fixture.addQuestion();
  let target = fixture.target;
  let form = fixture.form();
  if (kind === "missing quiz") form = fixture.form([], 9999);
  if (kind === "missing question")
    form = fixture.form([[9999, fixture.correctOption.id]]);
  if (kind === "missing option")
    form = fixture.form([[fixture.question.id, 9999]]);
  if (kind === "foreign question")
    form = fixture.form([[foreign.question.id, foreign.correctOption.id]]);
  if (kind === "foreign option")
    form = fixture.form([[fixture.question.id, foreign.correctOption.id]]);
  if (kind === "other question option")
    form = fixture.form([
      [fixture.question.id, otherQuestion.correctOption.id],
    ]);
  if (kind === "other lesson quiz")
    target = { ...fixture.target, lessonId: String(fixture.previous.id) };
  if (kind === "foreign lesson")
    target = { ...fixture.target, lessonId: String(foreign.lesson.id) };
  if (kind === "missing lesson")
    target = { ...fixture.target, lessonId: "9999" };
  if (kind === "missing course")
    target = { ...fixture.target, slug: "missing-course" };
  const before = fixture.state();
  await expect(
    submitQuiz(fixture.db, await requestFor(person.id), target, form)
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(fixture.state()).toEqual(before);
});

it.each([
  undefined,
  {},
  { slug: "", lessonId: "1" },
  { slug: "test-course", lessonId: "bad" },
  { slug: "test-course", lessonId: "1\n" },
])("rejects malformed lesson targets %j", async (target) => {
  const before = fixture.state();
  await expect(
    submitQuiz(
      fixture.db,
      await requestFor(fixture.user.id),
      target,
      fixture.form()
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(fixture.state()).toEqual(before);
});
