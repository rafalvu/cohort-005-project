import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedDiscussionData } from "./setup";
import {
  comments,
  enrollments,
  notifications,
  courses,
  purchases,
  users,
  UserRole,
  refunds,
  RefundStatus,
  teams,
  teamMembers,
  TeamMemberRole,
  coupons,
} from "~/db/schema";
import { createNotifications } from "~/lib/notifications.server";
import { setCurrentUserId } from "~/lib/session";
const holder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestDb> | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("~/lib/mailer.server", async (original) => {
  const actual = await original<typeof import("~/lib/mailer.server")>();
  return {
    ...actual,
    sendEmail: (email: import("~/lib/mailer.server").Email) =>
      actual.sendEmail(email, { async send() {} }),
  };
});
import { loader as teamLoader } from "~/routes/team";
import { loader as purchaseLoader } from "~/routes/api.purchases.$purchaseId";
import { loader as lessonLoader } from "~/routes/courses.$slug.lessons.$lessonId";
import {
  action as decide,
  loader as reviewLoader,
} from "~/routes/admin.refunds";
import { loader, action } from "~/routes/api.notifications";
function database() {
  if (!holder.db) throw new Error("Missing database");
  return holder.db;
}
let fixture: ReturnType<typeof seedDiscussionData>;
beforeEach(() => {
  holder.db = createTestDb();
  fixture = seedDiscussionData(database());
  database()
    .insert(enrollments)
    .values({ userId: fixture.user.id, courseId: fixture.course.id })
    .run();
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "true");
});
afterEach(() => {
  database().$client.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function request(
  path = "",
  actor: number | null = fixture.user.id,
  fields?: Record<string, string>,
  country = "PL",
  origin = "http://localhost"
) {
  const url = `http://localhost/api/notifications${path}`;
  const cookie =
    actor === null ? "" : await setCurrentUserId(new Request(url), actor);
  return new Request(url, {
    method: fields ? "POST" : "GET",
    headers: { Cookie: cookie, "CF-IPCountry": country, Origin: origin },
    ...(fields ? { body: new URLSearchParams(fields) } : {}),
  });
}
async function view(
  path = "",
  actor: number | null = fixture.user.id,
  country = "PL"
) {
  return loader({
    request: await request(path, actor, undefined, country),
  } as Parameters<typeof loader>[0]);
}
async function read(
  fields: Record<string, string>,
  actor = fixture.user.id,
  origin = "http://localhost"
) {
  return action({
    request: await request("", actor, fields, "PL", origin),
  } as Parameters<typeof action>[0]);
}
function notify(
  key = "question",
  recipientId = fixture.user.id,
  now = new Date()
) {
  return createNotifications(
    database(),
    {
      sourceEventKey: key,
      kind: "question_created",
      lessonId: fixture.lesson.id,
      questionId: fixture.question.id,
    },
    [recipientId],
    now
  )[0];
}
test("authenticated list shows only the recipient's eligible history without acknowledging it", async () => {
  const own = notify();
  notify("other", fixture.instructor.id);
  expect(await view()).toMatchObject({
    items: [
      {
        id: own.id,
        readAt: null,
        target: { type: "discussion", questionId: fixture.question.id },
      },
    ],
    unreadCount: 1,
    nextCursor: null,
  });
  expect(await view()).toMatchObject({ unreadCount: 1 });
  await expect(view("", null)).rejects.toMatchObject({ init: { status: 401 } });
});
test("pagination, unread count, detail and reads agree on eligibility and exact expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
  const expired = notify(
    "expired",
    fixture.user.id,
    new Date("2026-08-20T12:00:00.000Z")
  );
  const first = notify("first");
  const second = notify("second");
  const page = await view("?limit=1");
  expect(page).toMatchObject({ items: [{ id: second.id }], unreadCount: 2 });
  expect(page.nextCursor).toBeTruthy();
  expect(
    await view(`?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? "")}`)
  ).toMatchObject({
    items: [{ id: first.id }],
    unreadCount: 2,
    nextCursor: null,
  });
  expect(await view(`?id=${first.id}`)).toMatchObject({
    item: { id: first.id, readAt: null },
  });
  for (const id of [expired.id, 9999])
    await expect(view(`?id=${id}`)).rejects.toMatchObject({
      data: "Unavailable",
      init: { status: 404 },
    });
  await expect(
    view(`?id=${first.id}`, fixture.instructor.id)
  ).rejects.toMatchObject({ data: "Unavailable", init: { status: 404 } });
  await expect(view("?cursor=garbage")).rejects.toMatchObject({
    init: { status: 400 },
  });
});
test("explicit reads are idempotent, private, protected against cross-site requests and independent of tasks", async () => {
  const own = notify();
  const other = notify("other", fixture.instructor.id);
  await expect(
    read({ intent: "read", id: String(other.id) })
  ).rejects.toMatchObject({ data: "Unavailable", init: { status: 404 } });
  await expect(
    read(
      { intent: "read", id: String(own.id) },
      fixture.user.id,
      "https://evil.example"
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(await view()).toMatchObject({ unreadCount: 1 });
  await read({ intent: "read", id: String(own.id) });
  const first = await view(`?id=${own.id}`);
  expect(first.item?.readAt).toEqual(expect.any(String));
  await read({ intent: "read", id: String(own.id) });
  expect((await view(`?id=${own.id}`)).item?.readAt).toBe(first.item?.readAt);
  expect(await view("?filter=unread")).toMatchObject({
    items: [],
    unreadCount: 0,
  });
  expect(await view("", fixture.instructor.id)).toMatchObject({
    unreadCount: 1,
  });
  expect(database().select().from(comments).get()?.body).toBe("A question");
});
test("Mark all captures its server watermark before asynchronous request work; later arrivals stay unread", async () => {
  const older = notify();
  const incoming = await request("", fixture.user.id, {
    intent: "read-all",
    watermark: "999999",
  });
  const pending = action({ request: incoming } as Parameters<typeof action>[0]);
  const later = notify("later");
  await pending;
  expect(await view("?filter=unread")).toMatchObject({
    items: [{ id: later.id }],
    unreadCount: 1,
  });
  expect((await view(`?id=${older.id}`)).item?.readAt).toEqual(
    expect.any(String)
  );
});
test("recipient country restrictions apply to every interface, staff capacity survives and surviving replies retain a deleted question placeholder", async () => {
  database()
    .update(courses)
    .set({ price: 10000 })
    .where(eq(courses.id, fixture.course.id))
    .run();
  database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 5000,
      country: "IN",
    })
    .run();
  const question = notify();
  expect(await view()).toMatchObject({ items: [], unreadCount: 0 });
  await expect(view(`?id=${question.id}`)).rejects.toMatchObject({
    init: { status: 404 },
  });
  await expect(
    read({ intent: "read", id: String(question.id) })
  ).rejects.toMatchObject({ init: { status: 404 } });
  await read({ intent: "read-all" });
  expect(await view("", fixture.user.id, "IN")).toMatchObject({
    items: [{ id: question.id, readAt: null }],
    unreadCount: 1,
  });
  database()
    .update(users)
    .set({ role: UserRole.Admin })
    .where(eq(users.id, fixture.user.id))
    .run();
  expect(await view()).toMatchObject({ unreadCount: 1 });
  const reply = database()
    .insert(comments)
    .values({
      userId: fixture.instructor.id,
      lessonId: fixture.lesson.id,
      parentId: fixture.question.id,
      body: "A surviving reply",
    })
    .returning()
    .get();
  const update = createNotifications(
    database(),
    {
      sourceEventKey: "reply",
      kind: "reply_created",
      lessonId: fixture.lesson.id,
      questionId: fixture.question.id,
      replyId: reply.id,
    },
    [fixture.user.id]
  )[0];
  database()
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, fixture.question.id))
    .run();
  expect(await view()).toMatchObject({
    items: [
      {
        id: update.id,
        target: {
          type: "discussion",
          body: null,
          reply: { body: "A surviving reply" },
        },
      },
    ],
    unreadCount: 1,
  });
  database()
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, reply.id))
    .run();
  expect(await view()).toMatchObject({ items: [], unreadCount: 0 });
});
test("another Platform Admin's decision updates current task status without reading it and the buyer retains Purchase access after Enrollment loss", async () => {
  const admin = database()
    .insert(users)
    .values({ name: "Admin", email: "admin@example.com", role: UserRole.Admin })
    .returning()
    .get();
  const reviewer = database()
    .insert(users)
    .values({
      name: "Reviewer",
      email: "reviewer@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
  const purchase = database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 1000,
    })
    .returning()
    .get();
  const refund = database()
    .insert(refunds)
    .values({ purchaseId: purchase.id, reason: "Please refund this Purchase" })
    .returning()
    .get();
  const task = createNotifications(
    database(),
    {
      sourceEventKey: "request",
      kind: "refund_requested",
      refundRequestId: refund.id,
      purchaseId: purchase.id,
    },
    [admin.id]
  )[0];
  expect(await view(`?id=${task.id}`, admin.id)).toMatchObject({
    item: {
      readAt: null,
      target: {
        type: "refund-request",
        status: "open",
        canDecide: true,
        href: `/admin/refunds?refundRequestId=${refund.id}`,
      },
    },
  });
  const decisionRequest = await request("", reviewer.id, {
    intent: "approve",
    refundRequestId: String(refund.id),
  });
  await decide({ request: decisionRequest } as Parameters<typeof decide>[0]);
  await expect(
    decide({
      request: await request("", admin.id, {
        intent: "approve",
        refundRequestId: String(refund.id),
      }),
    } as Parameters<typeof decide>[0])
  ).rejects.toMatchObject({ init: { status: 409 } });
  expect(await view(`?id=${task.id}`, admin.id)).toMatchObject({
    item: { readAt: null, target: { status: "approved", canDecide: false } },
  });
  expect(database().select().from(enrollments).all()).toEqual([]);
  expect(await view()).toMatchObject({
    items: [
      {
        target: {
          type: "purchase",
          purchaseId: purchase.id,
          refundRequestId: refund.id,
          status: "approved",
        },
      },
    ],
    unreadCount: 1,
  });
  database()
    .update(purchases)
    .set({ userId: fixture.instructor.id })
    .where(eq(purchases.id, purchase.id))
    .run();
  expect(await view()).toMatchObject({ items: [], unreadCount: 0 });
});
test("Seat history targets the exact team among multiple memberships and rejects unrelated teams", async () => {
  const first = database().insert(teams).values({}).returning().get();
  const second = database().insert(teams).values({}).returning().get();
  for (const team of [first, second])
    database()
      .insert(teamMembers)
      .values({
        teamId: team.id,
        userId: fixture.user.id,
        role: TeamMemberRole.Admin,
      })
      .run();
  const purchase = database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 1000,
    })
    .returning()
    .get();
  const seat = database()
    .insert(coupons)
    .values({
      teamId: second.id,
      courseId: fixture.course.id,
      purchaseId: purchase.id,
      code: "SEAT",
      redeemedByUserId: fixture.instructor.id,
      redeemedAt: new Date().toISOString(),
    })
    .returning()
    .get();
  const otherPurchase = database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 2000,
    })
    .returning()
    .get();
  database()
    .insert(coupons)
    .values({
      teamId: first.id,
      courseId: fixture.course.id,
      purchaseId: otherPurchase.id,
      code: "OTHER-TEAM-SEAT",
    })
    .run();
  createNotifications(
    database(),
    {
      sourceEventKey: "seat",
      kind: "seat_claimed",
      teamId: second.id,
      seatId: seat.id,
    },
    [fixture.user.id]
  );
  expect(await view()).toMatchObject({
    items: [
      {
        target: {
          type: "team",
          teamId: second.id,
          seatId: seat.id,
          href: `/team?teamId=${second.id}`,
        },
      },
    ],
  });
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    fixture.user.id
  );
  const destination = (teamId: number) =>
    teamLoader({
      request: new Request(`http://localhost/team?teamId=${teamId}`, {
        headers: { Cookie: cookie },
      }),
    } as Parameters<typeof teamLoader>[0]);
  const selectedTeam = await destination(second.id);
  expect(selectedTeam).toMatchObject({
    couponRows: [{ id: seat.id }],
    canBuyMoreSeats: false,
  });
  expect(
    selectedTeam.teamLicences.map((licence) => licence.purchaseId)
  ).toEqual([purchase.id]);
  const defaultTeam = await destination(first.id);
  expect(defaultTeam.canBuyMoreSeats).toBe(true);
  expect(defaultTeam.teamLicences.map((licence) => licence.purchaseId)).toEqual(
    [otherPurchase.id]
  );
  await expect(destination(999)).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
  database().delete(teamMembers).where(eq(teamMembers.teamId, second.id)).run();
  expect(await view()).toMatchObject({ items: [], unreadCount: 0 });
  await expect(destination(second.id)).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
});
test("exact refund destinations reauthorize and preserve unread state after the task changes", async () => {
  const purchase = database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 1000,
    })
    .returning()
    .get();
  const refund = database()
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      reason: "Private reason",
      status: RefundStatus.Approved,
    })
    .returning()
    .get();
  const admin = database()
    .insert(users)
    .values({ name: "Admin", email: "admin@example.com", role: UserRole.Admin })
    .returning()
    .get();
  createNotifications(
    database(),
    {
      sourceEventKey: "approved",
      kind: "refund_approved",
      purchaseId: purchase.id,
      refundRequestId: refund.id,
    },
    [fixture.user.id]
  );
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    admin.id
  );
  const url = new URL(
    `http://localhost/admin/refunds?refundRequestId=${refund.id}`
  );
  expect(
    await reviewLoader({
      request: new Request(url, { headers: { Cookie: cookie } }),
      url,
    } as Parameters<typeof reviewLoader>[0])
  ).toMatchObject({ status: "approved", refundRequests: [{ id: refund.id }] });
  const buyerCookie = await setCurrentUserId(
    new Request("http://localhost"),
    fixture.user.id
  );
  const destination = (cookie: string, id = purchase.id) =>
    purchaseLoader({
      request: new Request(
        `http://localhost/api/purchases/${id}?refundRequestId=${refund.id}`,
        { headers: { Cookie: cookie } }
      ),
      params: { purchaseId: String(id) },
    } as Parameters<typeof purchaseLoader>[0]);
  expect(await destination(buyerCookie)).toMatchObject({
    purchase: { id: purchase.id },
    refundRequest: { id: refund.id, status: "approved" },
  });
  for (const [destinationCookie, id] of [
    [cookie, purchase.id],
    [buyerCookie, 999],
  ] as const)
    await expect(destination(destinationCookie, id)).rejects.toMatchObject({
      data: "Unavailable",
      init: { status: 404 },
    });
  expect(await view()).toMatchObject({ unreadCount: 1 });
});
test("discussion links resolve one exact authorized thread without marking it read", async () => {
  const update = notify();
  database()
    .insert(comments)
    .values({
      userId: fixture.user.id,
      lessonId: fixture.lesson.id,
      body: "Another question",
    })
    .run();
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    fixture.user.id
  );
  const destination = (questionId: number) =>
    lessonLoader({
      request: new Request(
        `http://localhost/courses/${fixture.course.slug}/lessons/${fixture.lesson.id}?questionId=${questionId}`,
        { headers: { Cookie: cookie } }
      ),
      params: {
        slug: fixture.course.slug,
        lessonId: String(fixture.lesson.id),
      },
    } as Parameters<typeof lessonLoader>[0]);
  expect(await destination(fixture.question.id)).toMatchObject({
    comments: [{ id: fixture.question.id }],
  });
  await expect(destination(999)).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
  expect((await view(`?id=${update.id}`)).item?.readAt).toBeNull();
  database().delete(enrollments).run();
  await expect(destination(fixture.question.id)).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
});
test("discussion task status follows staff replies and reads never answer the question", async () => {
  const update = notify();
  expect((await view()).items[0].target).toMatchObject({
    status: "unanswered",
  });
  await read({ intent: "read", id: String(update.id) });
  expect((await view()).items[0].target).toMatchObject({
    status: "unanswered",
  });
  database()
    .insert(comments)
    .values({
      lessonId: fixture.lesson.id,
      parentId: fixture.question.id,
      userId: fixture.instructor.id,
      body: "Instructor response",
    })
    .run();
  expect((await view()).items[0].target).toMatchObject({ status: "answered" });
});
test("malformed detail targets are generically unavailable and activation remains gated", async () => {
  notify();
  for (const id of ["invalid", "-1", "0"])
    await expect(view(`?id=${id}`)).rejects.toMatchObject({
      data: "Unavailable",
      init: { status: 404 },
    });
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "false");
  await expect(view()).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
  await expect(read({ intent: "read-all" })).rejects.toMatchObject({
    data: "Unavailable",
    init: { status: 404 },
  });
});
