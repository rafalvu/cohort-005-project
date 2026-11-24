import {
  archiveForCommentSafely,
  type Notifications,
} from "~/lib/notifications.server";
import { deleteLessons } from "./delete-lessons.server";
import { markdown } from "~/lib/text";
import { CourseStatus } from "~/db/schema";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { data } from "react-router";
import { categories, courses, users, modules, lessons } from "~/db/schema";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { requireCourseManagement } from "~/modules/course-permissions/index.server";
import {
  identifier,
  orderedIdentifiers,
  parseInput,
  resolveCourse,
  resolveSection,
  type Db,
} from "./targets.server";

import {
  getCourseEnrolledStudents,
  getCourseStudentSummaries,
} from "./student-summaries.server";

function getCourseWithDetails(db: Db, id: number) {
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
    .where(eq(courses.id, id))
    .get();

  if (!course) return null;

  const courseModules = db
    .select()
    .from(modules)
    .where(eq(modules.courseId, id))
    .orderBy(modules.position)
    .all();

  const moduleIds = courseModules.map((m) => m.id);

  const courseLessons =
    moduleIds.length > 0
      ? db
          .select()
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .orderBy(lessons.position)
          .all()
      : [];

  return {
    ...course,
    modules: courseModules.map((mod) => ({
      ...mod,
      lessons: courseLessons.filter((l) => l.moduleId === mod.id),
    })),
  };
}

export async function getCourseEditor(
  db: Db,
  request: Request,
  rawCourseId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  resolveCourse(db, courseId);
  await requireCourseManagement(db, request, courseId);
  const course = getCourseWithDetails(db, courseId);
  if (!course) throw data("Course not found.", { status: 404 });
  const courseLessons = course.modules.flatMap((section) => section.lessons);
  const enrolledStudents = getCourseEnrolledStudents(db, courseId);
  const lessonCount = courseLessons.length;
  const enrollmentCount = enrolledStudents.length;
  const { students, quizCount } = getCourseStudentSummaries(
    db,
    courseLessons,
    enrolledStudents
  );

  return { course, lessonCount, enrollmentCount, students, quizCount };
}

const settingsCommand = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update-title"),
    title: z.string().trim().min(1, "Title cannot be empty."),
  }),
  z.object({
    intent: z.literal("update-description"),
    description: z.string().trim().min(1, "Description cannot be empty."),
  }),
  z.object({
    intent: z.literal("update-status"),
    status: z.nativeEnum(CourseStatus),
  }),
  z.object({
    intent: z.literal("update-ppp-enabled"),
    pppEnabled: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
  }),
  z.object({
    intent: z.literal("update-sales-copy"),
    salesCopy: z.string().trim().min(1, "Sales copy cannot be empty."),
  }),
  z.object({
    intent: z.literal("update-price"),
    price: z
      .string()
      .trim()
      .min(1)
      .pipe(z.coerce.number().finite().min(0).max(9999.99)),
  }),
]);

export async function updateCourseSettings(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(settingsCommand, rawCommand);
  resolveCourse(db, courseId);
  await requireCourseManagement(db, request, courseId);
  const updatedAt = new Date().toISOString();
  switch (command.intent) {
    case "update-title":
      db.update(courses)
        .set({ title: command.title, updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "title" };
    case "update-description":
      db.update(courses)
        .set({ description: command.description, updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "description" };
    case "update-status":
      db.update(courses)
        .set({ status: command.status, updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "status" };
    case "update-price":
      db.update(courses)
        .set({ price: Math.round(command.price * 100), updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "price" };
    case "update-ppp-enabled":
      db.update(courses)
        .set({ pppEnabled: command.pppEnabled, updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "ppp-enabled" };
    case "update-sales-copy":
      db.update(courses)
        .set({ salesCopy: markdown(command.salesCopy), updatedAt })
        .where(eq(courses.id, courseId))
        .run();
      return { success: true, field: "sales-copy" };
  }
}

const sectionTitle = z.string().trim().min(1, "Module title cannot be empty.");

export async function createCourseSection(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const { title } = parseInput(z.object({ title: sectionTitle }), rawCommand);
  resolveCourse(db, courseId);
  await requireCourseManagement(db, request, courseId);
  db.transaction((tx) => {
    const last = tx
      .select({ position: sql<number>`coalesce(max(${modules.position}), 0)` })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .get();
    tx.insert(modules)
      .values({ courseId, title, position: (last?.position ?? 0) + 1 })
      .run();
  });
  return { success: true, field: "module" };
}

export async function renameCourseSection(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const { moduleId, title } = parseInput(
    z.object({ moduleId: identifier, title: sectionTitle }),
    rawCommand
  );
  resolveCourse(db, courseId);
  resolveSection(db, courseId, moduleId);
  await requireCourseManagement(db, request, courseId);
  db.update(modules).set({ title }).where(eq(modules.id, moduleId)).run();
  return { success: true, field: "module" };
}

export async function reorderCourseSections(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const { moduleIds } = parseInput(
    z.object({ moduleIds: orderedIdentifiers }),
    rawCommand
  );
  resolveCourse(db, courseId);
  for (const moduleId of moduleIds) resolveSection(db, courseId, moduleId);
  const courseSections = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();
  if (moduleIds.length !== courseSections.length)
    throw data("Include every section exactly once.", { status: 400 });
  await requireCourseManagement(db, request, courseId);
  db.transaction((tx) => {
    moduleIds.forEach((moduleId, index) => {
      tx.update(modules)
        .set({ position: index + 1 })
        .where(eq(modules.id, moduleId))
        .run();
    });
  });
  return { success: true, field: "module-reorder" };
}

export async function deleteCourseSection(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown,
  notifications: Notifications
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const { moduleId } = parseInput(
    z.object({ moduleId: identifier }),
    rawCommand
  );
  resolveCourse(db, courseId);
  resolveSection(db, courseId, moduleId);
  await requireCourseManagement(db, request, courseId);
  const commentIds = db.transaction((tx) => {
    const lessonIds = tx
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .all()
      .map((lesson) => lesson.id);
    const deletedComments = deleteLessons(tx, lessonIds);
    tx.delete(modules).where(eq(modules.id, moduleId)).run();
    return deletedComments;
  });
  for (const commentId of commentIds)
    await archiveForCommentSafely(notifications, commentId);
  return { success: true, field: "module" };
}
