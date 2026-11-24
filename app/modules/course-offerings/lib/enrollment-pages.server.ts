import { eq, sql } from "drizzle-orm";
import { data, redirect } from "react-router";
import { CourseStatus, enrollments } from "~/db/schema";
import { getCurrentPerson } from "~/lib/current-person.server";
import { isEnrolled } from "~/lib/enrollments.server";
import { resolveCountry } from "~/lib/country.server";
import { calculatePppPrice, getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { getCourseDetails, type Db } from "./course.server";

export async function getCourseWelcome(
  db: Db,
  request: Request,
  slug: unknown
) {
  const course = getCourseDetails(db, slug);
  const person = await getCurrentPerson(db, request);
  if (!person || !isEnrolled(db, person.id, course.id))
    throw redirect(`/courses/${course.slug}`);
  return { course, discordInviteUrl: process.env.DISCORD_INVITE_URL || null };
}

export async function getCoursePurchasePreview(
  db: Db,
  request: Request,
  slug: unknown
) {
  const course = getCourseDetails(db, slug);
  if (course.status !== CourseStatus.Published)
    throw data("Course not found.", { status: 404 });
  const person = await getCurrentPerson(db, request);
  if (!person)
    throw redirect(
      `/signup?redirectTo=${encodeURIComponent(`/courses/${course.slug}/purchase`)}`
    );
  const enrolled = isEnrolled(db, person.id, course.id);
  if (enrolled && new URL(request.url).searchParams.get("mode") !== "team") {
    throw redirect(`/courses/${course.slug}?already_enrolled=1`);
  }
  const enrollmentCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
      .get()?.count ?? 0;
  const curriculum = course.modules.flatMap((section) => section.lessons);
  const country = await resolveCountry(request);
  return {
    course,
    lessonCount: curriculum.length,
    enrollmentCount,
    totalDuration: curriculum.reduce(
      (sum, lesson) => sum + (lesson.durationMinutes ?? 0),
      0
    ),
    pppPrice: course.pppEnabled
      ? calculatePppPrice(course.price, country)
      : course.price,
    tierInfo: getCountryTierInfo(country),
    country,
    countryName: country
      ? (COUNTRIES.find((one) => one.code === country)?.name ?? country)
      : null,
    isEnrolled: enrolled,
  };
}
