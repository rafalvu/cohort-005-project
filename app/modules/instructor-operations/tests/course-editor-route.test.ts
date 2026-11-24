import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { action, loader } from "~/routes/instructor.$courseId";
import { createTestDb, type TestDb } from "~/test/setup";
import { requestAs, seedEditor } from "./course-editor-fixtures";

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
    params: { courseId },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/instructor/:courseId",
  };
}

it("authenticates a stale direct action before parsing its malformed body", async () => {
  const request = new Request(await requestAs(99999), {
    method: "POST",
    body: "not form data",
    headers: {
      Cookie: (await requestAs(99999)).headers.get("Cookie") ?? "",
      "Content-Type": "application/json",
    },
  });
  await expect(action(args(request, "invalid"))).rejects.toMatchObject({
    init: { status: 401 },
  });
});

it("does not truncate malformed loader identifiers", async () => {
  await expect(
    loader(
      args(await requestAs(fixture.instructor.id), `${fixture.course.id}junk`)
    )
  ).rejects.toMatchObject({ init: { status: 400 } });
});

it.each([
  { intent: "update-title", title: "New title" },
  { intent: "update-description", description: "New description" },
  { intent: "update-status", status: "draft" },
  { intent: "update-price", price: "10.50" },
  { intent: "update-ppp-enabled", pppEnabled: "true" },
  { intent: "update-sales-copy", salesCopy: "New sales copy" },
  { intent: "add-module", title: "New section" },
  { intent: "rename-module", moduleId: "1", title: "New section name" },
  { intent: "delete-module", moduleId: "2" },
  { intent: "reorder-modules", moduleIds: "[2,1]" },
])("guards direct action %j independently of the loader", async (command) => {
  const request = new Request(await requestAs(fixture.user.id), {
    method: "POST",
    body: new URLSearchParams(
      Object.entries(command).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
  });
  const before = db.$client.serialize();
  await expect(action(args(request))).rejects.toMatchObject({
    init: { status: 403 },
  });
  expect(db.$client.serialize()).toEqual(before);
});

it("loads the complete authorized editor and applies a settings mutation", async () => {
  const request = await requestAs(fixture.instructor.id);
  const post = new Request(request, {
    method: "POST",
    body: new URLSearchParams({ intent: "update-title", title: "New title" }),
  });
  expect(await action(args(post))).toEqual({ success: true, field: "title" });
  expect(await loader(args(request))).toMatchObject({
    course: {
      title: "New title",
      modules: [{ lessons: [{ title: "First lesson" }] }, { lessons: [] }],
    },
    lessonCount: 1,
    students: [],
    quizCount: 0,
  });
});

it.each(["broken", "[2,99999]"])(
  "throws a consistent error for an invalid direct reorder %s",
  async (moduleIds) => {
    const post = new Request(await requestAs(fixture.admin.id), {
      method: "POST",
      body: new URLSearchParams({ intent: "reorder-modules", moduleIds }),
    });
    await expect(action(args(post))).rejects.toMatchObject({
      init: { status: moduleIds === "broken" ? 400 : 404 },
    });
  }
);

it("rejects an unknown direct command before permission", async () => {
  const post = new Request(await requestAs(fixture.user.id), {
    method: "POST",
    body: new URLSearchParams({ intent: "unknown" }),
  });
  await expect(action(args(post))).rejects.toMatchObject({
    init: { status: 400 },
  });
});

it("keeps unmigrated lesson actions operational", async () => {
  const post = new Request(await requestAs(fixture.instructor.id), {
    method: "POST",
    body: new URLSearchParams({
      intent: "add-lesson",
      moduleId: String(fixture.section.id),
      title: "New lesson",
    }),
  });
  expect(await action(args(post))).toEqual({ success: true, field: "lesson" });
  expect(
    await loader(args(await requestAs(fixture.instructor.id)))
  ).toMatchObject({ lessonCount: 2 });
});
