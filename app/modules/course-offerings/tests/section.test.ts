import { afterEach, beforeEach, expect, it } from "vitest";
import { getCourseSectionOverview } from "~/modules/course-offerings/index.server";
import { courses, modules } from "~/db/schema";
import { offeringFixture, requestFor } from "./fixtures";

let f: ReturnType<typeof offeringFixture>;
beforeEach(() => {
  f = offeringFixture();
});
afterEach(() => {
  f.db.$client.close();
});

it("rejects malformed and foreign sections while retaining safe enrolled history in a blocked country", async () => {
  await f.enroll();
  f.purchase("IN");
  f.complete();
  const request = await requestFor(f.user.id);
  for (const moduleId of [
    "0",
    "-1",
    " ",
    "",
    "1suffix",
    "1.5",
    "9007199254740992",
  ]) {
    await expect(
      getCourseSectionOverview(f.db, request, { slug: f.course.slug, moduleId })
    ).rejects.toMatchObject({ init: { status: 400 } });
  }
  const otherCourse = f.db
    .insert(courses)
    .values({ ...f.course, id: undefined, slug: "other" })
    .returning()
    .get();
  const otherSection = f.db
    .insert(modules)
    .values({ courseId: otherCourse.id, title: "Other", position: 0 })
    .returning()
    .get();
  for (const moduleId of [String(otherSection.id), "999999"]) {
    await expect(
      getCourseSectionOverview(f.db, request, { slug: f.course.slug, moduleId })
    ).rejects.toMatchObject({ init: { status: 404 } });
  }
  const result = await getCourseSectionOverview(f.db, request, {
    slug: f.course.slug,
    moduleId: String(f.section.id),
  });
  expect(result).toMatchObject({
    enrolled: true,
    completedLessons: 1,
    totalLessons: 3,
    totalDuration: 30,
    moduleProgress: 33,
  });
  expect(result.module.lessons[0]).toEqual({
    id: f.firstLesson.id,
    title: "Lesson 1",
    durationMinutes: 10,
    hasVideo: true,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /Protected body|video\.example|code\.example/
  );
});
