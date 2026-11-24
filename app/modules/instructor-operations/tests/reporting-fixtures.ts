import { setCurrentUserId } from "~/lib/session";

export async function reportingRequest(
  userId?: number,
  command?: Record<string, string> | URLSearchParams,
  search = ""
) {
  const request = new Request(`http://localhost/instructor${search}`);
  const headers =
    userId === undefined
      ? undefined
      : { Cookie: await setCurrentUserId(request, userId) };
  return new Request(request, {
    headers,
    ...(command
      ? {
          method: "POST",
          body:
            command instanceof URLSearchParams
              ? command
              : new URLSearchParams(command),
        }
      : {}),
  });
}

export function newCourseCommand(categoryId: number) {
  return {
    title: "New Instructor Course",
    description: "Learn the subject",
    salesCopy: "## Start here",
    categoryId: String(categoryId),
    coverImageUrl: "",
  };
}

import type { TestDb } from "~/test/setup";
import { purchases } from "~/db/schema";

export function recordPurchase(
  db: TestDb,
  userId: number,
  courseId: number,
  amountPaid: number
) {
  return db
    .insert(purchases)
    .values({
      userId,
      courseId,
      amountPaid,
      country: "US",
      createdAt: "2026-11-20T12:00:00.000Z",
    })
    .returning()
    .get();
}

import { createComment } from "~/lib/comments.server";
import type { Notifications } from "~/lib/notifications.server";
import { createLesson, getCurriculumSectionEditor } from "../lessons.server";
import { seedEditor, requestAs } from "./course-editor-fixtures";

export async function seedQuestions(
  db: TestDb,
  fixture: ReturnType<typeof seedEditor>,
  notifications: Notifications
) {
  const now = new Date("2026-11-24T12:00:00Z");
  const otherRequest = await requestAs(fixture.otherInstructor.id);
  await createLesson(db, otherRequest, fixture.otherCourse.id, {
    moduleId: fixture.otherSection.id,
    title: "Other lesson",
  });
  const section = await getCurriculumSectionEditor(
    db,
    otherRequest,
    fixture.otherCourse.id,
    fixture.otherSection.id
  );
  const otherLesson = section.module.lessons[0];
  if (!otherLesson) throw new Error("Other lesson was not created");
  const question = await createComment(
    db,
    fixture.user.id,
    fixture.lesson.id,
    null,
    "**My question** <script>alert(1)</script>",
    now,
    notifications
  );
  const otherQuestion = await createComment(
    db,
    fixture.user.id,
    otherLesson.id,
    null,
    "Other question",
    now,
    notifications
  );
  if (!question.ok || !otherQuestion.ok)
    throw new Error("Questions were not created");
  return { question: question.comment, otherQuestion: otherQuestion.comment };
}

import { courses, lessons, modules } from "~/db/schema";
import { eq } from "drizzle-orm";

export function removeQuestionAncestor(
  db: TestDb,
  fixture: ReturnType<typeof seedEditor>,
  ancestor: "lesson" | "section" | "course"
) {
  db.$client.pragma("foreign_keys = OFF");
  if (ancestor === "lesson")
    db.delete(lessons).where(eq(lessons.id, fixture.lesson.id)).run();
  if (ancestor === "section")
    db.delete(modules).where(eq(modules.id, fixture.section.id)).run();
  if (ancestor === "course")
    db.delete(courses).where(eq(courses.id, fixture.course.id)).run();
  db.$client.pragma("foreign_keys = ON");
}

export function transferCourse(
  db: TestDb,
  courseId: number,
  instructorId: number
) {
  db.update(courses)
    .set({ instructorId })
    .where(eq(courses.id, courseId))
    .run();
}
