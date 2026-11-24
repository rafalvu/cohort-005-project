import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { action as courseAction } from "~/routes/instructor.$courseId";
import {
  action as lessonAction,
  loader as lessonLoader,
} from "~/routes/instructor.$courseId.lessons.$lessonId";
import { loader as sectionLoader } from "~/routes/instructor.$courseId.modules.$moduleId";
import { createTestDb, type TestDb } from "~/test/setup";
import { demote, requestAs, seedEditor } from "./course-editor-fixtures";

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
function args(request: Request, courseId = String(fixture.course.id)) {
  return {
    request,
    params: {
      courseId,
      lessonId: String(fixture.lesson.id),
      moduleId: String(fixture.section.id),
    },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/instructor/:courseId/lessons/:lessonId",
  };
}

it("authenticates a stale direct lesson save before malformed input", async () => {
  const request = new Request(await requestAs(99999), {
    method: "POST",
    body: "broken",
    headers: {
      Cookie: (await requestAs(99999)).headers.get("Cookie") ?? "",
      "Content-Type": "application/json",
    },
  });
  await expect(lessonAction(args(request, "broken"))).rejects.toMatchObject({
    init: { status: 401 },
  });
});

it.each([lessonLoader, sectionLoader])(
  "authenticates stale child reads before malformed identifiers",
  async (loader) => {
    await expect(
      loader(args(await requestAs(99999), "broken"))
    ).rejects.toMatchObject({ init: { status: 401 } });
  }
);

it("throws for a foreign lesson in a main-editor rename independently of its loader", async () => {
  const request = new Request(await requestAs(fixture.admin.id), {
    method: "POST",
    body: new URLSearchParams({
      intent: "rename-lesson",
      lessonId: String(fixture.lesson.id),
      title: "Changed",
    }),
  });
  await expect(
    courseAction(args(request, String(fixture.otherCourse.id)))
  ).rejects.toMatchObject({ init: { status: 404 } });
});

it.each([
  "add-lesson",
  "rename-lesson",
  "delete-lesson",
  "move-lesson",
  "reorder-lessons",
])(
  "guards direct main-editor %s actions after the owner's role is removed",
  async (intent) => {
    demote(db, fixture.instructor.id);
    const request = new Request(await requestAs(fixture.instructor.id), {
      method: "POST",
      body: new URLSearchParams({
        intent,
        title: "Changed",
        moduleId: String(fixture.section.id),
        lessonId: String(fixture.lesson.id),
        lessonIds: JSON.stringify([fixture.lesson.id]),
        targetModuleId: String(fixture.secondSection.id),
        targetPosition: "1",
      }),
    });
    const before = db.$client.serialize();
    await expect(courseAction(args(request))).rejects.toMatchObject({
      init: { status: 403 },
    });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it("guards the lesson save independently of both parent and child loaders", async () => {
  const request = new Request(await requestAs(fixture.user.id), {
    method: "POST",
    body: new URLSearchParams({ intent: "update-lesson", content: "Changed" }),
  });
  const before = db.$client.serialize();
  await expect(lessonAction(args(request))).rejects.toMatchObject({
    init: { status: 403 },
  });
  expect(db.$client.serialize()).toEqual(before);
});

it.each([lessonLoader, sectionLoader])(
  "resolves foreign child resources before permission",
  async (loader) => {
    await expect(
      loader(
        args(await requestAs(fixture.user.id), String(fixture.otherCourse.id))
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  }
);

it.each([lessonLoader, sectionLoader])(
  "rejects malformed child loader identifiers without truncating",
  async (loader) => {
    await expect(
      loader(
        args(await requestAs(fixture.admin.id), `${fixture.course.id}suffix`)
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
);

it("saves all child-editor fields and returns the complete guarded view", async () => {
  const request = await requestAs(fixture.instructor.id);
  const post = new Request(request, {
    method: "POST",
    body: new URLSearchParams({
      intent: "update-lesson",
      content: "# Body",
      videoUrl: "https://example.com/video",
      githubRepoUrl: "https://github.com/example/course",
      durationMinutes: "20",
    }),
  });
  expect(await lessonAction(args(post))).toEqual({ success: true });
  expect(await lessonLoader(args(request))).toMatchObject({
    course: { id: fixture.course.id },
    lesson: {
      content: "# Body",
      videoUrl: "https://example.com/video",
      githubRepoUrl: "https://github.com/example/course",
      durationMinutes: 20,
    },
    module: { id: fixture.section.id },
  });
  expect(
    await sectionLoader(args(await requestAs(fixture.admin.id)))
  ).toMatchObject({
    module: { lessons: [{ title: "First lesson", durationMinutes: 20 }] },
    totalLessons: 1,
    totalDuration: 20,
  });
});

it.each(["broken", "[1,99999]"])(
  "throws standardized main-editor reorder rejection for %s",
  async (lessonIds) => {
    const request = new Request(await requestAs(fixture.admin.id), {
      method: "POST",
      body: new URLSearchParams({
        intent: "reorder-lessons",
        moduleId: String(fixture.section.id),
        lessonIds,
      }),
    });
    const before = db.$client.serialize();
    await expect(courseAction(args(request))).rejects.toMatchObject({
      init: { status: lessonIds === "broken" ? 400 : 404 },
    });
    expect(db.$client.serialize()).toEqual(before);
  }
);

it.each([courseAction, lessonAction])(
  "rejects malformed and duplicate form fields before target resolution",
  async (action) => {
    const request = await requestAs(fixture.user.id);
    const duplicate = new Request(request, {
      method: "POST",
      body: new URLSearchParams([
        ["intent", "update-lesson"],
        ["content", "One"],
        ["content", "Two"],
      ]),
    });
    await expect(action(args(duplicate, "99999"))).rejects.toMatchObject({
      init: { status: 400 },
    });
    const malformed = new Request(request, {
      method: "POST",
      body: "broken",
      headers: {
        Cookie: request.headers.get("Cookie") ?? "",
        "Content-Type": "application/json",
      },
    });
    await expect(action(args(malformed, "99999"))).rejects.toMatchObject({
      init: { status: 400 },
    });
  }
);

it("resolves the saved lesson's actual course before allowing a Platform Admin mutation", async () => {
  const request = new Request(await requestAs(fixture.admin.id), {
    method: "POST",
    body: new URLSearchParams({ intent: "update-lesson", content: "Changed" }),
  });
  const before = db.$client.serialize();
  await expect(
    lessonAction(args(request, String(fixture.otherCourse.id)))
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(db.$client.serialize()).toEqual(before);
});
