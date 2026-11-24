import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import { courseRatings, courses } from "~/db/schema";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { isEnrolled } from "~/lib/enrollments.server";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";
import { slugSchema, type Db } from "./course.server";

const commandSchema = z
  .object({
    slug: slugSchema,
    rating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING),
  })
  .strict();

export async function rateCourse(db: Db, request: Request, slug: unknown) {
  const person = await requireCurrentPerson(db, request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw data("Invalid rating command.", { status: 400 });
  }
  if ([...form.keys()].some((key) => form.getAll(key).length !== 1)) {
    throw data("Invalid rating command.", { status: 400 });
  }
  const parsed = commandSchema.safeParse({ ...Object.fromEntries(form), slug });
  if (!parsed.success)
    throw data("Please choose a rating from 1 to 5.", { status: 400 });
  const course = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, parsed.data.slug))
    .get();
  if (!course) throw data("Course not found.", { status: 404 });
  // Rating eligibility is Enrollment-only, independently of lesson country permission.
  if (!isEnrolled(db, person.id, course.id)) {
    throw data("You must be enrolled in this course to rate it.", {
      status: 403,
    });
  }
  const existing = db
    .select({ id: courseRatings.id })
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, person.id),
        eq(courseRatings.courseId, course.id)
      )
    )
    .get();
  if (existing) {
    db.update(courseRatings)
      .set({ rating: parsed.data.rating, updatedAt: new Date().toISOString() })
      .where(eq(courseRatings.id, existing.id))
      .run();
  } else {
    db.insert(courseRatings)
      .values({
        userId: person.id,
        courseId: course.id,
        rating: parsed.data.rating,
      })
      .run();
  }
  return { ok: true as const, error: null };
}
