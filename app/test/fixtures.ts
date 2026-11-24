import { enrollStudentInTransaction } from "~/lib/enrollments.server";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { createTestDb } from "./setup";

type Db = ReturnType<typeof createTestDb>;

// Prerequisite records without service creation APIs belong here. Exercise
// Enrollment, Seat claims, Refunds, Bookmarks and Notes through their services.
export function fixturePerson(
  db: Db,
  values: typeof schema.users.$inferInsert
) {
  return db.insert(schema.users).values(values).returning().get();
}
export function fixtureCourse(
  db: Db,
  values: typeof schema.courses.$inferInsert
) {
  return db.insert(schema.courses).values(values).returning().get();
}
export function fixtureModule(
  db: Db,
  values: typeof schema.modules.$inferInsert
) {
  return db.insert(schema.modules).values(values).returning().get();
}
export function fixtureLesson(
  db: Db,
  values: typeof schema.lessons.$inferInsert
) {
  return db.insert(schema.lessons).values(values).returning().get();
}
export function fixturePurchase(
  db: Db,
  values: typeof schema.purchases.$inferInsert
) {
  return db.insert(schema.purchases).values(values).returning().get();
}
export function fixtureTeam(db: Db) {
  return db.insert(schema.teams).values({}).returning().get();
}
export function fixtureSeat(
  db: Db,
  values: typeof schema.coupons.$inferInsert
) {
  return db.insert(schema.coupons).values(values).returning().get();
}
export function fixtureLessonProgress(
  db: Db,
  values: (typeof schema.lessonProgress.$inferInsert)[]
) {
  db.insert(schema.lessonProgress).values(values).run();
}
export function fixtureWatchEvents(
  db: Db,
  values: (typeof schema.videoWatchEvents.$inferInsert)[]
) {
  db.insert(schema.videoWatchEvents).values(values).run();
}
export function fixtureCourseRating(
  db: Db,
  values: typeof schema.courseRatings.$inferInsert
) {
  return db.insert(schema.courseRatings).values(values).returning().get();
}
export function fixtureQuiz(
  db: Db,
  values: typeof schema.quizzes.$inferInsert
) {
  return db.insert(schema.quizzes).values(values).returning().get();
}
export function fixtureQuizAttempt(
  db: Db,
  values: typeof schema.quizAttempts.$inferInsert
) {
  return db.insert(schema.quizAttempts).values(values).returning().get();
}
export function fixtureCourseInstructor(
  db: Db,
  courseId: number,
  instructorId: number
) {
  db.update(schema.courses)
    .set({ instructorId })
    .where(eq(schema.courses.id, courseId))
    .run();
}

// Deliberately inconsistent historical data: a Seat claimed during an Open
// Refund Request. The current claim service correctly refuses this state.
export function fixtureLegacySeatClaim(
  db: Db,
  seatId: number,
  studentId: number,
  courseId: number,
  now: Date
) {
  const result = enrollStudentInTransaction(db, studentId, courseId, now);
  if (!result.ok) throw new Error(result.error);
  db.update(schema.coupons)
    .set({ redeemedByUserId: studentId, redeemedAt: now.toISOString() })
    .where(eq(schema.coupons.id, seatId))
    .run();
}
