import { and, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { data } from "react-router";
import { z } from "zod";
import type * as schema from "~/db/schema";
import {
  categories,
  courses,
  lessonProgress,
  lessons,
  modules,
  users,
} from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;
export const slugSchema = z.string().trim().min(1);

export function getCourseDetails(db: Db, input: unknown) {
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success)
    throw data("Invalid course identifier.", { status: 400 });
  const course = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      salesCopy: courses.salesCopy,
      instructorId: courses.instructorId,
      categoryId: courses.categoryId,
      status: courses.status,
      coverImageUrl: courses.coverImageUrl,
      price: courses.price,
      pppEnabled: courses.pppEnabled,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      instructorName: users.name,
      instructorAvatarUrl: users.avatarUrl,
      instructorBio: users.bio,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .where(eq(courses.slug, parsed.data))
    .get();
  if (!course) throw data("Course not found.", { status: 404 });
  const sections = db
    .select({ id: modules.id, title: modules.title })
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(modules.position)
    .all();
  const curriculum = sections.length
    ? db
        .select({
          id: lessons.id,
          moduleId: lessons.moduleId,
          title: lessons.title,
          durationMinutes: lessons.durationMinutes,
        })
        .from(lessons)
        .where(
          inArray(
            lessons.moduleId,
            sections.map((section) => section.id)
          )
        )
        .orderBy(lessons.position)
        .all()
    : [];
  return {
    ...course,
    modules: sections.map((section) => ({
      ...section,
      lessons: curriculum
        .filter((lesson) => lesson.moduleId === section.id)
        .map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          durationMinutes: lesson.durationMinutes,
        })),
    })),
  };
}

export function getProgressMap(db: Db, userId: number, lessonIds: number[]) {
  const progress = lessonIds.length
    ? db
        .select({
          lessonId: lessonProgress.lessonId,
          status: lessonProgress.status,
        })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, userId),
            inArray(lessonProgress.lessonId, lessonIds)
          )
        )
        .all()
    : [];
  return Object.fromEntries(
    progress.map((record) => [record.lessonId, record.status])
  ) as Record<number, string>;
}
