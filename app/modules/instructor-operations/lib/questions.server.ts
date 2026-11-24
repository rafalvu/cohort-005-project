import { data } from "react-router";
import { z } from "zod";
import { readCommand } from "./reporting-command.server";
import { createComment } from "~/lib/comments.server";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";
import type { Notifications } from "~/lib/notifications.server";
import { eq, ne, or, and, isNull, notExists, sql, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { requireCurrentPerson } from "~/lib/current-person.server";
import {
  requireInstructorOrAdmin,
  requireCourseManagement,
} from "~/modules/course-permissions/index.server";
import { renderComment } from "~/lib/comment-markdown.server";
import type { Markdown } from "~/lib/text";
import { identifier, parseInput, type Db } from "./targets.server";

type QueuedQuestion = {
  id: number;
  body: Markdown;
  createdAt: string;
  lessonId: number;
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string | null;
};

function getUnansweredQuestions(
  db: Db,
  instructorId: number | null
): QueuedQuestion[] {
  const author = alias(users, "author");
  const reply = alias(comments, "reply");
  const replyAuthor = alias(users, "reply_author");

  // Correlated: matches a live reply, by staff, to the outer question.
  const staffReply = db
    .select({ one: sql`1` })
    .from(reply)
    .innerJoin(replyAuthor, eq(replyAuthor.id, reply.userId))
    .where(
      and(
        eq(reply.parentId, comments.id),
        isNull(reply.deletedAt),
        or(
          eq(replyAuthor.role, UserRole.Admin),
          eq(reply.userId, courses.instructorId)
        )
      )
    );

  const conditions = [
    isNull(comments.parentId),
    isNull(comments.deletedAt),
    // Staff asking their own question shouldn't queue up as work for themselves.
    ne(author.role, UserRole.Admin),
    ne(comments.userId, courses.instructorId),
    notExists(staffReply),
  ];

  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      authorId: author.id,
      authorName: author.name,
      authorAvatarUrl: author.avatarUrl,
    })
    .from(comments)
    .innerJoin(author, eq(comments.userId, author.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .all();
}

export async function getInstructorQuestions(db: Db, request: Request) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(db, request);
  const questions = getUnansweredQuestions(db, isAdmin ? null : userId);
  return {
    questions: await Promise.all(
      questions.map(async (question) => ({
        ...question,
        bodyHtml: await renderComment(question.body),
      }))
    ),
    isAdmin,
  };
}

const replySchema = z.object({
  intent: z.literal("reply"),
  commentId: identifier,
  body: z.string().trim().min(MIN_COMMENT_LENGTH).max(MAX_COMMENT_LENGTH),
});

export async function replyToDiscussionQuestion(
  db: Db,
  request: Request,
  notifications: Notifications,
  now = new Date()
) {
  const person = await requireCurrentPerson(db, request);
  const command = parseInput(replySchema, await readCommand(request));
  const question = db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      lessonId: lessons.id,
      courseId: courses.id,
    })
    .from(comments)
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(comments.id, command.commentId))
    .get();
  if (!question || question.parentId !== null)
    throw data("Discussion Question not found.", { status: 404 });
  await requireCourseManagement(db, request, question.courseId);
  const created = await createComment(
    db,
    person.id,
    question.lessonId,
    question.id,
    command.body,
    now,
    notifications
  );
  if (!created.ok) throw data(created.error, { status: 400 });
  return { ok: true };
}
