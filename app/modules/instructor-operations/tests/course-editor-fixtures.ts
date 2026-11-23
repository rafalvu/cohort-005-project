import { createComment } from "~/lib/comments.server";
import { saveNote } from "~/lib/notes.server";
import { toggleBookmark } from "~/lib/bookmarks.server";
import type { Notifications } from "~/lib/notifications.server";
import { eq } from "drizzle-orm";
import {
  courses,
  lessons,
  modules,
  users,
  UserRole,
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
  lessonProgress,
  LessonProgressStatus,
  videoWatchEvents,
  QuestionType,
} from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { seedBaseData, type TestDb } from "~/test/setup";

export function seedEditor(db: TestDb) {
  const base = seedBaseData(db);
  const admin = db
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "admin@test.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
  const otherInstructor = db
    .insert(users)
    .values({
      name: "Other Instructor",
      email: "other@test.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();
  const otherCourse = db
    .insert(courses)
    .values({
      ...base.course,
      id: undefined,
      slug: "other-course",
      instructorId: otherInstructor.id,
    })
    .returning()
    .get();
  const section = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "First section", position: 1 })
    .returning()
    .get();
  const secondSection = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "Second section", position: 2 })
    .returning()
    .get();
  const otherSection = db
    .insert(modules)
    .values({ courseId: otherCourse.id, title: "Other section", position: 1 })
    .returning()
    .get();
  const lesson = db
    .insert(lessons)
    .values({
      moduleId: section.id,
      title: "First lesson",
      position: 1,
      durationMinutes: 5,
    })
    .returning()
    .get();
  return {
    ...base,
    admin,
    otherInstructor,
    otherCourse,
    section,
    secondSection,
    otherSection,
    lesson,
  };
}

export async function requestAs(userId?: number) {
  const request = new Request("http://localhost/instructor/1");
  if (userId === undefined) return request;
  const cookie = await setCurrentUserId(request, userId);
  return new Request(request.url, { headers: { Cookie: cookie } });
}

export function demote(db: TestDb, userId: number) {
  db.update(users)
    .set({ role: UserRole.Student })
    .where(eq(users.id, userId))
    .run();
}

export async function populateLesson(
  db: TestDb,
  lessonId: number,
  studentId: number,
  notifications: Notifications
) {
  const now = new Date("2026-11-23T12:00:00Z");
  const quiz = db
    .insert(quizzes)
    .values({ lessonId, title: "Lesson quiz", passingScore: 0.7 })
    .returning()
    .get();
  const question = db
    .insert(quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: "Question",
      questionType: QuestionType.MultipleChoice,
      position: 1,
    })
    .returning()
    .get();
  const option = db
    .insert(quizOptions)
    .values({ questionId: question.id, optionText: "Answer", isCorrect: true })
    .returning()
    .get();
  const attempt = db
    .insert(quizAttempts)
    .values({ userId: studentId, quizId: quiz.id, score: 1, passed: true })
    .returning()
    .get();
  db.insert(quizAnswers)
    .values({
      attemptId: attempt.id,
      questionId: question.id,
      selectedOptionId: option.id,
    })
    .run();
  db.insert(lessonProgress)
    .values({
      userId: studentId,
      lessonId,
      status: LessonProgressStatus.Completed,
    })
    .run();
  db.insert(videoWatchEvents)
    .values({
      userId: studentId,
      lessonId,
      eventType: "pause",
      positionSeconds: 60,
    })
    .run();
  saveNote(db, studentId, lessonId, "Private note", now);
  toggleBookmark(db, studentId, lessonId, now);
  const questionComment = await createComment(
    db,
    studentId,
    lessonId,
    null,
    "Discussion question",
    now,
    notifications
  );
  if (!questionComment.ok) throw new Error(questionComment.error);
  await createComment(
    db,
    studentId,
    lessonId,
    questionComment.comment.id,
    "Discussion reply",
    now,
    notifications
  );
  return {
    quiz,
    question,
    option,
    attempt,
    questionComment: questionComment.comment,
  };
}
