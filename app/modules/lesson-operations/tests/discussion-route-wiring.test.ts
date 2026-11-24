import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { db } from "~/db";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { defaultNotifications } from "~/lib/notifications.server";
import { updateLessonDiscussion } from "../discussions.server";
import { updateLessonPersonalData } from "../personal.server";
import { action } from "~/routes/courses.$slug.lessons.$lessonId";
import { requestFor } from "./fixtures";

vi.mock("~/db", async () => {
  const { lessonFixture } = await import("./fixtures");
  return { db: lessonFixture().db };
});
vi.mock("../discussions.server", () => ({ updateLessonDiscussion: vi.fn() }));
vi.mock("../personal.server", () => ({ updateLessonPersonalData: vi.fn() }));
vi.mock("~/lib/notifications.server", async (original) => ({
  ...(await original<typeof import("~/lib/notifications.server")>()),
  defaultNotifications: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
afterAll(() => db.$client.close());

it.each([
  "create-comment",
  "edit-comment",
  "delete-comment",
  "save-note",
  "toggle-bookmark",
])(
  "the direct %s action delegates the complete untrusted command before resolving targets",
  async (intent) => {
    const session = await requestFor(1);
    const request = new Request(session.url, {
      method: "POST",
      headers: session.headers,
      body: new URLSearchParams({
        intent,
        body: "Writing",
        commentId: "not-an-id",
        parentId: "999",
      }),
    });
    const params = { slug: "missing-course", lessonId: "invalid" };
    const notifications = fakeNotifications();
    vi.mocked(defaultNotifications).mockResolvedValue(notifications);
    vi.mocked(updateLessonDiscussion).mockResolvedValue({ ok: true });
    vi.mocked(updateLessonPersonalData).mockResolvedValue({ ok: true });
    const result = await action({
      request,
      params,
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    });
    if (intent.endsWith("comment")) {
      expect(updateLessonDiscussion).toHaveBeenCalledExactlyOnceWith(
        db,
        request,
        params,
        expect.any(FormData),
        notifications
      );
      const command = vi.mocked(updateLessonDiscussion).mock.calls[0]?.[3];
      expect(Object.fromEntries(command ?? [])).toEqual({
        intent,
        body: "Writing",
        commentId: "not-an-id",
        parentId: "999",
      });
    } else {
      expect(updateLessonPersonalData).toHaveBeenCalledExactlyOnceWith(
        db,
        request,
        params,
        expect.any(FormData)
      );
      const command = vi.mocked(updateLessonPersonalData).mock.calls[0]?.[3];
      expect(Object.fromEntries(command ?? [])).toEqual({
        intent,
        body: "Writing",
        commentId: "not-an-id",
        parentId: "999",
      });
    }
    expect(result).toEqual({ ok: true });
  }
);

it("rejects an unknown action as a malformed command before resolving a missing lesson", async () => {
  const session = await requestFor(1);
  const request = new Request(session.url, {
    method: "POST",
    headers: session.headers,
    body: new URLSearchParams({ intent: "unknown" }),
  });
  await expect(
    action({
      request,
      params: { slug: "missing", lessonId: "999999" },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    })
  ).rejects.toMatchObject({ init: { status: 400 } });
});
