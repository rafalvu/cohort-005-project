import { eq } from "drizzle-orm";
import { comments } from "~/db/schema";
import { data } from "react-router";
import { z } from "zod";
import {
  createComment,
  editComment,
  deleteComment,
} from "~/lib/comments.server";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type { Notifications } from "~/lib/notifications.server";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { getCoursePermissions } from "~/modules/course-permissions/index.server";
import {
  positiveIdSchema,
  resolveLessonTarget,
  type LessonDatabase,
} from "./targets.server";

const bodySchema = z
  .string()
  .trim()
  .min(MIN_COMMENT_LENGTH)
  .max(MAX_COMMENT_LENGTH);
const commandSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("create-comment"),
      body: bodySchema,
      parentId: positiveIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("edit-comment"),
      commentId: positiveIdSchema,
      body: bodySchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("delete-comment"),
      commentId: positiveIdSchema,
    })
    .strict(),
]);

function resolveComment(
  db: LessonDatabase,
  commentId: number,
  lessonId: number
) {
  const comment = db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
  if (!comment || comment.lessonId !== lessonId)
    throw data("Comment not found in this lesson", { status: 404 });
  return comment;
}

export async function updateLessonDiscussion(
  db: LessonDatabase,
  request: Request,
  input: unknown,
  form: FormData,
  notifications: Notifications
) {
  const person = await requireCurrentPerson(db, request);
  const parsed = commandSchema.safeParse(Object.fromEntries(form));
  if (
    !parsed.success ||
    [...form.keys()].some((key) => form.getAll(key).length !== 1)
  ) {
    throw data("Invalid discussion command", { status: 400 });
  }
  const { course, lesson } = resolveLessonTarget(db, input);
  const command = parsed.data;
  const existing =
    command.intent !== "create-comment"
      ? resolveComment(db, command.commentId, lesson.id)
      : undefined;
  const parentId =
    command.intent === "create-comment" ? command.parentId : existing?.parentId;
  if (parentId !== undefined && parentId !== null) {
    const parent = resolveComment(db, parentId, lesson.id);
    if (parent.parentId !== null)
      throw data("Discussion Question not found in this lesson", {
        status: 404,
      });
  }
  if (command.intent === "edit-comment" && existing?.deletedAt !== null)
    throw data("Comment not found", { status: 404 });
  const permission = await getCoursePermissions(db, request, course.id);
  if (!permission.canViewContent)
    throw data("Course permission is required", { status: 403 });
  if (command.intent === "edit-comment") {
    if (existing?.userId !== person.id)
      throw data("You can only edit your own comments", { status: 403 });
    const result = editComment(
      db,
      command.commentId,
      person.id,
      command.body,
      new Date()
    );
    if (!result.ok) throw data(result.error, { status: 400 });
  } else if (command.intent === "delete-comment") {
    if (existing?.userId !== person.id && !permission.isStaff)
      throw data("You can only delete your own comments", { status: 403 });
    const result = await deleteComment(
      db,
      command.commentId,
      person.id,
      permission.isStaff,
      new Date(),
      notifications
    );
    if (!result.ok) throw data(result.error, { status: 400 });
  } else {
    const result = await createComment(
      db,
      person.id,
      lesson.id,
      command.parentId ?? null,
      command.body,
      new Date(),
      notifications
    );
    if (!result.ok) throw data(result.error, { status: 400 });
  }
  return { ok: true };
}
