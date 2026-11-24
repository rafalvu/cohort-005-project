import { afterEach, beforeEach, expect, it } from "vitest";
import {
  getCourseWelcome,
  getCoursePurchasePreview,
} from "~/modules/course-offerings/index.server";
import { CourseStatus, courses } from "~/db/schema";
import { eq } from "drizzle-orm";
import { offeringFixture, requestFor } from "./fixtures";

let f: ReturnType<typeof offeringFixture>;
beforeEach(() => {
  f = offeringFixture();
});
afterEach(() => {
  f.db.$client.close();
});

it("preserves welcome Enrollment and purchase team-mode redirects without introducing a country gate", async () => {
  for (const userId of [null, 999999, f.user.id]) {
    await expect(
      getCourseWelcome(f.db, await requestFor(userId), f.course.slug)
    ).rejects.toMatchObject({ status: 302 });
  }
  await f.enroll();
  f.purchase("IN");
  const request = await requestFor(f.user.id);
  expect(await getCourseWelcome(f.db, request, f.course.slug)).toMatchObject({
    course: { id: f.course.id },
  });
  await expect(
    getCoursePurchasePreview(f.db, request, f.course.slug)
  ).rejects.toMatchObject({ status: 302 });
  const team = new Request(`${request.url}/purchase?mode=team`, {
    headers: request.headers,
  });
  expect(
    await getCoursePurchasePreview(f.db, team, f.course.slug)
  ).toMatchObject({
    isEnrolled: true,
    lessonCount: 3,
    enrollmentCount: 1,
    totalDuration: 30,
    pppPrice: 7900,
  });
  f.db
    .update(courses)
    .set({ status: CourseStatus.Draft })
    .where(eq(courses.id, f.course.id))
    .run();
  await expect(
    getCoursePurchasePreview(f.db, team, f.course.slug)
  ).rejects.toMatchObject({ init: { status: 404 } });
});
