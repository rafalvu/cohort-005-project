import { expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { getLessonPage } from "../index.server";
import { loader } from "~/routes/courses.$slug.lessons.$lessonId";
import { db } from "~/db";

vi.mock("~/db", () => ({ db: {} }));
vi.mock("../index.server", () => ({ getLessonPage: vi.fn() }));

it("delegates the complete lesson read with the original Request and untrusted target", async () => {
  const request = new Request("http://localhost/courses/example/lessons/23");
  const params = { slug: "example", lessonId: "23" };
  const result = await loader({
    request,
    params,
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/courses/:slug/lessons/:lessonId",
  });
  expect(getLessonPage).toHaveBeenCalledExactlyOnceWith(db, request, params);
  expect(result).toBeUndefined();
});
