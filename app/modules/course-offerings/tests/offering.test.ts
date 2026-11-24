import { afterEach, beforeEach, expect, it } from "vitest";
import { getCourseOffering } from "~/modules/course-offerings/index.server";
import { UserRole } from "~/db/schema";
import { offeringFixture, requestFor } from "./fixtures";

let f: Awaited<ReturnType<typeof offeringFixture>>;
beforeEach(async () => {
  f = await offeringFixture();
});
afterEach(() => {
  f.db.$client.close();
});

it("removes management presentation after role removal while retaining enrolled history", async () => {
  await f.enroll(f.instructor.id);
  f.complete(f.instructor.id);
  const request = await requestFor(f.instructor.id);
  expect(await getCourseOffering(f.db, request, f.course.slug)).toMatchObject({
    canManage: true,
    isOwningInstructor: true,
    enrolled: true,
    progress: 33,
  });
  f.demote();
  expect(await getCourseOffering(f.db, request, f.course.slug)).toMatchObject({
    canManage: false,
    isOwningInstructor: false,
    enrolled: true,
    progress: 33,
    lessonProgressMap: { [f.firstLesson.id]: "completed" },
  });
  expect(
    await getCourseOffering(
      f.db,
      await requestFor(f.addPerson(UserRole.Admin).id),
      f.course.slug
    )
  ).toMatchObject({
    canManage: true,
    isOwningInstructor: false,
    enrolled: false,
    progress: 0,
  });
});

it.each([null, 999999])(
  "returns a safe public offering for absent or stale identity %s",
  async (userId) => {
    const result = await getCourseOffering(
      f.db,
      await requestFor(userId),
      f.course.slug
    );
    expect(result).toMatchObject({
      currentUserId: null,
      canManage: false,
      isOwningInstructor: false,
      enrolled: false,
      progress: 0,
      lessonProgressMap: {},
      nextLessonId: null,
      userRating: null,
      refundOffer: null,
      ratingSummary: { average: null, count: 0 },
    });
    expect(result.course.modules[0]?.lessons[0]).toEqual({
      id: f.firstLesson.id,
      title: "Lesson 1",
      durationMinutes: 10,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Protected body|video\.example|code\.example|"videoUrl"|"githubRepoUrl"|"content"/
    );
  }
);

it("preserves offering prices and enrolled progress independently of the surviving lesson qualification", async () => {
  await f.enroll();
  f.purchase("IN");
  f.complete();
  expect(
    await getCourseOffering(f.db, await requestFor(f.user.id), f.course.slug)
  ).toMatchObject({
    enrolled: true,
    progress: 33,
    nextLessonId: f.lessons[1]?.id,
    pppPrice: 7900,
    refundOffer: { amount: 7900 },
  });
  expect(
    await getCourseOffering(
      f.db,
      await requestFor(f.user.id, "IN"),
      f.course.slug
    )
  ).toMatchObject({ pppPrice: 3950 });
  expect(
    await getCourseOffering(
      f.db,
      await requestFor(f.user.id, "XX"),
      f.course.slug
    )
  ).toMatchObject({ pppPrice: 7900 });
});
