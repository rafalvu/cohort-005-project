import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { markdown } from "~/lib/text";
import {
  archiveForCommentSafely,
  type Notifications,
} from "~/lib/notifications.server";
import { deleteLessons } from "./delete-lessons.server";
import { data } from "react-router";
import { lessons, quizzes, users } from "~/db/schema";
import {
  requireCurrentPerson,
  requireCourseManagement,
} from "~/modules/course-permissions/index.server";
import {
  identifier,
  orderedIdentifiers,
  parseInput,
  resolveCourse,
  resolveSection,
  type Db,
} from "./targets.server";

const title = z.string().trim().min(1, "Lesson title cannot be empty.");

function resolveLesson(db: Db, courseId: number, lessonId: number) {
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) throw data("Lesson not found.", { status: 404 });
  const section = resolveSection(db, courseId, lesson.moduleId);
  return { lesson, section };
}

export async function getLessonEditor(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawLessonId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const lessonId = parseInput(identifier, rawLessonId);
  const course = resolveCourse(db, courseId);
  const { lesson, section } = resolveLesson(db, courseId, lessonId);
  await requireCourseManagement(db, request, courseId);
  const quiz = db
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
  return { course, lesson, module: section, quiz };
}

export async function getCurriculumSectionEditor(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawSectionId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const sectionId = parseInput(identifier, rawSectionId);
  const course = resolveCourse(db, courseId);
  const section = resolveSection(db, courseId, sectionId);
  await requireCourseManagement(db, request, courseId);
  const instructor = db
    .select()
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();
  if (!instructor) throw data("Instructor not found.", { status: 404 });
  const sectionLessons = db
    .select()
    .from(lessons)
    .where(eq(lessons.moduleId, sectionId))
    .orderBy(lessons.position)
    .all();
  return {
    course: {
      id: course.id,
      title: course.title,
      slug: course.slug,
      instructorName: instructor.name,
      instructorAvatarUrl: instructor.avatarUrl,
      instructorBio: instructor.bio,
    },
    module: { ...section, lessons: sectionLessons },
    totalLessons: sectionLessons.length,
    totalDuration: sectionLessons.reduce(
      (sum, lesson) => sum + (lesson.durationMinutes ?? 0),
      0
    ),
  };
}

export async function createLesson(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(
    z.object({ moduleId: identifier, title }),
    rawCommand
  );
  resolveCourse(db, courseId);
  resolveSection(db, courseId, command.moduleId);
  await requireCourseManagement(db, request, courseId);
  db.transaction((tx) => {
    const last = tx
      .select({ position: sql<number>`coalesce(max(${lessons.position}), 0)` })
      .from(lessons)
      .where(eq(lessons.moduleId, command.moduleId))
      .get();
    tx.insert(lessons)
      .values({
        moduleId: command.moduleId,
        title: command.title,
        position: (last?.position ?? 0) + 1,
      })
      .run();
  });
  return { success: true, field: "lesson" };
}

export async function renameLesson(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(
    z.object({ lessonId: identifier, title }),
    rawCommand
  );
  resolveCourse(db, courseId);
  resolveLesson(db, courseId, command.lessonId);
  await requireCourseManagement(db, request, courseId);
  db.update(lessons)
    .set({ title: command.title })
    .where(eq(lessons.id, command.lessonId))
    .run();
  return { success: true, field: "lesson" };
}

const lessonUpdate = z.object({
  intent: z.literal("update-lesson"),
  title: title.optional(),
  content: z.string().optional(),
  videoUrl: z.string().trim().optional(),
  githubRepoUrl: z.string().trim().optional(),
  durationMinutes: z
    .union([
      z.literal("").transform(() => null),
      z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().nonnegative().safe()),
    ])
    .optional(),
});

export async function updateLesson(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawLessonId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const lessonId = parseInput(identifier, rawLessonId);
  const command = parseInput(lessonUpdate, rawCommand);
  resolveCourse(db, courseId);
  resolveLesson(db, courseId, lessonId);
  await requireCourseManagement(db, request, courseId);
  const updates: Partial<typeof lessons.$inferInsert> = {};
  if (command.title !== undefined) updates.title = command.title;
  if (command.content !== undefined)
    updates.content = markdown(command.content);
  if (command.videoUrl) updates.videoUrl = command.videoUrl;
  if (command.githubRepoUrl) updates.githubRepoUrl = command.githubRepoUrl;
  if (command.durationMinutes !== undefined && command.durationMinutes !== null)
    updates.durationMinutes = command.durationMinutes;
  if (Object.keys(updates).length > 0)
    db.update(lessons).set(updates).where(eq(lessons.id, lessonId)).run();
  return { success: true };
}

export async function reorderLessons(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(
    z.object({ moduleId: identifier, lessonIds: orderedIdentifiers }),
    rawCommand
  );
  resolveCourse(db, courseId);
  resolveSection(db, courseId, command.moduleId);
  for (const lessonId of command.lessonIds) {
    const { lesson } = resolveLesson(db, courseId, lessonId);
    if (lesson.moduleId !== command.moduleId)
      throw data("Lesson not found in this section.", { status: 404 });
  }
  const sectionLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.moduleId, command.moduleId))
    .all();
  if (sectionLessons.length !== command.lessonIds.length)
    throw data("Include every lesson exactly once.", { status: 400 });
  await requireCourseManagement(db, request, courseId);
  db.transaction((tx) => {
    command.lessonIds.forEach((lessonId, index) => {
      tx.update(lessons)
        .set({ position: index + 1 })
        .where(eq(lessons.id, lessonId))
        .run();
    });
  });
  return { success: true, field: "lesson-reorder" };
}

export async function moveLesson(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(
    z.object({
      lessonId: identifier,
      targetModuleId: identifier,
      targetPosition: identifier,
    }),
    rawCommand
  );
  resolveCourse(db, courseId);
  const { lesson } = resolveLesson(db, courseId, command.lessonId);
  resolveSection(db, courseId, command.targetModuleId);
  const sourceIds = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.moduleId, lesson.moduleId))
    .orderBy(lessons.position)
    .all()
    .map((row) => row.id)
    .filter((id) => id !== lesson.id);
  const targetIds =
    lesson.moduleId === command.targetModuleId
      ? sourceIds
      : db
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.moduleId, command.targetModuleId))
          .orderBy(lessons.position)
          .all()
          .map((row) => row.id);
  if (command.targetPosition > targetIds.length + 1)
    throw data("Invalid target position.", { status: 400 });
  await requireCourseManagement(db, request, courseId);
  targetIds.splice(command.targetPosition - 1, 0, lesson.id);
  db.transaction((tx) => {
    if (lesson.moduleId !== command.targetModuleId) {
      sourceIds.forEach((id, index) =>
        tx
          .update(lessons)
          .set({ position: index + 1 })
          .where(eq(lessons.id, id))
          .run()
      );
    }
    targetIds.forEach((id, index) =>
      tx
        .update(lessons)
        .set({ moduleId: command.targetModuleId, position: index + 1 })
        .where(eq(lessons.id, id))
        .run()
    );
  });
  return { success: true, field: "lesson-move" };
}

export async function deleteLesson(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawCommand: unknown,
  notifications: Notifications
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const command = parseInput(z.object({ lessonId: identifier }), rawCommand);
  resolveCourse(db, courseId);
  resolveLesson(db, courseId, command.lessonId);
  await requireCourseManagement(db, request, courseId);
  const commentIds = db.transaction((tx) =>
    deleteLessons(tx, [command.lessonId])
  );
  for (const commentId of commentIds)
    await archiveForCommentSafely(notifications, commentId);
  return { success: true, field: "lesson" };
}
