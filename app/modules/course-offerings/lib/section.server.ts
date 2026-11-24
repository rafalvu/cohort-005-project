import { and, eq, sql } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import { lessons, modules, LessonProgressStatus } from "~/db/schema";
import { getCurrentPerson } from "~/lib/current-person.server";
import { isEnrolled } from "~/lib/enrollments.server";
import {
  getCourseDetails,
  getProgressMap,
  slugSchema,
  type Db,
} from "./course.server";

const targetSchema = z.object({
  slug: slugSchema,
  moduleId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
});

export async function getCourseSectionOverview(
  db: Db,
  request: Request,
  input: unknown
) {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) throw data("Invalid parameters.", { status: 400 });
  const course = getCourseDetails(db, parsed.data.slug);
  const section = db
    .select({
      id: modules.id,
      title: modules.title,
      courseId: modules.courseId,
    })
    .from(modules)
    .where(
      and(eq(modules.id, parsed.data.moduleId), eq(modules.courseId, course.id))
    )
    .get();
  if (!section) throw data("Module not found in this course.", { status: 404 });
  const curriculum = db
    .select({
      id: lessons.id,
      title: lessons.title,
      durationMinutes: lessons.durationMinutes,
      hasVideo:
        sql<boolean>`case when ${lessons.videoUrl} is not null and ${lessons.videoUrl} != '' then 1 else 0 end`.mapWith(
          Boolean
        ),
    })
    .from(lessons)
    .where(eq(lessons.moduleId, section.id))
    .orderBy(lessons.position)
    .all();
  const person = await getCurrentPerson(db, request);
  const enrolled = person !== undefined && isEnrolled(db, person.id, course.id);
  const lessonProgressMap =
    enrolled && person
      ? getProgressMap(
          db,
          person.id,
          course.modules.flatMap((section) =>
            section.lessons.map((lesson) => lesson.id)
          )
        )
      : {};
  const completedLessons = curriculum.filter(
    (lesson) => lessonProgressMap[lesson.id] === LessonProgressStatus.Completed
  ).length;
  return {
    course: {
      id: course.id,
      title: course.title,
      slug: course.slug,
      instructorName: course.instructorName,
      instructorAvatarUrl: course.instructorAvatarUrl,
      instructorBio: course.instructorBio,
    },
    module: { ...section, lessons: curriculum },
    enrolled,
    lessonProgressMap,
    moduleProgress: curriculum.length
      ? Math.round((completedLessons / curriculum.length) * 100)
      : 0,
    completedLessons,
    totalLessons: curriculum.length,
    totalDuration: curriculum.reduce(
      (sum, lesson) => sum + (lesson.durationMinutes ?? 0),
      0
    ),
  };
}
