import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { createTestDb, type TestDb } from "~/test/setup";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { loader as workspaceLoader } from "~/routes/instructor";
import {
  loader as creationLoader,
  action as creationAction,
} from "~/routes/instructor.new";
import { loader as rosterLoader } from "~/routes/instructor.$courseId.students";
import { loader as analyticsLoader } from "~/routes/instructor.analytics";
import {
  loader as questionsLoader,
  action as questionsAction,
} from "~/routes/instructor.questions";
import { demote, seedEditor } from "./course-editor-fixtures";
import {
  reportingRequest,
  newCourseCommand,
  seedQuestions,
} from "./reporting-fixtures";

const dependencies = vi.hoisted(() => ({
  db: undefined as TestDb | undefined,
  notifications: undefined as ReturnType<typeof fakeNotifications> | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    if (!dependencies.db) throw new Error("Missing database");
    return dependencies.db;
  },
}));
vi.mock("~/lib/notifications.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/notifications.server")>()),
  defaultNotifications: async () => dependencies.notifications,
}));

let db: TestDb;
let fixture: Awaited<ReturnType<typeof seedEditor>>;
let notifications: ReturnType<typeof fakeNotifications>;
beforeEach(async () => {
  db = createTestDb();
  fixture = await seedEditor(db);
  notifications = fakeNotifications();
  dependencies.db = db;
  dependencies.notifications = notifications;
});
afterEach(() => {
  db.$client.close();
  dependencies.db = undefined;
  dependencies.notifications = undefined;
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

it("wires all complete workspace reads to current identity", async () => {
  const stale = args(await reportingRequest(99999));
  for (const loader of [
    workspaceLoader,
    creationLoader,
    rosterLoader,
    analyticsLoader,
    questionsLoader,
  ]) {
    await expect(loader(stale)).rejects.toMatchObject({
      init: { status: 401 },
    });
  }
});

it("loads the authorized Instructor workspace, creation categories, roster, analytics and question queue", async () => {
  const { question } = await seedQuestions(db, fixture, notifications);
  const input = args(await reportingRequest(fixture.instructor.id));
  expect(await workspaceLoader(input)).toMatchObject({
    courses: [{ id: fixture.course.id }],
  });
  expect(await creationLoader(input)).toMatchObject({
    categories: [{ id: fixture.category.id }],
  });
  expect(await rosterLoader(input)).toMatchObject({
    course: { id: fixture.course.id },
  });
  expect(await analyticsLoader(input)).toMatchObject({
    isAdmin: false,
    instructorId: fixture.instructor.id,
  });
  expect(await questionsLoader(input)).toMatchObject({
    isAdmin: false,
    questions: [{ id: question.id }],
  });
});

it("guards course creation independently of a loader, preserving its success redirect", async () => {
  await expect(
    creationAction(
      args(
        await reportingRequest(
          fixture.admin.id,
          newCourseCommand(fixture.category.id)
        )
      )
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  await expect(
    creationAction(
      args(
        await reportingRequest(
          fixture.instructor.id,
          newCourseCommand(fixture.category.id)
        )
      )
    )
  ).rejects.toMatchObject({ status: 302, headers: expect.any(Headers) });
  expect(
    await workspaceLoader(args(await reportingRequest(fixture.instructor.id)))
  ).toMatchObject({
    courses: [{ id: fixture.course.id }, { slug: "new-instructor-course" }],
  });
});

it("authenticates direct creation and reply actions before parsing malformed bodies", async () => {
  for (const action of [creationAction, questionsAction]) {
    const request = new Request(await reportingRequest(99999), {
      method: "POST",
      body: "invalid",
      headers: {
        Cookie: (await reportingRequest(99999)).headers.get("Cookie") ?? "",
        "Content-Type": "application/json",
      },
    });
    await expect(action(args(request))).rejects.toMatchObject({
      init: { status: 401 },
    });
  }
});

it("validates roster identifiers before permission without truncation", async () => {
  await expect(
    rosterLoader(args(await reportingRequest(fixture.user.id), "1junk"))
  ).rejects.toMatchObject({ init: { status: 400 } });
  await expect(
    rosterLoader(args(await reportingRequest(fixture.admin.id), "99999"))
  ).rejects.toMatchObject({ init: { status: 404 } });
});

it("rejects a demoted owner's direct reply and allows an authorized Platform Admin reply", async () => {
  const { question } = await seedQuestions(db, fixture, notifications);
  demote(db, fixture.instructor.id);
  const command = {
    intent: "reply",
    commentId: String(question.id),
    body: "Answer",
  };
  notifications.sent.length = 0;
  const before = db.$client.serialize();
  await expect(
    questionsAction(
      args(await reportingRequest(fixture.instructor.id, command))
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(db.$client.serialize()).toEqual(before);
  expect(notifications.sent).toEqual([]);
  expect(
    await questionsAction(
      args(await reportingRequest(fixture.admin.id, command))
    )
  ).toEqual({ ok: true });
  expect(notifications.sent).toHaveLength(1);
});
