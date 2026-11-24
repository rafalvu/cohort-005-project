import { and, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { pageOf, PAGE_SIZE } from "~/lib/pagination";

type Student = {
  userId: number;
  name: string;
  email: string;
  enrolledAt: string;
  completedAt: string | null;
  active: number;
};
export function studentRoster(
  db: BetterSQLite3Database<typeof schema>,
  courseId: number,
  page: number
) {
  // Former students appear only if a purchase and retained progress both exist.
  const rows = db.all<Student>(sql`
    WITH roster AS (
      SELECT user_id, enrolled_at, completed_at, 1 AS active FROM enrollments WHERE course_id = ${courseId}
      UNION ALL
      SELECT p.user_id, max(p.created_at), NULL, 0 FROM purchases p WHERE p.course_id = ${courseId}
        AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = p.course_id AND e.user_id = p.user_id)
        AND EXISTS (SELECT 1 FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
                    JOIN modules m ON m.id = l.module_id WHERE m.course_id = p.course_id AND lp.user_id = p.user_id)
      GROUP BY p.user_id
    )
    SELECT r.user_id AS userId, u.name, u.email, r.enrolled_at AS enrolledAt, r.completed_at AS completedAt, r.active
    FROM roster r JOIN users u ON u.id = r.user_id
    ORDER BY r.active DESC, r.user_id LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
  `);
  const { items, hasNext } = pageOf(rows);
  const ids = items.map((row) => row.userId);
  const { lessons, modules, quizzes, lessonProgress, quizAttempts } = schema;
  const courseLessons = db
    .select({
      id: lessons.id,
      title: lessons.title,
      quizId: quizzes.id,
      quizTitle: quizzes.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .leftJoin(quizzes, eq(quizzes.lessonId, lessons.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position, quizzes.id)
    .all();
  const lessonIds = [...new Set(courseLessons.map((l) => l.id))];
  const courseQuizzes = courseLessons.flatMap((l) =>
    l.quizId === null || l.quizTitle === null
      ? []
      : [{ quizId: l.quizId, quizTitle: l.quizTitle, lessonTitle: l.title }]
  );
  const progress = db
    .select({ userId: lessonProgress.userId, count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        inArray(lessonProgress.userId, ids),
        inArray(lessonProgress.lessonId, lessonIds),
        eq(lessonProgress.status, schema.LessonProgressStatus.Completed)
      )
    )
    .groupBy(lessonProgress.userId)
    .all();
  const completed = new Map(progress.map((p) => [p.userId, p.count]));
  const attempts = db.all<{
    userId: number;
    quizId: number;
    score: number;
    passed: number;
  }>(sql`
    SELECT userId,quizId,score,passed FROM (
      SELECT ${quizAttempts.userId} AS userId, ${quizAttempts.quizId} AS quizId, score, passed,
        row_number() OVER (PARTITION BY user_id, quiz_id ORDER BY score DESC, id ASC) AS rank
      FROM ${quizAttempts} WHERE ${inArray(quizAttempts.userId, ids)} AND ${inArray(
        quizAttempts.quizId,
        courseQuizzes.map((q) => q.quizId)
      )}
    ) WHERE rank = 1`);
  const best = new Map(attempts.map((a) => [`${a.userId}:${a.quizId}`, a]));
  return {
    page,
    hasNext,
    quizCount: courseQuizzes.length,
    students: items.map(({ active, ...student }) => ({
      ...student,
      lapsed: !active,
      progress: lessonIds.length
        ? Math.round(
            (100 * (completed.get(student.userId) ?? 0)) / lessonIds.length
          )
        : 0,
      quizScores: courseQuizzes.map((q) => {
        const attempt = best.get(`${student.userId}:${q.quizId}`);
        return {
          ...q,
          bestScore: attempt?.score ?? null,
          passed: attempt ? Boolean(attempt.passed) : null,
        };
      }),
    })),
  };
}
