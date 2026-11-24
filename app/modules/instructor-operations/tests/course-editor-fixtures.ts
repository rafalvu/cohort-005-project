import { createComment } from "~/lib/comments.server";
import { saveNote } from "~/lib/notes.server";
import { toggleBookmark } from "~/lib/bookmarks.server";
import type { Notifications } from "~/lib/notifications.server";
import { eq } from "drizzle-orm";
import {
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

import { createInstructorCourse } from "../reporting.server";
import {
  createCourseSection,
  getCourseEditor,
  updateCourseSettings,
} from "../course-editor.server";
import { createLesson, getLessonEditor, updateLesson } from "../lessons.server";

export async function seedEditor(db: TestDb) {
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
  const request = await requestAs(base.instructor.id);
  const otherRequest = await requestAs(otherInstructor.id);
  const otherCourse = await createInstructorCourse(
    db,
    new Request(otherRequest, {
      method: "POST",
      body: new URLSearchParams({
        title: "Other course",
        description: base.course.description,
        salesCopy: base.course.salesCopy,
        categoryId: String(base.category.id),
      }),
    })
  );
  await updateCourseSettings(db, otherRequest, otherCourse.id, {
    intent: "update-status",
    status: base.course.status,
  });
  await createCourseSection(db, request, base.course.id, {
    title: "First section",
  });
  await createCourseSection(db, request, base.course.id, {
    title: "Second section",
  });
  await createCourseSection(db, otherRequest, otherCourse.id, {
    title: "Other section",
  });
  const { course } = await getCourseEditor(db, request, base.course.id);
  const [section, secondSection] = course.modules;
  const otherSection = (await getCourseEditor(db, otherRequest, otherCourse.id))
    .course.modules[0];
  if (!section || !secondSection || !otherSection)
    throw new Error("Curriculum sections were not created");
  await createLesson(db, request, course.id, {
    moduleId: section.id,
    title: "First lesson",
  });
  const createdLesson = (await getCourseEditor(db, request, course.id)).course
    .modules[0]?.lessons[0];
  if (!createdLesson) throw new Error("Lesson was not created");
  await updateLesson(db, request, course.id, createdLesson.id, {
    intent: "update-lesson",
    durationMinutes: "5",
  });
  const { lesson } = await getLessonEditor(
    db,
    request,
    course.id,
    createdLesson.id
  );
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
