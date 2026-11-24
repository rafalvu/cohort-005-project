import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { data } from "react-router";
import { z } from "zod";
import type * as schema from "~/db/schema";
import { courses, modules } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;
export const identifier = z
  .union([z.number(), z.string().trim().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().positive().safe());

export function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw data(result.error.issues[0]?.message ?? "Invalid input.", {
      status: 400,
    });
  return result.data;
}

export function resolveCourse(db: Db, courseId: number) {
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) throw data("Course not found.", { status: 404 });
  return course;
}

export function resolveSection(db: Db, courseId: number, sectionId: number) {
  const section = db
    .select()
    .from(modules)
    .where(eq(modules.id, sectionId))
    .get();
  if (!section || section.courseId !== courseId)
    throw data("Section not found in this course.", { status: 404 });
  return section;
}

export const orderedIdentifiers = z
  .string()
  .transform((value, context): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid ordered identifiers.",
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(z.number().int().positive().safe())
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate identifiers."
      )
  );
