import { and, eq, sql, desc, inArray, max } from "drizzle-orm";
import {
  modules,
  lessons,
  users,
  enrollments,
  quizzes,
  quizAttempts,
  lessonProgress,
  purchases,
  LessonProgressStatus,
} from "~/db/schema";
import { isLapsed } from "~/lib/enrollments";
import {
  requireCurrentPerson,
  requireCourseManagement,
} from "~/modules/course-permissions/index.server";
import {
  identifier,
  parseInput,
  resolveCourse,
  type Db,
} from "./targets.server";

function getUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getCourseEnrolledStudents(db: Db, courseId: number) {
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

// Students who lost their Enrollment keep their progress, so they still show
// on the roster. They have no Enrollment, so their purchase date stands in.
function getCourseLapsedStudents(
  db: Db,
  courseId: number,
  enrolledUserIds: number[]
) {
  const lessonIds = getCourseLessonIds(db, courseId);
  if (lessonIds.length === 0) return [];

  const withProgress = db
    .selectDistinct({ userId: lessonProgress.userId })
    .from(lessonProgress)
    .where(inArray(lessonProgress.lessonId, lessonIds))
    .all()
    .map((row) => row.userId)
    .filter((userId) => !enrolledUserIds.includes(userId));

  if (withProgress.length === 0) return [];

  return db
    .select({
      userId: purchases.userId,
      enrolledAt: max(purchases.createdAt),
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.courseId, courseId),
        inArray(purchases.userId, withProgress)
      )
    )
    .groupBy(purchases.userId)
    .all()
    .map((row) => ({
      enrollmentId: null,
      userId: row.userId,
      enrolledAt: row.enrolledAt ?? "",
      completedAt: null,
    }));
}

function getQuizByLessonId(db: Db, lessonId: number) {
  return db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId)).get();
}

function getBestAttempt(db: Db, userId: number, quizId: number) {
  return db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}

function getCourseLessonIds(db: Db, courseId: number): number[] {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return [];

  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      inArray(
        lessons.moduleId,
        courseModules.map((m) => m.id)
      )
    )
    .all();

  return courseLessons.map((l) => l.id);
}

function calculateProgress(
  db: Db,
  userId: number,
  courseId: number,
  weightByDuration: boolean
) {
  const lessonIds = getCourseLessonIds(db, courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(inArray(lessons.id, lessonIds))
      .all();

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .all();

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const completedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return Math.round(((completedCount?.count ?? 0) / lessonIds.length) * 100);
}

export async function getStudentRoster(
  db: Db,
  request: Request,
  rawCourseId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const course = resolveCourse(db, courseId);
  await requireCourseManagement(db, request, courseId);
  // Get all enrolled students
  const enrolledStudents: {
    enrollmentId: number | null;
    userId: number;
    enrolledAt: string;
    completedAt: string | null;
  }[] = getCourseEnrolledStudents(db, courseId);
  enrolledStudents.push(
    ...getCourseLapsedStudents(
      db,
      courseId,
      enrolledStudents.map((s) => s.userId)
    )
  );

  // Get all lessons with quizzes for this course
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  // Get all lessons across all modules
  const allCourseLessons: { id: number; title: string }[] = [];
  for (const mod of courseModules) {
    const modLessons = db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .where(eq(lessons.moduleId, mod.id))
      .all();
    allCourseLessons.push(...modLessons);
  }

  // Find which lessons have quizzes
  const lessonQuizzes: {
    lessonId: number;
    lessonTitle: string;
    quizId: number;
    quizTitle: string;
  }[] = [];
  for (const lesson of allCourseLessons) {
    const quiz = getQuizByLessonId(db, lesson.id);
    if (quiz) {
      lessonQuizzes.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        quizId: quiz.id,
        quizTitle: quiz.title,
      });
    }
  }

  // Build student data with progress and quiz scores
  const students = enrolledStudents.map((enrollment) => {
    const studentUser = getUserById(db, enrollment.userId);
    const progress = calculateProgress(db, enrollment.userId, courseId, false);

    // Get best quiz attempt for each quiz in this course
    const quizScores = lessonQuizzes.map((lq) => {
      const bestAttempt = getBestAttempt(db, enrollment.userId, lq.quizId);
      return {
        quizId: lq.quizId,
        quizTitle: lq.quizTitle,
        lessonTitle: lq.lessonTitle,
        bestScore: bestAttempt?.score ?? null,
        passed: bestAttempt?.passed ?? null,
      };
    });

    return {
      userId: enrollment.userId,
      name: studentUser?.name ?? "Unknown",
      email: studentUser?.email ?? "",
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      lapsed: isLapsed(enrollment),
      progress,
      quizScores,
    };
  });

  return { course, students, quizCount: lessonQuizzes.length };
}
