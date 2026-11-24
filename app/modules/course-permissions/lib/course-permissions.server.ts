import { z } from "zod";
import { data } from "react-router";
import { and, eq, isNotNull, isNull, notExists } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import {
  coupons,
  courses,
  purchases,
  refunds,
  RefundStatus,
  users,
  UserRole,
} from "~/db/schema";
import { isEnrolled } from "~/lib/enrollments.server";
import {
  getCurrentPerson,
  requireCurrentPerson,
} from "~/lib/current-person.server";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";

type Db = BetterSQLite3Database<typeof schema>;
type Person = typeof users.$inferSelect;

export type CoursePermissions = {
  userId: number | null;
  user: Person | undefined;
  isAdmin: boolean;
  isOwningInstructor: boolean;
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  canViewContent: boolean;
  canParticipate: boolean;
};

const DENIED: CoursePermissions = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
  canParticipate: false,
};

export async function getCoursePermissions(
  db: Db,
  request: Request,
  courseId: number
): Promise<CoursePermissions> {
  const user = await getCurrentPerson(db, request);
  if (!user) return { ...DENIED };

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor =
    user.role === UserRole.Instructor && course?.instructorId === user.id;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = isEnrolled(db, user.id, courseId);
  let ppp: ReturnType<typeof checkPppAccess> = {
    blocked: false,
    blockedCountry: null,
    purchaseCountry: null,
  };
  if (enrolled && course) {
    const currentCountry = await resolveCountry(request);
    const approvedRefund = db
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.purchaseId, purchases.id),
          eq(refunds.status, RefundStatus.Approved)
        )
      );
    const evidence = db
      .select({ country: purchases.country })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, user.id),
          notExists(approvedRefund),
          eq(purchases.courseId, courseId),
          notExists(
            db
              .select({ id: coupons.id })
              .from(coupons)
              .where(eq(coupons.purchaseId, purchases.id))
          )
        )
      )
      .all();
    const claimedSeats = db
      .select({ country: purchases.country })
      .from(coupons)
      .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
      .where(
        and(
          eq(coupons.redeemedByUserId, user.id),
          notExists(approvedRefund),
          isNotNull(coupons.redeemedAt),
          isNull(coupons.refundedAt),
          eq(coupons.courseId, courseId),
          eq(purchases.courseId, courseId)
        )
      )
      .all();
    const checks = [...evidence, ...claimedSeats].map(({ country }) =>
      checkPppAccess(course.price, course.pppEnabled, country, currentCountry)
    );
    // ADR-0013 preserves Enrollment-only permission when no surviving evidence remains.
    const firstCheck = checks[0];
    if (firstCheck && checks.every((check) => check.blocked)) ppp = firstCheck;
  }
  const canParticipate = Boolean(course) && enrolled && !ppp.blocked;
  return {
    userId: user.id,
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: Boolean(course) && (isStaff || canParticipate),
    canParticipate,
  };
}

async function requireExistingCoursePermissions(
  db: Db,
  request: Request,
  courseId: number
) {
  await requireCurrentPerson(db, request);
  if (!z.number().int().positive().safeParse(courseId).success) {
    throw data("Invalid course identifier.", { status: 400 });
  }
  if (
    !db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get()
  ) {
    throw data("Course not found.", { status: 404 });
  }
  return getCoursePermissions(db, request, courseId);
}

export async function requireCourseManagement(
  db: Db,
  request: Request,
  courseId: number
) {
  const permissions = await requireExistingCoursePermissions(
    db,
    request,
    courseId
  );
  if (!permissions.isStaff) {
    throw data("Only this course's instructor can do that.", { status: 403 });
  }
  return permissions;
}

export async function requireInstructorOrAdmin(db: Db, request: Request) {
  const user = await requireCurrentPerson(db, request);
  if (user.role !== UserRole.Instructor && user.role !== UserRole.Admin) {
    throw data("Only instructors can access this page.", { status: 403 });
  }
  return { userId: user.id, user, isAdmin: user.role === UserRole.Admin };
}
