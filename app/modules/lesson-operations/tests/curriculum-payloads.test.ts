import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import type { TestDb } from "~/test/setup";
import { loader as courseLoader } from "~/routes/courses.$slug";
import { loader as moduleLoader } from "~/routes/courses.$slug.$moduleId";
import { loader as welcomeLoader } from "~/routes/courses.$slug.welcome";
import { loader as purchaseLoader } from "~/routes/courses.$slug.purchase";
import { lessonFixture, requestFor } from "./fixtures";

const database = vi.hoisted(() => ({
  current: undefined as TestDb | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    if (!database.current) throw new Error("Database not created");
    return database.current;
  },
}));
let f: ReturnType<typeof lessonFixture>;
beforeEach(() => {
  f = lessonFixture();
  database.current = f.db;
});
afterEach(() => {
  f.db.$client.close();
  database.current = undefined;
});

it.each(["course", "module", "welcome", "purchase"])(
  "withholds protected lesson data from the %s curriculum response",
  async (page) => {
    if (page === "welcome") {
      await f.enroll();
      f.purchase("IN");
    }
    const request = await requestFor(
      page === "welcome" || page === "purchase" ? f.user.id : null
    );
    const args = {
      request,
      params: { slug: f.course.slug, moduleId: String(f.section.id) },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "/courses/:slug",
    };
    const result =
      page === "course"
        ? await courseLoader(args)
        : page === "module"
          ? await moduleLoader(args)
          : page === "welcome"
            ? await welcomeLoader(args)
            : await purchaseLoader(args);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "Protected body",
      "video.example/secret",
      "code.example/secret",
      '"content":',
      '"videoUrl":',
      '"githubRepoUrl":',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("Lesson 1");
    expect(serialized).toContain("Lesson 2");
  }
);
