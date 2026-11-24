import { and, eq, sql } from "drizzle-orm";
import { courseRatings, LessonProgressStatus } from "~/db/schema";
import { getCoursePermissions } from "~/modules/course-permissions/index.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getRefundOffer } from "~/lib/refunds.server";
import { resolveCountry } from "~/lib/country.server";
import { calculatePppPrice, getCountryTierInfo } from "~/lib/ppp";
import { getCourseDetails, getProgressMap, type Db } from "./course.server";

export async function getCourseOffering(
  db: Db,
  request: Request,
  slug: unknown
) {
  const course = getCourseDetails(db, slug);
  const permissions = await getCoursePermissions(db, request, course.id);
  const currentUserId = permissions.userId;
  const enrolled = permissions.enrolled;
  const curriculum = course.modules.flatMap((section) => section.lessons);
  const lessonProgressMap =
    enrolled && currentUserId !== null
      ? getProgressMap(
          db,
          currentUserId,
          curriculum.map((lesson) => lesson.id)
        )
      : {};
  const completed = curriculum.filter(
    (lesson) => lessonProgressMap[lesson.id] === LessonProgressStatus.Completed
  ).length;
  const progress = curriculum.length
    ? Math.round((completed / curriculum.length) * 100)
    : 0;
  const nextLessonId = enrolled
    ? (curriculum.find(
        (lesson) =>
          lessonProgressMap[lesson.id] !== LessonProgressStatus.Completed
      )?.id ?? null)
    : null;
  const refundOffer =
    enrolled && currentUserId !== null
      ? getRefundOffer(db, currentUserId, course.id, new Date())
      : null;
  const rating = db
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, course.id))
    .get();
  const ratingSummary = {
    average:
      rating?.average == null ? null : Math.round(rating.average * 10) / 10,
    count: rating?.count ?? 0,
  };
  const userRating =
    currentUserId === null
      ? null
      : (db
          .select({ rating: courseRatings.rating })
          .from(courseRatings)
          .where(
            and(
              eq(courseRatings.userId, currentUserId),
              eq(courseRatings.courseId, course.id)
            )
          )
          .get()?.rating ?? null);
  const country = await resolveCountry(request);
  return {
    course,
    salesCopyHtml: await renderMarkdown(course.salesCopy),
    lessonCount: curriculum.length,
    enrolled,
    progress,
    lessonProgressMap,
    nextLessonId,
    currentUserId,
    canManage: permissions.isStaff,
    isOwningInstructor: permissions.isOwningInstructor,
    pppPrice: course.pppEnabled
      ? calculatePppPrice(course.price, country)
      : course.price,
    tierInfo: getCountryTierInfo(country),
    ratingSummary,
    userRating,
    refundOffer,
  };
}
