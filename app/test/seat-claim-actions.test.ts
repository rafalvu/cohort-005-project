import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestDb, seedBaseData } from "./setup";
import {
  coupons,
  enrollments,
  purchases,
  teams,
  teamMembers,
  users,
  TeamMemberRole,
  UserRole,
  refunds,
  RefundStatus,
} from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { listStoredNotifications } from "~/lib/notifications.server";
const holder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestDb> | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));
import { action, loader } from "~/routes/redeem.$code";
function database() {
  if (!holder.db) throw new Error("Missing database");
  return holder.db;
}
let fixture: ReturnType<typeof seedBaseData>;
let seat: typeof coupons.$inferSelect;
let adminIds: number[];
let otherAdminId: number;
beforeEach(() => {
  holder.db = createTestDb();
  fixture = seedBaseData(database());
  const otherTeam = database().insert(teams).values({}).returning().get();
  const team = database().insert(teams).values({}).returning().get();
  adminIds = [1, 2].map(
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
  otherAdminId = database()
    .insert(users)
    .values({
      name: "Other Admin",
      email: "other@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get().id;
  database()
    .insert(teamMembers)
    .values([
      ...[...adminIds, fixture.user.id].map((userId) => ({
        teamId: team.id,
        userId,
        role: TeamMemberRole.Admin,
      })),
      { teamId: team.id, userId: adminIds[0], role: TeamMemberRole.Member },
      { teamId: team.id, userId: adminIds[0], role: TeamMemberRole.Admin },
      {
        teamId: team.id,
        userId: fixture.instructor.id,
        role: TeamMemberRole.Member,
      },
      ...[adminIds[0], otherAdminId].map((userId) => ({
        teamId: otherTeam.id,
        userId,
        role: TeamMemberRole.Admin,
      })),
    ])
    .run();
  const purchase = database()
    .insert(purchases)
    .values({
      userId: adminIds[0],
      courseId: fixture.course.id,
      amountPaid: 1000,
    })
    .returning()
    .get();
  seat = database()
    .insert(coupons)
    .values({
      teamId: team.id,
      courseId: fixture.course.id,
      purchaseId: purchase.id,
      code: "CLAIM",
    })
    .returning()
    .get();
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "true");
});
afterEach(() => {
  database().$client.close();
  vi.unstubAllEnvs();
});
async function request(
  actor: number | null,
  method: "GET" | "POST" = "POST",
  code = seat.code,
  intent = "confirm-redeem",
  country = "PL"
) {
  const url = `http://localhost/redeem/${code}`;
  const cookie =
    actor === null ? "" : await setCurrentUserId(new Request(url), actor);
  return new Request(url, {
    method,
    headers: { Cookie: cookie, "CF-IPCountry": country },
    ...(method === "POST" ? { body: new URLSearchParams({ intent }) } : {}),
  });
}
async function claim(
  actor = fixture.user.id,
  code = seat.code,
  intent = "confirm-redeem",
  country = "PL"
) {
  return action({
    request: await request(actor, "POST", code, intent, country),
    params: { code },
  } as Parameters<typeof action>[0]);
}
async function view(actor = fixture.user.id) {
  return loader({
    request: await request(actor, "GET"),
    params: { code: seat.code },
  } as Parameters<typeof loader>[0]);
}
function history(id: number) {
  return listStoredNotifications(database(), { recipientId: id }).rows;
}
async function successfulClaim(actor = fixture.user.id) {
  await expect(claim(actor)).rejects.toMatchObject({
    status: 302,
    headers: expect.any(Headers),
  });
}
test("a Seat claim notifies each exact-team Team Admin once, excluding the actor and unrelated roles", async () => {
  await successfulClaim();
  for (const id of adminIds)
    expect(history(id)).toMatchObject([
      { kind: "seat_claimed", teamId: seat.teamId, seatId: seat.id },
    ]);
  for (const id of [fixture.user.id, fixture.instructor.id, otherAdminId])
    expect(history(id)).toEqual([]);
  expect(await view()).toMatchObject({
    alreadyRedeemed: true,
    alreadyEnrolled: true,
  });
});
test("required Notification failure rolls back the Seat, Enrollment and earlier recipients, allowing retry", async () => {
  database().run(
    sql.raw(
      `CREATE TRIGGER reject_notification BEFORE INSERT ON notifications WHEN NEW.recipient_id = ${adminIds[1]} BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END`
    )
  );
  await expect(claim()).rejects.toThrow();
  expect(await view()).toMatchObject({
    alreadyRedeemed: false,
    alreadyEnrolled: false,
  });
  expect(database().select().from(coupons).all()).toEqual([seat]);
  expect(database().select().from(enrollments).all()).toEqual([]);
  for (const id of adminIds) expect(history(id)).toEqual([]);
  database().run(sql.raw("DROP TRIGGER reject_notification"));
  await successfulClaim();
  for (const id of adminIds) expect(history(id)).toHaveLength(1);
});
test.each(["same actor", "competing actors"])(
  "%s submissions and later replay retain one claim outcome",
  async (scenario) => {
    const secondActor =
      scenario === "same actor" ? fixture.user.id : fixture.instructor.id;
    const results = await Promise.allSettled([claim(), claim(secondActor)]);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof Response &&
          result.reason.status === 302
      )
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toMatchObject([
      {
        value: {
          data: { error: "Coupon has already been redeemed" },
          init: { status: 400 },
        },
      },
    ]);
    const claimed = database().select().from(coupons).get();
    const enrollment = database().select().from(enrollments).all();
    expect(enrollment).toHaveLength(1);
    expect(claimed?.redeemedByUserId).toBe(enrollment[0].userId);
    const histories = adminIds.map(history);
    for (const rows of histories) expect(rows).toHaveLength(1);
    await expect(claim(enrollment[0].userId)).resolves.toMatchObject({
      data: { error: "Coupon has already been redeemed" },
      init: { status: 400 },
    });
    expect(database().select().from(coupons).get()).toEqual(claimed);
    expect(database().select().from(enrollments).all()).toEqual(enrollment);
    expect(adminIds.map(history)).toEqual(histories);
  }
);
test.each([
  "enrolled",
  "wrong country",
  "unknown country",
  "open refund",
  "approved refund",
  "missing Seat",
])("%s blocks the claim without Notifications", async (reason) => {
  let error: string;
  switch (reason) {
    case "enrolled":
      database()
        .insert(enrollments)
        .values({ userId: fixture.user.id, courseId: fixture.course.id })
        .run();
      error = "You are already enrolled in this course";
      break;
    case "wrong country":
    case "unknown country":
      database()
        .update(purchases)
        .set({ country: "US" })
        .where(eq(purchases.id, seat.purchaseId))
        .run();
      error =
        "This coupon can only be redeemed from the same country as the purchaser";
      break;
    case "open refund":
      database()
        .insert(refunds)
        .values({
          purchaseId: seat.purchaseId,
          reason: "Please refund",
          status: RefundStatus.Open,
        })
        .run();
      error =
        "This seat can't be claimed right now. Ask the person who shared it with you.";
      break;
    case "approved refund":
      database()
        .insert(refunds)
        .values({
          purchaseId: seat.purchaseId,
          reason: "Please refund",
          status: RefundStatus.Approved,
        })
        .run();
      database()
        .update(coupons)
        .set({ refundedAt: new Date().toISOString() })
        .where(eq(coupons.id, seat.id))
        .run();
      error =
        "This seat is no longer available. Ask the person who shared it with you.";
      break;
    default:
      error = "Coupon not found";
  }
  const before = database().select().from(coupons).all();
  const beforeEnrollments = database().select().from(enrollments).all();
  await expect(
    claim(
      fixture.user.id,
      reason === "missing Seat" ? "MISSING" : seat.code,
      "confirm-redeem",
      reason === "unknown country" ? "XX" : "PL"
    )
  ).resolves.toMatchObject({ data: { error }, init: { status: 400 } });
  expect(database().select().from(coupons).all()).toEqual(before);
  expect(database().select().from(enrollments).all()).toEqual(
    beforeEnrollments
  );
  for (const id of [
    ...adminIds,
    fixture.user.id,
    fixture.instructor.id,
    otherAdminId,
  ])
    expect(history(id)).toEqual([]);
});
test("unsigned and malformed requests cannot claim or notify", async () => {
  await expect(
    action({
      request: await request(null),
      params: { code: seat.code },
    } as Parameters<typeof action>[0])
  ).rejects.toMatchObject({ init: { status: 401 } });
  await expect(
    claim(fixture.user.id, seat.code, "invalid")
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(await view()).toMatchObject({
    alreadyRedeemed: false,
    alreadyEnrolled: false,
  });
  for (const id of adminIds) expect(history(id)).toEqual([]);
});
test("a declined Refund Request restores Seat eligibility and matching country allows a claim", async () => {
  database()
    .insert(refunds)
    .values({
      purchaseId: seat.purchaseId,
      reason: "Please refund",
      status: RefundStatus.Declined,
    })
    .run();
  database()
    .update(purchases)
    .set({ country: "PL" })
    .where(eq(purchases.id, seat.purchaseId))
    .run();
  await successfulClaim();
  expect(await view()).toMatchObject({
    alreadyRedeemed: true,
    alreadyEnrolled: true,
  });
  for (const id of adminIds) expect(history(id)).toHaveLength(1);
});
test("the inactive feature preserves Seat claiming without Notifications", async () => {
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "");
  await successfulClaim();
  expect(await view()).toMatchObject({
    alreadyRedeemed: true,
    alreadyEnrolled: true,
  });
  for (const id of adminIds) expect(history(id)).toEqual([]);
});
test("Enrollment persistence failure leaves the Seat unclaimed and produces no Notifications", async () => {
  database().run(
    sql.raw(
      "CREATE TRIGGER reject_enrollment BEFORE INSERT ON enrollments BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END"
    )
  );
  await expect(claim()).rejects.toThrow();
  expect(await view()).toMatchObject({
    alreadyRedeemed: false,
    alreadyEnrolled: false,
  });
  expect(database().select().from(coupons).all()).toEqual([seat]);
  for (const id of adminIds) expect(history(id)).toEqual([]);
});
