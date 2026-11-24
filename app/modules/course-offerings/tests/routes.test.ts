import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import type { TestDb } from "~/test/setup";
import { loader as catalogLoader } from "~/routes/courses";
import {
  action as ratingAction,
  loader as courseLoader,
} from "~/routes/courses.$slug";
import { offeringFixture, requestFor } from "./fixtures";

const database = vi.hoisted(() => ({
  current: undefined as TestDb | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    if (!database.current) throw new Error("No test database");
    return database.current;
  },
}));
let f: ReturnType<typeof offeringFixture>;
beforeEach(() => {
  f = offeringFixture();
  database.current = f.db;
});
afterEach(() => {
  f.db.$client.close();
  database.current = undefined;
});
function args(request: Request, slug = f.course.slug) {
  return {
    request,
    params: { slug },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/courses/:slug",
  };
}

it("uses the current Instructor role for the catalog ownership badge and course management links", async () => {
  const request = await requestFor(f.instructor.id);
  expect((await catalogLoader(args(request))).courses[0]).toMatchObject({
    isOwningInstructor: true,
  });
  f.demote();
  expect((await catalogLoader(args(request))).courses[0]).toMatchObject({
    isOwningInstructor: false,
  });
  expect(await courseLoader(args(request))).toMatchObject({ canManage: false });
});

it("authenticates a direct rating submission before malformed input independently of the offering loader", async () => {
  const request = await requestFor(999999);
  const post = new Request(request, {
    method: "POST",
    body: "broken",
    headers: {
      Cookie: request.headers.get("Cookie") ?? "",
      "Content-Type": "application/json",
    },
  });
  await expect(ratingAction(args(post, ""))).rejects.toMatchObject({
    init: { status: 401 },
  });
});

it("routes valid rating writes through Enrollment-only eligibility and returns them in the public offering", async () => {
  await f.enroll();
  f.purchase("IN");
  const request = await requestFor(f.user.id);
  const post = new Request(request, {
    method: "POST",
    body: new URLSearchParams({ rating: "5" }),
  });
  expect(await ratingAction(args(post))).toEqual({ ok: true, error: null });
  expect(await courseLoader(args(request))).toMatchObject({
    userRating: 5,
    ratingSummary: { average: 5, count: 1 },
  });
});
