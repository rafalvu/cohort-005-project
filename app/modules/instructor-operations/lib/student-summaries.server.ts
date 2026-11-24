import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  quizAttempts,
  quizzes,
  users,
} from "~/db/schema";
import type { Db } from "./targets.server";

export function getCourseEnrolledStudents(db: Db, courseId: number) {
  return db
    .select({
      enrollmentId: enrollments.id,
      userId: enrollments.userId,
      enrolledAt: enrollments.enrolledAt,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .all();
}

export function getCourseLessons(db: Db, courseId: number) {
  return db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all();
}

type StudentEnrollment = {
  userId: number;
  enrolledAt: string;
  completedAt: string | null;
};

export function getCourseStudentSummaries(
  db: Db,
  courseLessons: { id: number; title: string }[],
  enrolledStudents: StudentEnrollment[]
) {
  const lessonIds = courseLessons.map((lesson) => lesson.id);
  const lessonQuizzes = courseLessons.flatMap((lesson) => {
    const quiz = db
      .select()
      .from(quizzes)
      .where(eq(quizzes.lessonId, lesson.id))
      .get();
    return quiz
      ? [{ lessonTitle: lesson.title, quizId: quiz.id, quizTitle: quiz.title }]
      : [];
  });
  const students = enrolledStudents.map((enrollment) => {
    const student = db
      .select()
      .from(users)
      .where(eq(users.id, enrollment.userId))
      .get();
    const completedCount =
      lessonIds.length === 0
        ? 0
        : (db
            .select({ count: sql<number>`count(*)` })
            .from(lessonProgress)
            .where(
              and(
                eq(lessonProgress.userId, enrollment.userId),
                eq(lessonProgress.status, LessonProgressStatus.Completed),
                inArray(lessonProgress.lessonId, lessonIds)
              )
            )
            .get()?.count ?? 0);
    const progress =
      lessonIds.length === 0
        ? 0
        : Math.round((completedCount / lessonIds.length) * 100);
    const quizScores = lessonQuizzes.map((quiz) => {
      const bestAttempt = db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.userId, enrollment.userId),
            eq(quizAttempts.quizId, quiz.quizId)
          )
        )
        .orderBy(desc(quizAttempts.score))
        .limit(1)
        .get();
      return {
        quizId: quiz.quizId,
        quizTitle: quiz.quizTitle,
        lessonTitle: quiz.lessonTitle,
        bestScore: bestAttempt?.score ?? null,
        passed: bestAttempt?.passed ?? null,
      };
    });
    return {
      userId: enrollment.userId,
      name: student?.name ?? "Unknown",
      email: student?.email ?? "",
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      progress,
      quizScores,
    };
  });
  return { students, quizCount: lessonQuizzes.length };
}
