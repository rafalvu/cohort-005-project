import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  notifications,
  purchases,
  refunds,
  users,
  UserRole,
  RefundStatus,
  coupons,
} from "~/db/schema";
import { listRefundRequestsForReview } from "~/lib/refunds.server";
import { persistentNotificationAccess } from "~/lib/notification-access.server";
import { getAccess } from "~/lib/access.server";

export async function resolveNotification(
  request: Request,
  row: typeof notifications.$inferSelect
) {
  const eligible = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, row.id), persistentNotificationAccess))
    .get();
  if (!eligible) return null;

  if (
    row.kind === "seat_claimed" &&
    row.teamId !== null &&
    row.seatId !== null
  ) {
    const seat = db
      .select()
      .from(coupons)
      .where(eq(coupons.id, row.seatId))
      .get();
    if (!seat) return null;
    return {
      type: "team" as const,
      teamId: row.teamId,
      seatId: seat.id,
      status: "claimed" as const,
      href: `/team?teamId=${row.teamId}`,
    };
  }
  if (row.refundRequestId !== null && row.purchaseId !== null) {
    const refundRequest = db
      .select()
      .from(refunds)
      .where(eq(refunds.id, row.refundRequestId))
      .get();
    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, row.purchaseId))
      .get();
    if (!refundRequest || !purchase) return null;
    if (row.kind === "refund_requested") {
      const review = listRefundRequestsForReview(
        db,
        refundRequest.status,
        new Date()
      ).find((item) => item.id === refundRequest.id);
      return {
        type: "refund-request" as const,
        refundRequestId: refundRequest.id,
        purchaseId: purchase.id,
        status: refundRequest.status,
        canDecide: refundRequest.status === RefundStatus.Open,
        canApprove: review?.canApprove ?? false,
        href: `/admin/refunds?refundRequestId=${refundRequest.id}`,
      };
    }
    return {
      type: "purchase" as const,
      purchaseId: purchase.id,
      refundRequestId: refundRequest.id,
      status: refundRequest.status,
      decisionNote: refundRequest.decisionNote,
      href: `/api/purchases/${purchase.id}?refundRequestId=${refundRequest.id}`,
    };
  }
  if (
    (row.kind !== "question_created" && row.kind !== "reply_created") ||
    row.questionId === null ||
    row.lessonId === null
  )
    return null;
  const question = db
    .select()
    .from(comments)
    .where(eq(comments.id, row.questionId))
    .get();
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, row.lessonId))
    .get();
  if (!question || !lesson) return null;
  const reply =
    row.replyId === null
      ? null
      : db.select().from(comments).where(eq(comments.id, row.replyId)).get();
  const module = db
    .select()
    .from(modules)
    .where(eq(modules.id, lesson.moduleId))
    .get();
  if (!module) return null;
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, module.courseId))
    .get();
  if (!course) return null;
  // Persistent eligibility is shared with cleanup; travel only hides history.
  const access = await getAccess(request, course.id);
  if (access.userId !== row.recipientId || access.pppBlocked) return null;
  const staffReply = db
    .select({ id: comments.id })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        eq(comments.parentId, question.id),
        isNull(comments.deletedAt),
        or(eq(users.role, UserRole.Admin), eq(users.id, course.instructorId))
      )
    )
    .get();
  return {
    status: question.deletedAt
      ? ("deleted" as const)
      : staffReply
        ? ("answered" as const)
        : ("unanswered" as const),
    type: "discussion" as const,
    questionId: question.id,
    lessonId: lesson.id,
    href: `/courses/${course.slug}/lessons/${lesson.id}?questionId=${question.id}`,
    body: question.deletedAt ? null : question.body,
    reply: reply ? { id: reply.id, body: reply.body } : null,
  };
}
