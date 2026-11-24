import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import type { TestDb } from "~/test/setup";
import { lessons, modules } from "~/db/schema";
import { isBookmarked } from "~/lib/bookmarks.server";
import { action } from "~/routes/courses.$slug.lessons.$lessonId";
import { permissionFixture, requestFor } from "./fixtures";

const database = vi.hoisted(() => ({
  current: undefined as TestDb | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    if (!database.current)
      throw new Error("Test database has not been created");
    return database.current;
  },
}));

let f: ReturnType<typeof permissionFixture>;
beforeEach(() => {
  f = permissionFixture();
  database.current = f.db;
});
afterEach(() => {
  f.db.$client.close();
  database.current = undefined;
});

it("uses every Purchase when the existing lesson action changes a Bookmark", async () => {
  await f.enroll();
  f.purchase("IN");
  f.purchase("US");
  const section = f.db
    .insert(modules)
    .values({ courseId: f.course.id, title: "Section", position: 0 })
    .returning()
    .get();
  const lesson = f.db
    .insert(lessons)
    .values({ moduleId: section.id, title: "Lesson", position: 0 })
    .returning()
    .get();
  const authenticated = await requestFor(f.user.id);
  const request = new Request(authenticated, {
    method: "POST",
    body: new URLSearchParams({ intent: "toggle-bookmark" }),
  });

  expect(
    await action({
      request,
      params: { slug: f.course.slug, lessonId: String(lesson.id) },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug/lessons/:lessonId",
    })
  ).toMatchObject({ ok: true, bookmarked: true });
  expect(isBookmarked(f.db, f.user.id, lesson.id)).toBe(true);
});
