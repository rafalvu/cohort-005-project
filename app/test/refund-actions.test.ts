import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestDb, seedBaseData } from "./setup";
import {
  modules,
  lessons,
  lessonProgress,
  LessonProgressStatus,
  users,
  purchases,
  enrollments,
  coupons,
  teams,
  teamMembers,
  TeamMemberRole,
  UserRole,
  RefundStatus,
} from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { listStoredNotifications } from "~/lib/notifications.server";
import type { Email, MailTransport } from "~/lib/mailer.server";
const holder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestDb> | undefined,
  emails: [] as Email[],
}));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("~/lib/mailer.server", async (original) => {
  const actual = await original<typeof import("~/lib/mailer.server")>();
  const transport: MailTransport = {
    async send(email) {
      expect(database().$client.inTransaction).toBe(false);
      holder.emails.push(email);
    },
  };
  return {
    ...actual,
    sendEmail: (email: Email) => actual.sendEmail(email, transport),
  };
});
import { loader as teamLoader } from "~/routes/team";
import { action as requestAction } from "~/routes/courses.$slug.refund";
import {
  action as decisionAction,
  loader as reviewLoader,
} from "~/routes/admin.refunds";
function database() {
  if (!holder.db) throw new Error("Missing database");
  return holder.db;
}
let fixture: ReturnType<typeof seedBaseData>;
let purchaseId: number;
let admins: number[];
beforeEach(() => {
  holder.db = createTestDb();
  fixture = seedBaseData(database());
  holder.emails = [];
  purchaseId = database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 1000,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get().id;
  database()
    .insert(enrollments)
    .values({ userId: fixture.user.id, courseId: fixture.course.id })
    .run();
  admins = [1, 2].map(
    (n) =>
      database()
        .insert(users)
        .values({
          name: `Admin ${n}`,
          email: `admin${n}@example.com`,
          role: UserRole.Admin,
        })
        .returning()
        .get().id
  );
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "true");
});
afterEach(() => {
  database().$client.close();
  vi.unstubAllEnvs();
});
async function post(
  actor: number,
  fields: Record<string, string>,
  decision = false
) {
  const url = "http://localhost/admin/refunds";
  const cookie = await setCurrentUserId(new Request(url), actor);
  const request = new Request(url, {
    method: "POST",
    headers: { Cookie: cookie },
    body: new URLSearchParams(fields),
  });
  return decision
    ? decisionAction({ request } as Parameters<typeof decisionAction>[0])
    : requestAction({
        request,
        params: { slug: fixture.course.slug },
      } as Parameters<typeof requestAction>[0]);
}
function requestFields(previous = 0) {
  return {
    purchaseId: String(purchaseId),
    reason: "I need a refund please",
    previousRefundRequestId: String(previous),
  };
}
function history(id: number) {
  return listStoredNotifications(database(), { recipientId: id }).rows;
}
async function review(status = RefundStatus.Open) {
  const url = new URL(`http://localhost/admin/refunds?status=${status}`);
  const cookie = await setCurrentUserId(new Request(url), admins[0]);
  return (
    await reviewLoader({
      request: new Request(url, { headers: { Cookie: cookie } }),
      url,
    } as Parameters<typeof reviewLoader>[0])
  ).refundRequests;
}
test("a Refund Request notifies every Platform Admin and separately emails the buyer", async () => {
  await post(fixture.user.id, requestFields());
  for (const id of admins)
    expect(history(id)).toMatchObject([
      { kind: "refund_requested", purchaseId },
    ]);
  expect(history(fixture.user.id)).toEqual([]);
  expect(holder.emails.map((e) => e.to)).toEqual([fixture.user.email]);
  expect(await review()).toHaveLength(1);
});
test.each(["approve", "decline"])(
  "%s notifies only the buyer and concurrent decisions have one winner",
  async (intent) => {
    await post(fixture.user.id, requestFields());
    const [request] = await review();
    const fields = {
      intent,
      refundRequestId: String(request.id),
      note: "Reviewed request",
    };
    const results = await Promise.allSettled(
      admins.map((id) => post(id, fields, true))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(history(fixture.user.id)).toMatchObject([
      {
        kind: intent === "approve" ? "refund_approved" : "refund_declined",
        purchaseId,
        refundRequestId: request.id,
      },
    ]);
    for (const id of admins) expect(history(id)).toHaveLength(1);
    expect(holder.emails).toHaveLength(2);
  }
);
test("replaying a request after decline cannot create another outcome; a fresh offer can", async () => {
  await post(fixture.user.id, requestFields());
  const [request] = await review();
  await post(
    admins[0],
    {
      intent: "decline",
      refundRequestId: String(request.id),
      note: "Reviewed",
    },
    true
  );
  await expect(post(fixture.user.id, requestFields())).rejects.toMatchObject({
    init: { status: 409 },
  });
  await post(fixture.user.id, requestFields(request.id));
  expect(await review()).toHaveLength(1);
  expect(history(admins[0])).toHaveLength(2);
  expect(holder.emails).toHaveLength(3);
});
test.each(["request", "approve", "decline"])(
  "%s persistence failure rolls back source, recipients and entitlements",
  async (intent) => {
    let requestId = 0;
    if (intent !== "request") {
      await post(fixture.user.id, requestFields());
      requestId = (await review())[0].id;
    }
    const before = await review();
    const blocked = intent === "request" ? admins[1] : fixture.user.id;
    database().run(
      sql.raw(
        `CREATE TRIGGER reject_notification BEFORE INSERT ON notifications WHEN NEW.recipient_id = ${blocked} BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END`
      )
    );
    await expect(
      intent === "request"
        ? post(fixture.user.id, requestFields())
        : post(
            admins[0],
            { intent, refundRequestId: String(requestId), note: "Reviewed" },
            true
          )
    ).rejects.toThrow();
    expect(await review()).toEqual(before);
    expect(history(fixture.user.id)).toEqual([]);
    for (const id of admins)
      expect(history(id)).toHaveLength(intent === "request" ? 0 : 1);
    expect(holder.emails).toHaveLength(intent === "request" ? 0 : 1);
    expect(database().select().from(enrollments).all()).toHaveLength(1);
    database().run(sql.raw("DROP TRIGGER reject_notification"));
    if (intent === "request") await post(fixture.user.id, requestFields());
    else
      await post(
        admins[0],
        { intent, refundRequestId: String(requestId), note: "Reviewed" },
        true
      );
  }
);
test("overlapping Platform Admin buyer is excluded from their request and own decision but receives both emails", async () => {
  database()
    .update(users)
    .set({ role: UserRole.Admin })
    .where(eq(users.id, fixture.user.id))
    .run();
  await post(fixture.user.id, requestFields());
  const [request] = await review();
  await post(
    fixture.user.id,
    {
      intent: "approve",
      refundRequestId: String(request.id),
      note: "Reviewed",
    },
    true
  );
  expect(history(fixture.user.id)).toEqual([]);
  for (const id of admins) expect(history(id)).toHaveLength(1);
  expect(holder.emails.map((e) => e.to)).toEqual([
    fixture.user.email,
    fixture.user.email,
  ]);
});
test("concurrent request submissions save and email once", async () => {
  const results = await Promise.allSettled([
    post(fixture.user.id, requestFields()),
    post(fixture.user.id, requestFields()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await review()).toHaveLength(1);
  for (const id of admins) expect(history(id)).toHaveLength(1);
  expect(holder.emails).toHaveLength(1);
});
test("unauthorized actors, malformed requests and missing replay guards make no updates", async () => {
  await expect(post(admins[0], requestFields())).rejects.toMatchObject({
    init: { status: 404 },
  });
  await expect(
    post(fixture.user.id, { intent: "approve", refundRequestId: "1" }, true)
  ).rejects.toMatchObject({ init: { status: 403 } });
  const { previousRefundRequestId: _previous, ...missing } = requestFields();
  await expect(post(fixture.user.id, missing)).rejects.toMatchObject({
    init: { status: 400 },
  });
  await expect(
    post(fixture.user.id, { ...requestFields(), reason: "short" })
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(await review()).toEqual([]);
  for (const id of admins) expect(history(id)).toEqual([]);
  expect(holder.emails).toEqual([]);
});
test("inactive feature preserves refund workflow without Notifications", async () => {
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "false");
  await post(fixture.user.id, requestFields());
  const [request] = await review();
  await post(
    admins[0],
    { intent: "approve", refundRequestId: String(request.id) },
    true
  );
  for (const id of [...admins, fixture.user.id])
    expect(history(id)).toEqual([]);
  expect(await review(RefundStatus.Approved)).toHaveLength(1);
  expect(holder.emails).toHaveLength(2);
});
async function teamView() {
  const url = "http://localhost/team";
  const cookie = await setCurrentUserId(new Request(url), fixture.user.id);
  return teamLoader({
    request: new Request(url, { headers: { Cookie: cookie } }),
  } as Parameters<typeof teamLoader>[0]);
}
function makeTeamLicence() {
  const team = database().insert(teams).values({}).returning().get();
  for (const userId of [fixture.user.id, fixture.instructor.id, admins[0]])
    database()
      .insert(teamMembers)
      .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
      .run();
  for (const code of ["FIRST", "SECOND"])
    database()
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: fixture.course.id,
        purchaseId,
        code,
      })
      .run();
}
test.each(["approve", "decline"])(
  "Team Licence %s notifies its buyer privately and preserves all-or-nothing Seat rules",
  async (intent) => {
    makeTeamLicence();
    const response = await post(fixture.user.id, requestFields());
    if (!(response instanceof Response)) throw new Error("Expected redirect");
    expect(response.headers.get("Location")).toBe("/team");
    expect((await teamView()).couponRows.map((c) => c.availability)).toEqual([
      "on_hold",
      "on_hold",
    ]);
    const [request] = await review();
    await post(
      admins[0],
      { intent, refundRequestId: String(request.id), note: "Reviewed" },
      true
    );
    expect((await teamView()).couponRows.map((c) => c.availability)).toEqual(
      intent === "approve"
        ? ["refunded", "refunded"]
        : ["available", "available"]
    );
    expect(history(fixture.user.id)).toMatchObject([
      { kind: intent === "approve" ? "refund_approved" : "refund_declined" },
    ]);
    expect(history(fixture.instructor.id)).toEqual([]);
    expect(history(admins[0])).toHaveLength(1);
  }
);
test("a claimed Team Licence Seat prevents a request and produces no updates", async () => {
  makeTeamLicence();
  database()
    .update(coupons)
    .set({
      redeemedByUserId: fixture.instructor.id,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.code, "FIRST"))
    .run();
  await expect(post(fixture.user.id, requestFields())).rejects.toMatchObject({
    init: { status: 403 },
  });
  expect(await review()).toEqual([]);
  for (const id of admins) expect(history(id)).toEqual([]);
  expect(holder.emails).toEqual([]);
});
test("approval removes Individual Purchase Enrollment while preserving learner progress", async () => {
  const module = database()
    .insert(modules)
    .values({ courseId: fixture.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  const lesson = database()
    .insert(lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 1 })
    .returning()
    .get();
  const progress = database()
    .insert(lessonProgress)
    .values({
      lessonId: lesson.id,
      userId: fixture.user.id,
      status: LessonProgressStatus.InProgress,
    })
    .returning()
    .get();
  await post(fixture.user.id, requestFields());
  expect(database().select().from(enrollments).all()).toHaveLength(1);
  const [request] = await review();
  await post(
    admins[0],
    { intent: "approve", refundRequestId: String(request.id) },
    true
  );
  expect(database().select().from(enrollments).all()).toEqual([]);
  expect(database().select().from(lessonProgress).all()).toEqual([progress]);
  expect(history(fixture.user.id)).toHaveLength(1);
});
test("failed Team Licence approval preserves every frozen Seat and can retry", async () => {
  makeTeamLicence();
  await post(fixture.user.id, requestFields());
  const [request] = await review();
  database().run(
    sql.raw(
      "CREATE TRIGGER reject_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END"
    )
  );
  const fields = { intent: "approve", refundRequestId: String(request.id) };
  await expect(post(admins[0], fields, true)).rejects.toThrow();
  expect((await teamView()).couponRows.map((c) => c.availability)).toEqual([
    "on_hold",
    "on_hold",
  ]);
  expect(await review()).toHaveLength(1);
  database().run(sql.raw("DROP TRIGGER reject_notification"));
  await post(admins[0], fields, true);
  expect((await teamView()).couponRows.map((c) => c.availability)).toEqual([
    "refunded",
    "refunded",
  ]);
});
