import { QuestionType } from "~/db/schema";
import { requestAs } from "./course-editor-fixtures";
import {
  getQuizEditor,
  updateQuizEditor,
} from "~/modules/instructor-operations/quiz.server";
import { submitQuiz } from "~/modules/lesson-operations/quizzes.server";
import { enrollStudent } from "~/lib/enrollments.server";
import type { Notifications } from "~/lib/notifications.server";
import type { TestDb } from "~/test/setup";
import { createLesson } from "~/modules/instructor-operations/lessons.server";
import { getCourseEditor } from "~/modules/instructor-operations/course-editor.server";

export function quizContent() {
  return {
    title: "  Course assessment  ",
    passingScore: 80,
    questions: [
      {
        id: "new-a1b2c3d4",
        text: "  Which answer is correct?  ",
        type: QuestionType.MultipleChoice,
        options: [
          { id: "new-b1b2c3d4", text: "  First  ", isCorrect: false },
          { id: "new-c1b2c3d4", text: "  Second  ", isCorrect: true },
        ],
      },
      {
        id: "new-d1b2c3d4",
        text: "  This is false.  ",
        type: QuestionType.TrueFalse,
        options: [
          { id: "new-e1b2c3d4", text: "True", isCorrect: false },
          { id: "new-f1b2c3d4", text: "False", isCorrect: true },
        ],
      },
    ],
  };
}

export async function quizRequest(
  userId: number | undefined,
  fields: Record<string, string | undefined>
) {
  return new Request(await requestAs(userId), {
    method: "POST",
    body: new URLSearchParams(
      Object.entries(fields).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
  });
}

export function saveRequest(
  userId: number | undefined,
  content: unknown = quizContent(),
  quizId?: number
) {
  return quizRequest(userId, {
    intent: "save-quiz",
    wizardData: JSON.stringify(content),
    ...(quizId === undefined ? {} : { quizId: String(quizId) }),
  });
}

export async function createQuiz(
  db: TestDb,
  instructorId: number,
  courseId: number,
  lessonId: number
) {
  await updateQuizEditor(
    db,
    await saveRequest(instructorId),
    courseId,
    lessonId
  );
  const { existingQuiz } = await getQuizEditor(
    db,
    await requestAs(instructorId),
    courseId,
    lessonId
  );
  if (!existingQuiz) throw new Error("Expected the saved quiz");
  return existingQuiz;
}

export async function createQuizLesson(
  db: TestDb,
  instructorId: number,
  courseId: number,
  sectionId: number
) {
  const request = await requestAs(instructorId);
  await createLesson(db, request, courseId, {
    moduleId: sectionId,
    title: "Another quiz lesson",
  });
  const editor = await getCourseEditor(db, request, courseId);
  const lesson = editor.course.modules
    .find((section) => section.id === sectionId)
    ?.lessons.at(-1);
  if (!lesson) throw new Error("Expected the created lesson");
  return createQuiz(db, instructorId, courseId, lesson.id);
}

export function editableQuiz(
  quiz: NonNullable<Awaited<ReturnType<typeof getQuizEditor>>["existingQuiz"]>
) {
  return {
    title: quiz.title,
    passingScore: quiz.passingScore * 100,
    questions: quiz.questions.map((question) => ({
      id: String(question.id),
      text: question.questionText,
      type: question.questionType,
      options: question.options.map((option) => ({
        id: String(option.id),
        text: option.optionText,
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

export async function addAttempt(
  db: TestDb,
  studentId: number,
  course: { id: number; slug: string },
  quiz: Awaited<ReturnType<typeof createQuiz>>,
  notifications: Notifications
) {
  await enrollStudent(
    db,
    studentId,
    course.id,
    new Date("2026-11-24T12:00:00Z"),
    notifications
  );
  const form = new FormData();
  form.set("intent", "submit-quiz");
  form.set("quizId", String(quiz.id));
  for (const question of quiz.questions) {
    const option = question.options.find((candidate) => candidate.isCorrect);
    if (!option) throw new Error("Expected correct answer");
    form.set(`question-${question.id}`, String(option.id));
  }
  return submitQuiz(
    db,
    await requestAs(studentId),
    { slug: course.slug, lessonId: quiz.lessonId },
    form
  );
}
