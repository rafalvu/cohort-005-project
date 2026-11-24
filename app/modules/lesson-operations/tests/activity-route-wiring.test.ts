import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { db } from "~/db";
import { completeLesson, recordVideoEvent } from "../activity.server";
import { action as completeAction } from "~/routes/courses.$slug.lessons.$lessonId";
import { action as videoAction } from "~/routes/api.video-tracking";
import { requestFor } from "./fixtures";

vi.mock("~/db", async () => {
  const { lessonFixture } = await import("./fixtures");
  return { db: (await lessonFixture()).db };
});
vi.mock("../activity.server", () => ({
  completeLesson: vi.fn(),
  recordVideoEvent: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
afterAll(() => db.$client.close());

it("the direct video action delegates the original Request to the complete guarded operation", async () => {
  const request = new Request("http://localhost/api/video-tracking", {
    method: "POST",
    body: "unparsed",
  });
  vi.mocked(recordVideoEvent).mockResolvedValue({ success: true });
  const result = await videoAction({
    request,
    params: {},
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/api/video-tracking",
  });
  expect(recordVideoEvent).toHaveBeenCalledExactlyOnceWith(db, request);
  expect(result).toEqual({ success: true });
});

it("the completion action delegates untrusted targets and the full command before course lookup", async () => {
  const session = await requestFor(1);
  const request = new Request(session.url, {
    method: "POST",
    headers: session.headers,
    body: new URLSearchParams({ intent: "mark-complete" }),
  });
  const params = { slug: "missing-course", lessonId: "not-a-number" };
  vi.mocked(completeLesson).mockResolvedValue({ success: true });
  const result = await completeAction({
    request,
    params,
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/courses/:slug/lessons/:lessonId",
  });
  expect(completeLesson).toHaveBeenCalledExactlyOnceWith(
    db,
    request,
    params,
    expect.any(FormData)
  );
  const command = vi.mocked(completeLesson).mock.calls[0]?.[3];
  expect(command?.get("intent")).toBe("mark-complete");
  expect(result).toEqual({ success: true });
});

it.each([null, 999999])(
  "the completion action authenticates identity %s before parsing the command or target",
  async (userId) => {
    const session = await requestFor(userId);
    const request = new Request(session.url, {
      method: "POST",
      headers: session.headers,
      body: "malformed",
    });
    await expect(
      completeAction({
        request,
        params: { slug: "missing-course", lessonId: "invalid" },
        context: new RouterContextProvider(),
        url: new URL(request.url),
        pattern: "/courses/:slug/lessons/:lessonId",
      })
    ).rejects.toMatchObject({ init: { status: 401 } });
    expect(completeLesson).not.toHaveBeenCalled();
  }
);

it("the lesson action throws 400 for an unreadable command after authenticating", async () => {
  const session = await requestFor(1);
  const request = new Request(session.url, {
    method: "POST",
    headers: session.headers,
    body: "malformed",
  });
  await expect(
    completeAction({
      request,
      params: { slug: "missing-course", lessonId: "invalid" },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    })
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(completeLesson).not.toHaveBeenCalled();
});
