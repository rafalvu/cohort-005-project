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
  teamMembers,
  TeamMemberRole,
} from "~/db/schema";
import { listRefundRequestsForReview } from "~/lib/refunds.server";
import { getAccess } from "~/lib/access.server";

export async function resolveNotification(
  request: Request,
  row: typeof notifications.$inferSelect
) {
  if (
    row.kind === "seat_claimed" &&
    row.teamId !== null &&
    row.seatId !== null
  ) {
    const membership = db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, row.teamId),
          eq(teamMembers.userId, row.recipientId),
          eq(teamMembers.role, TeamMemberRole.Admin)
        )
      )
      .get();
    const seat = db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, row.seatId), eq(coupons.teamId, row.teamId)))
      .get();
    if (!membership || !seat || !seat.redeemedAt) return null;
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
      .where(
        and(
          eq(refunds.id, row.refundRequestId),
          eq(refunds.purchaseId, row.purchaseId)
        )
      )
      .get();
    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, row.purchaseId))
      .get();
    if (!refundRequest || !purchase) return null;
    if (row.kind === "refund_requested") {
      const user = db
        .select()
        .from(users)
        .where(eq(users.id, row.recipientId))
        .get();
      if (user?.role !== UserRole.Admin) return null;
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
    if (purchase.userId !== row.recipientId) return null;
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
    .where(
      and(eq(comments.id, row.questionId), eq(comments.lessonId, row.lessonId))
    )
    .get();
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, row.lessonId))
    .get();
  if (
    !question ||
    (row.kind === "question_created" && question.deletedAt) ||
    question.parentId !== null ||
    !lesson
  )
    return null;
  const reply =
    row.replyId === null
      ? null
      : db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.id, row.replyId),
              eq(comments.parentId, question.id),
              eq(comments.lessonId, lesson.id)
            )
          )
          .get();
  if (row.kind === "reply_created" && (!reply || reply.deletedAt)) return null;
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
  if (!course || !(await getAccess(request, course.id)).canViewContent)
    return null;
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
