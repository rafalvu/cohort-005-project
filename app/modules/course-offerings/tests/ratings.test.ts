import { afterEach, beforeEach, expect, it } from "vitest";
import {
  getCourseOffering,
  rateCourse,
} from "~/modules/course-offerings/index.server";
import { courseRatings, UserRole } from "~/db/schema";
import { offeringFixture, requestFor } from "./fixtures";

let f: Awaited<ReturnType<typeof offeringFixture>>;
beforeEach(async () => {
  f = await offeringFixture();
});
afterEach(() => {
  f.db.$client.close();
});
async function ratingRequest(userId: number | null, rating: string) {
  return new Request(await requestFor(userId), {
    method: "POST",
    body: new URLSearchParams({ rating }),
  });
}

it("lets an enrolled Student rate from a blocked country and retain the rating after Enrollment ends", async () => {
  await f.enroll();
  f.purchase("IN");
  expect(
    await rateCourse(f.db, await ratingRequest(f.user.id, "4"), f.course.slug)
  ).toEqual({ ok: true, error: null });
  expect(
    await getCourseOffering(f.db, await requestFor(f.user.id), f.course.slug)
  ).toMatchObject({
    userRating: 4,
    ratingSummary: { average: 4, count: 1 },
    refundOffer: { amount: 7900 },
  });
  f.unenroll();
  expect(
    await getCourseOffering(f.db, await requestFor(f.user.id), f.course.slug)
  ).toMatchObject({
    enrolled: false,
    userRating: 4,
    ratingSummary: { average: 4, count: 1 },
    refundOffer: null,
  });
  await expect(
    rateCourse(f.db, await ratingRequest(f.user.id, "5"), f.course.slug)
  ).rejects.toMatchObject({ init: { status: 403 } });
});

it("updates a rating without duplicating it and rounds all historical ratings to one decimal", async () => {
  await f.enroll();
  await rateCourse(f.db, await ratingRequest(f.user.id, "1"), f.course.slug);
  const initial = f.db.select().from(courseRatings).get();
  await rateCourse(f.db, await ratingRequest(f.user.id, "2"), f.course.slug);
  expect(f.db.select().from(courseRatings).get()).toMatchObject({
    createdAt: initial?.createdAt,
    rating: 2,
  });
  for (const rating of ["5", "3"]) {
    const person = f.addPerson();
    await f.enroll(person.id);
    await rateCourse(
      f.db,
      await ratingRequest(person.id, rating),
      f.course.slug
    );
    f.unenroll(person.id);
  }
  expect(
    await getCourseOffering(f.db, await requestFor(f.user.id), f.course.slug)
  ).toMatchObject({
    userRating: 2,
    ratingSummary: { average: 3.3, count: 3 },
  });
});

it.each([null, 999999])(
  "rejects identity %s before malformed body or target and leaves all records unchanged",
  async (userId) => {
    const authenticated = await requestFor(userId);
    const request = new Request(authenticated, {
      method: "POST",
      body: "broken",
      headers: {
        Cookie: authenticated.headers.get("Cookie") ?? "",
        "Content-Type": "application/json",
      },
    });
    const before = f.db.$client.serialize();
    const notifications = [...f.notifications.sent];
    await expect(rateCourse(f.db, request, "")).rejects.toMatchObject({
      init: { status: 401 },
    });
    expect(f.db.$client.serialize().equals(before)).toBe(true);
    expect(f.notifications.sent).toEqual(notifications);
  }
);

it("validates commands before resolving the target and Enrollment, with no changes after rejection", async () => {
  const request = await requestFor(f.user.id);
  for (const body of [
    new URLSearchParams({ rating: "0" }),
    new URLSearchParams({ rating: "6" }),
    new URLSearchParams({ rating: "2.5" }),
    new URLSearchParams({ rating: "5", userId: String(f.instructor.id) }),
    new URLSearchParams([
      ["rating", "1"],
      ["rating", "5"],
    ]),
  ]) {
    const before = f.db.$client.serialize();
    await expect(
      rateCourse(
        f.db,
        new Request(request, { method: "POST", body }),
        "missing"
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(f.db.$client.serialize().equals(before)).toBe(true);
  }
  const before = f.db.$client.serialize();
  await expect(
    rateCourse(f.db, await ratingRequest(f.user.id, "5"), "missing")
  ).rejects.toMatchObject({ init: { status: 404 } });
  await expect(
    rateCourse(f.db, await ratingRequest(f.instructor.id, "5"), f.course.slug)
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(f.db.$client.serialize().equals(before)).toBe(true);
});

it("requires Enrollment even for Platform Admin ratings, then accepts their enrolled rating", async () => {
  const admin = f.addPerson(UserRole.Admin);
  const before = f.db.$client.serialize();
  await expect(
    rateCourse(f.db, await ratingRequest(admin.id, "5"), f.course.slug)
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(f.db.$client.serialize().equals(before)).toBe(true);
  await f.enroll(admin.id);
  f.purchase("IN", admin.id);
  expect(
    await rateCourse(f.db, await ratingRequest(admin.id, "5"), f.course.slug)
  ).toEqual({ ok: true, error: null });
});

it("preserves the existing whole-number form coercion for ratings", async () => {
  await f.enroll();
  expect(
    await rateCourse(
      f.db,
      await ratingRequest(f.user.id, " 4.0 "),
      f.course.slug
    )
  ).toEqual({ ok: true, error: null });
  expect(
    await getCourseOffering(f.db, await requestFor(f.user.id), f.course.slug)
  ).toMatchObject({ userRating: 4 });
});
