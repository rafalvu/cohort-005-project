import { and, eq, inArray, max } from "drizzle-orm";
import { lessonProgress, purchases } from "~/db/schema";
import { isLapsed } from "~/lib/enrollments";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { requireCourseManagement } from "~/modules/course-permissions/index.server";
import {
  identifier,
  parseInput,
  resolveCourse,
  type Db,
} from "./targets.server";

import {
  getCourseEnrolledStudents,
  getCourseLessons,
  getCourseStudentSummaries,
} from "./student-summaries.server";

// Students who lost their Enrollment keep their progress, so they still show
// on the roster. They have no Enrollment, so their purchase date stands in.
function getCourseLapsedStudents(
  db: Db,
  courseId: number,
  enrolledUserIds: number[],
  lessonIds: number[]
) {
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

export async function getStudentRoster(
  db: Db,
  request: Request,
  rawCourseId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const course = resolveCourse(db, courseId);
  await requireCourseManagement(db, request, courseId);
  const courseLessons = getCourseLessons(db, courseId);
  const enrolledStudents = getCourseEnrolledStudents(db, courseId);
  const lapsedStudents = getCourseLapsedStudents(
    db,
    courseId,
    enrolledStudents.map((student) => student.userId),
    courseLessons.map((lesson) => lesson.id)
  );
  const roster = [...enrolledStudents, ...lapsedStudents];
  const lapsedUserIds = new Set(
    roster.filter(isLapsed).map((student) => student.userId)
  );
  const { students, quizCount } = getCourseStudentSummaries(
    db,
    courseLessons,
    roster
  );
  return {
    course,
    students: students.map((student) => ({
      ...student,
      lapsed: lapsedUserIds.has(student.userId),
    })),
    quizCount,
  };
}
