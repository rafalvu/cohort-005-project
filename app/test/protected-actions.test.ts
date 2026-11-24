import { RouterContextProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { db } from "~/db";
import * as schema from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { action as decideRefund } from "~/routes/admin.refunds";
import { action as recordVideo } from "~/routes/api.video-tracking";
import { action as editCourse } from "~/routes/instructor.$courseId";
import { seedBaseData } from "./setup";

vi.mock("~/db", async () => ({ db: (await import("./setup")).createTestDb() }));
const { user, course } = seedBaseData(db);
const other = db
  .insert(schema.users)
  .values({
    name: "Other instructor",
    role: schema.UserRole.Instructor,
    email: "other@test.example",
  })
  .returning()
  .get();
const admin = db
  .insert(schema.users)
  .values({
    name: "Admin",
    role: schema.UserRole.Admin,
    email: "admin@test.example",
  })
  .returning()
  .get();
const purchase = db
  .insert(schema.purchases)
  .values({ courseId: course.id, userId: user.id, amountPaid: 500 })
  .returning()
  .get();
const refund = db
  .insert(schema.refunds)
  .values({ purchaseId: purchase.id, reason: "test" })
  .returning()
  .get();

async function args(path: string, body: BodyInit, userId?: number) {
  const url = new URL(path, "https://test.invalid");
  const request = new Request(url, { method: "POST", body });
  if (userId)
    request.headers.set(
      "Cookie",
      (await setCurrentUserId(request, userId)).split(";")[0]
    );
  return {
    request,
    url,
    context: new RouterContextProvider(),
    params: { courseId: String(course.id) },
    pattern: path,
  };
}
it("protects the refund action when called without its loader", async () => {
  for (const [id, status] of [
    [undefined, 401],
    [user.id, 403],
  ] as const) {
    const form = new URLSearchParams({
      intent: "approve",
      refundRequestId: String(refund.id),
    });
    await expect(
      decideRefund(await args("/admin/refunds", form, id))
    ).rejects.toMatchObject({ init: { status } });
  }
  expect(db.select().from(schema.refunds).get()?.status).toBe(
    schema.RefundStatus.Open
  );
});
it("rejects a blank refund ID before looking up a refund", async () => {
  const result = await decideRefund(
    await args(
      "/admin/refunds",
      new URLSearchParams({ intent: "approve", refundRequestId: " " }),
      admin.id
    )
  );
  expect(result).toMatchObject({ init: { status: 400 } });
  expect(db.select().from(schema.refunds).get()?.status).toBe(
    schema.RefundStatus.Open
  );
});
it("denies a course mutation by another instructor", async () => {
  await expect(
    editCourse(
      await args(
        "/instructor/" + course.id,
        new URLSearchParams({ intent: "update-price", price: "50.00" }),
        other.id
      )
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(db.select().from(schema.courses).get()?.price).toBe(course.price);
});
it("rejects malformed JSON and invalid numeric video data without recording an event", async () => {
  for (const body of [
    "{",
    JSON.stringify({ lessonId: -1, eventType: "play", positionSeconds: 0 }),
  ]) {
    await expect(
      recordVideo(await args("/api/video-tracking", body, user.id))
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
  expect(db.select().from(schema.videoWatchEvents).all()).toEqual([]);
});
