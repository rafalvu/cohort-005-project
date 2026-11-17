import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { data } from "react-router";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  enrollments,
  users,
  UserRole,
} from "~/db/schema";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";
import { createNotifications } from "~/lib/notifications.server";

export function createDiscussionComment(
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  operationId: string
) {
  const trimmed = body.trim();
  if (
    trimmed.length < MIN_COMMENT_LENGTH ||
    trimmed.length > MAX_COMMENT_LENGTH
  )
    throw data("Enter a valid comment.", { status: 400 });
  const operationFingerprint = createHash("sha256")
    .update(JSON.stringify([lessonId, parentId, trimmed]))
    .digest("hex");
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(comments)
      .where(
        and(eq(comments.userId, userId), eq(comments.operationId, operationId))
      )
      .get();
    if (existing) {
      if (existing.operationFingerprint !== operationFingerprint)
        throw data("This operation was already used for another comment.", {
          status: 409,
        });
      return existing;
    }
    const course = tx
      .select({ id: courses.id, instructorId: courses.instructorId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, lessonId))
      .get();
    if (!course) throw data("Lesson not found", { status: 404 });
    let question: typeof comments.$inferSelect | undefined;
    if (parentId !== null) {
      const parent = tx
        .select()
        .from(comments)
        .where(and(eq(comments.id, parentId), eq(comments.lessonId, lessonId)))
        .get();
      question = parent;
      if (!parent || parent.parentId !== null)
        throw data("Question not found", { status: 404 });
    }
    const comment = tx
      .insert(comments)
      .values({
        userId,
        lessonId,
        parentId,
        body: trimmed,
        operationId,
        operationFingerprint,
      })
      .returning()
      .get();
    if (
      process.env.CADENCE_NOTIFICATIONS_ENABLED === "true" &&
      parentId === null
    ) {
      const actor = tx.select().from(users).where(eq(users.id, userId)).get();
      const recipients = tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, UserRole.Admin))
        .all()
        .map((u) => u.id);
      if (actor?.role !== UserRole.Admin && userId !== course.instructorId)
        recipients.push(course.instructorId);
      createNotifications(
        tx,
        {
          sourceEventKey: `discussion:${comment.id}`,
          kind: "question_created",
          lessonId,
          questionId: comment.id,
        },
        recipients.filter((id) => id !== userId)
      );
    }
    if (
      process.env.CADENCE_NOTIFICATIONS_ENABLED === "true" &&
      question &&
      question.deletedAt === null
    ) {
      const participants = tx
        .select({ id: comments.userId })
        .from(comments)
        .where(
          or(eq(comments.id, question.id), eq(comments.parentId, question.id))
        )
        .all();
      const recipients = participants
        .filter(({ id }) => {
          if (id === userId) return false;
          const user = tx.select().from(users).where(eq(users.id, id)).get();
          // Country belongs to the recipient's later read request, never this actor.
          return (
            user?.role === UserRole.Admin ||
            id === course.instructorId ||
            !!tx
              .select()
              .from(enrollments)
              .where(
                and(
                  eq(enrollments.userId, id),
                  eq(enrollments.courseId, course.id)
                )
              )
              .get()
          );
        })
        .map((p) => p.id);
      createNotifications(
        tx,
        {
          sourceEventKey: `discussion:${comment.id}`,
          kind: "reply_created",
          lessonId,
          questionId: question.id,
          replyId: comment.id,
        },
        recipients
      );
    }
    return comment;
  });
}
