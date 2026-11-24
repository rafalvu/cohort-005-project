import { readCommand } from "./reporting-command.server";
import { getInstructorAnalytics } from "~/modules/instructor-analytics/index.server";
import { eq, sql } from "drizzle-orm";
import { data } from "react-router";
import {
  courses,
  enrollments,
  lessons,
  modules,
  UserRole,
  categories,
  CourseStatus,
} from "~/db/schema";
import {
  requireCurrentPerson,
  requireInstructorOrAdmin,
} from "~/modules/course-permissions/index.server";
import { identifier, parseInput, type Db } from "./targets.server";
import { z } from "zod";
import { markdown } from "~/lib/text";

function requireInstructor(person: { role: UserRole }) {
  if (person.role !== UserRole.Instructor)
    throw data("Only instructors can access this page.", { status: 403 });
}

export async function getInstructorWorkspace(db: Db, request: Request) {
  const person = await requireCurrentPerson(db, request);
  requireInstructor(person);
  const ownedCourses = db
    .select()
    .from(courses)
    .where(eq(courses.instructorId, person.id))
    .all();
  return {
    courses: ownedCourses.map((course) => ({
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: course.description,
      status: course.status,
      coverImageUrl: course.coverImageUrl,
      lessonCount:
        db
          .select({ count: sql<number>`count(*)` })
          .from(lessons)
          .innerJoin(modules, eq(modules.id, lessons.moduleId))
          .where(eq(modules.courseId, course.id))
          .get()?.count ?? 0,
      enrollmentCount:
        db
          .select({ count: sql<number>`count(*)` })
          .from(enrollments)
          .where(eq(enrollments.courseId, course.id))
          .get()?.count ?? 0,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    })),
  };
}

export async function getCourseCreation(db: Db, request: Request) {
  const person = await requireCurrentPerson(db, request);
  requireInstructor(person);
  return {
    categories: db.select().from(categories).orderBy(categories.name).all(),
  };
}

function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const newCourseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .refine(
      (title) => generateSlug(title).length > 0,
      "Title must contain letters or numbers."
    ),
  description: z.string().trim().min(1, "Description is required."),
  salesCopy: z.string().trim().min(1, "Sales copy is required."),
  categoryId: identifier,
  coverImageUrl: z.string().trim().optional(),
});

export async function createInstructorCourse(db: Db, request: Request) {
  const person = await requireCurrentPerson(db, request);
  const command = parseInput(newCourseSchema, await readCommand(request));
  if (
    !db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, command.categoryId))
      .get()
  )
    throw data("Category not found.", { status: 404 });
  requireInstructor(person);
  const slug = generateSlug(command.title);
  return db.transaction((tx) => {
    if (
      tx
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.slug, slug))
        .get()
    )
      throw data("A course with a similar title already exists.", {
        status: 400,
      });
    return tx
      .insert(courses)
      .values({
        title: command.title,
        slug,
        description: command.description,
        salesCopy: markdown(command.salesCopy),
        instructorId: person.id,
        categoryId: command.categoryId,
        status: CourseStatus.Draft,
        coverImageUrl: command.coverImageUrl || null,
      })
      .returning()
      .get();
  });
}

export async function getInstructorReport(db: Db, request: Request, now: Date) {
  const viewer = await requireInstructorOrAdmin(db, request);
  return getInstructorAnalytics(db, {
    viewer,
    searchParams: new URL(request.url).searchParams,
    now,
  });
}
