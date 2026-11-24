import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { data, RouterContextProvider } from "react-router";
import { db } from "~/db";
import { action } from "~/routes/courses.$slug.lessons.$lessonId";
import { submitQuiz } from "../quizzes.server";
import { requestFor } from "./fixtures";

vi.mock("~/db", async () => {
  const { lessonFixture } = await import("./fixtures");
  return { db: (await lessonFixture()).db };
});
vi.mock("../quizzes.server", () => ({ submitQuiz: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
afterAll(() => db.$client.close());

it("delegates the direct quiz action with its original Request, raw target and all duplicate form entries", async () => {
  const session = await requestFor(1);
  const form = new URLSearchParams({ intent: "submit-quiz", quizId: "1" });
  form.append("question-1", "1");
  form.append("question-1", "2");
  const request = new Request(session.url, {
    method: "POST",
    headers: session.headers,
    body: form,
  });
  const params = { slug: "missing-course", lessonId: "unparsed" };
  const result = {
    quizResult: {
      attemptId: 17,
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 1,
      totalQuestions: 1,
      questionResults: [],
    },
  };
  vi.mocked(submitQuiz).mockResolvedValue(result);
  await expect(
    action({
      request,
      params,
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    })
  ).resolves.toEqual(result);
  expect(submitQuiz).toHaveBeenCalledExactlyOnceWith(
    db,
    request,
    params,
    expect.any(FormData)
  );
  const command = vi.mocked(submitQuiz).mock.calls[0]?.[3];
  expect(command?.getAll("question-1")).toEqual(["1", "2"]);
});

it("preserves the guarded quiz operation's thrown rejection", async () => {
  const session = await requestFor(1);
  const request = new Request(session.url, {
    method: "POST",
    headers: session.headers,
    body: new URLSearchParams({ intent: "submit-quiz" }),
  });
  const rejected = data("Quiz not found", { status: 404 });
  vi.mocked(submitQuiz).mockRejectedValue(rejected);
  await expect(
    action({
      request,
      params: { slug: "test-course", lessonId: "2" },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    })
  ).rejects.toBe(rejected);
});
