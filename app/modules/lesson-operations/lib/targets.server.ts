import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";

export type LessonDatabase = BetterSQLite3Database<typeof schema>;
export const positiveIdSchema = z
  .union([z.number(), z.string().regex(/^[1-9]\d*$/)])
  .pipe(z.coerce.number().int().positive().safe());
export const lessonTargetSchema = z.object({
  slug: z.string().trim().min(1),
  lessonId: positiveIdSchema,
});

export function resolveLessonById(db: LessonDatabase, lessonId: number) {
  const target = db
    .select({
      lesson: schema.lessons,
      module: schema.modules,
      course: schema.courses,
    })
    .from(schema.lessons)
    .innerJoin(schema.modules, eq(schema.lessons.moduleId, schema.modules.id))
    .innerJoin(schema.courses, eq(schema.modules.courseId, schema.courses.id))
    .where(eq(schema.lessons.id, lessonId))
    .get();
  if (!target) throw data("Lesson not found", { status: 404 });
  return target;
}

export function resolveLessonTarget(db: LessonDatabase, input: unknown) {
  const parsed = lessonTargetSchema.safeParse(input);
  if (!parsed.success) throw data("Invalid lesson target", { status: 400 });
  const target = resolveLessonById(db, parsed.data.lessonId);
  if (target.course.slug !== parsed.data.slug)
    throw data("Lesson not found in this course", { status: 404 });
  return target;
}
