import { and, asc, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { data } from "react-router";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  quizAnswers,
  quizAttempts,
  quizzes,
  refundProgressArchives,
  refunds,
  RefundStatus,
  LessonProgressStatus,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { requireAdmin } from "~/lib/access.server";

export function getLatestIndividualPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          db
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.purchaseId, purchases.id))
        )
      )
    )
    .orderBy(desc(purchases.id))
    .get();
}

export function getRefundForPurchase(purchaseId: number) {
  return db
    .select()
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();
}

export function getRefundProgress(userId: number, courseId: number) {
  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all();
  const ids = courseLessons.map((lesson) => lesson.id);
  if (!ids.length)
    return {
      completedLessons: 0,
      totalLessons: 0,
      percentage: 0,
      videoSeconds: 0,
    };
  const completed = db
    .select({ count: sql<number>`count(distinct ${lessonProgress.lessonId})` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        inArray(lessonProgress.lessonId, ids),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .get()!.count;
  const positions = db
    .select({ seconds: sql<number>`max(${videoWatchEvents.positionSeconds})` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, ids)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();
  return {
    completedLessons: completed,
    totalLessons: ids.length,
    percentage: Math.round((completed / ids.length) * 100),
    videoSeconds: positions.reduce((sum, row) => sum + row.seconds, 0),
  };
}

export async function listRefundRequests(request: Request) {
  await requireAdmin(request);
  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      resolvedByUserId: refunds.resolvedByUserId,
      amountApproved: refunds.amountApproved,
      userId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      notExists(
        db
          .select({ id: coupons.id })
          .from(coupons)
          .where(eq(coupons.purchaseId, purchases.id))
      )
    )
    .orderBy(asc(refunds.requestedAt), asc(refunds.id))
    .all();
  return rows.map((row) => ({
    ...row,
    progress:
      row.status === RefundStatus.Requested
        ? getRefundProgress(row.userId, row.courseId)
        : null,
    resolvedByName: row.resolvedByUserId
      ? (db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, row.resolvedByUserId))
          .get()?.name ?? "Unknown admin")
      : null,
  }));
}

export async function resolveRefund(
  request: Request,
  refundId: number,
  decision: "approve" | "decline"
) {
  const admin = await requireAdmin(request);
  if (decision !== "approve" && decision !== "decline")
    throw data("Invalid decision.", { status: 400 });
  return db.transaction((tx) => {
    const refund = tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .get();
    if (!refund) throw data("Refund request not found.", { status: 404 });
    if (refund.status !== RefundStatus.Requested)
      throw data(
        "This refund request has already been resolved. Refresh the page.",
        { status: 409 }
      );
    const purchase = tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, refund.purchaseId))
      .get()!;
    if (
      tx.select().from(coupons).where(eq(coupons.purchaseId, purchase.id)).get()
    ) {
      throw data("Team purchases are not supported by this refund flow.", {
        status: 403,
      });
    }
    const resolvedAt = new Date().toISOString();
    if (decision === "approve") {
      const lessonIds = tx
        .select({ id: lessons.id })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .where(eq(modules.courseId, purchase.courseId))
        .all()
        .map((lesson) => lesson.id);
      const progressWhere = and(
        eq(lessonProgress.userId, purchase.userId),
        inArray(lessonProgress.lessonId, lessonIds)
      );
      const watchWhere = and(
        eq(videoWatchEvents.userId, purchase.userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      );
      const quizIds = tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(inArray(quizzes.lessonId, lessonIds))
        .all()
        .map((quiz) => quiz.id);
      const attemptsWhere = and(
        eq(quizAttempts.userId, purchase.userId),
        inArray(quizAttempts.quizId, quizIds)
      );
      const attempts = tx
        .select()
        .from(quizAttempts)
        .where(attemptsWhere)
        .all();
      const answersWhere = inArray(
        quizAnswers.attemptId,
        attempts.map((attempt) => attempt.id)
      );
      const enrollmentWhere = and(
        eq(enrollments.userId, purchase.userId),
        eq(enrollments.courseId, purchase.courseId)
      );
      const snapshot = {
        version: 1,
        userId: purchase.userId,
        courseId: purchase.courseId,
        lessonProgress: tx
          .select()
          .from(lessonProgress)
          .where(progressWhere)
          .all(),
        quizAttempts: attempts,
        quizAnswers: tx.select().from(quizAnswers).where(answersWhere).all(),
        videoWatchEvents: tx
          .select()
          .from(videoWatchEvents)
          .where(watchWhere)
          .all(),
        enrollments: tx.select().from(enrollments).where(enrollmentWhere).all(),
      };
      tx.insert(refundProgressArchives)
        .values({
          refundId,
          snapshot: JSON.stringify(snapshot),
          archivedAt: resolvedAt,
        })
        .run();
      tx.delete(quizAnswers).where(answersWhere).run();
      tx.delete(quizAttempts).where(attemptsWhere).run();
      tx.delete(lessonProgress).where(progressWhere).run();
      tx.delete(videoWatchEvents).where(watchWhere).run();
      tx.delete(enrollments).where(enrollmentWhere).run();
    }
    return tx
      .update(refunds)
      .set({
        status:
          decision === "approve"
            ? RefundStatus.Approved
            : RefundStatus.Declined,
        amountApproved: decision === "approve" ? purchase.amountPaid : null,
        resolvedAt,
        resolvedByUserId: admin.id,
      })
      .where(
        and(
          eq(refunds.id, refundId),
          eq(refunds.status, RefundStatus.Requested)
        )
      )
      .returning()
      .get()!;
  });
}
