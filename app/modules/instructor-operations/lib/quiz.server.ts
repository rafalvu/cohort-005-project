import { eq, inArray } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import {
  lessons,
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
  QuestionType,
} from "~/db/schema";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { requireCourseManagement } from "~/modules/course-permissions/index.server";
import {
  identifier,
  parseInput,
  resolveCourse,
  resolveSection,
  type Db,
} from "./targets.server";

function resolveTarget(db: Db, courseId: number, lessonId: number) {
  const course = resolveCourse(db, courseId);
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) throw data("Lesson not found.", { status: 404 });
  const section = resolveSection(db, courseId, lesson.moduleId);
  return { course, lesson, module: section };
}

export async function getQuizEditor(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawLessonId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const lessonId = parseInput(identifier, rawLessonId);
  const target = resolveTarget(db, courseId, lessonId);
  await requireCourseManagement(db, request, courseId);
  const quiz = db
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
  const existingQuiz = quiz
    ? {
        ...quiz,
        questions: db
          .select()
          .from(quizQuestions)
          .where(eq(quizQuestions.quizId, quiz.id))
          .orderBy(quizQuestions.position)
          .all()
          .map((question) => ({
            ...question,
            options: db
              .select()
              .from(quizOptions)
              .where(eq(quizOptions.questionId, question.id))
              .all(),
          })),
      }
    : null;
  return { ...target, existingQuiz };
}

const editorIdentifier = z
  .string()
  .refine((value) => {
    if (/^\d+$/.test(value)) return identifier.safeParse(value).success;
    return (
      /^new-[a-z0-9]{1,8}$/.test(value) ||
      /^(?=.*[a-z])[a-z0-9]{8}$/.test(value)
    );
  }, "Invalid quiz item identifier.")
  .transform((value) => (/^\d+$/.test(value) ? String(Number(value)) : value));

const quizQuestion = z
  .object({
    id: editorIdentifier,
    text: z.string().trim().min(1, "Question text is required."),
    type: z.nativeEnum(QuestionType),
    options: z
      .array(
        z
          .object({
            id: editorIdentifier,
            text: z.string().trim().min(1, "Option text is required."),
            isCorrect: z.boolean(),
          })
          .strict()
      )
      .min(2, "At least two options are required."),
  })
  .strict()
  .refine(
    (question) =>
      question.options.filter((option) => option.isCorrect).length === 1,
    "Each question must have exactly one correct answer."
  )
  .refine(
    (question) =>
      question.type !== QuestionType.TrueFalse || question.options.length === 2,
    "True/false questions must have two options."
  );

const quizContent = z
  .object({
    title: z.string().trim().min(1, "Quiz title is required."),
    passingScore: z.number().finite().min(0).max(100),
    questions: z.array(quizQuestion).min(1),
  })
  .strict()
  .refine(
    (content) =>
      new Set(content.questions.map((q) => q.id)).size ===
      content.questions.length,
    "Duplicate question identifiers."
  )
  .refine((content) => {
    const ids = content.questions.flatMap((question) =>
      question.options.map((option) => option.id)
    );
    return new Set(ids).size === ids.length;
  }, "Duplicate option identifiers.");

const quizCommand = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("save-quiz"),
      wizardData: z.string(),
      quizId: identifier.optional(),
    })
    .strict(),
  z
    .object({ intent: z.literal("delete-quiz"), quizId: identifier.optional() })
    .strict(),
]);

async function parseCommand(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw data("Invalid quiz form.", { status: 400 });
  }
  const fields = parseInput(
    z
      .array(z.tuple([z.string(), z.string()]))
      .refine(
        (entries) =>
          new Set(entries.map(([key]) => key)).size === entries.length,
        "Duplicate form fields."
      ),
    [...form.entries()]
  );
  const command = parseInput(quizCommand, Object.fromEntries(fields));
  if (command.intent === "delete-quiz") return { ...command, content: null };
  let content: unknown;
  try {
    content = JSON.parse(command.wizardData);
  } catch {
    throw data("Invalid quiz data.", { status: 400 });
  }
  return { ...command, content: parseInput(quizContent, content) };
}

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function deleteQuiz(tx: Transaction, quizId: number) {
  const attempts = tx
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, quizId));
  const questions = tx
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));
  tx.delete(quizAnswers).where(inArray(quizAnswers.attemptId, attempts)).run();
  tx.delete(quizAttempts).where(eq(quizAttempts.quizId, quizId)).run();
  tx.delete(quizOptions)
    .where(inArray(quizOptions.questionId, questions))
    .run();
  tx.delete(quizQuestions).where(eq(quizQuestions.quizId, quizId)).run();
  tx.delete(quizzes).where(eq(quizzes.id, quizId)).run();
}

function validateQuizItems(
  db: Db,
  quizId: number | undefined,
  content: z.infer<typeof quizContent>
) {
  for (const question of content.questions) {
    const questionId = /^\d+$/.test(question.id) ? Number(question.id) : null;
    if (questionId !== null) {
      const existing = db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.id, questionId))
        .get();
      if (!existing || existing.quizId !== quizId)
        throw data("Question not found in this quiz.", { status: 404 });
    }
    for (const option of question.options) {
      if (!/^\d+$/.test(option.id)) continue;
      const existing = db
        .select()
        .from(quizOptions)
        .where(eq(quizOptions.id, Number(option.id)))
        .get();
      if (!existing || existing.questionId !== questionId)
        throw data("Option not found in this question.", { status: 404 });
    }
  }
}

export async function updateQuizEditor(
  db: Db,
  request: Request,
  rawCourseId: unknown,
  rawLessonId: unknown
) {
  await requireCurrentPerson(db, request);
  const courseId = parseInput(identifier, rawCourseId);
  const lessonId = parseInput(identifier, rawLessonId);
  const command = await parseCommand(request);
  const { content } = command;
  resolveTarget(db, courseId, lessonId);
  const existingQuiz = db
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
  if (command.quizId !== undefined && existingQuiz?.id !== command.quizId)
    throw data("Quiz not found in this lesson.", { status: 404 });
  if (content) validateQuizItems(db, existingQuiz?.id, content);
  await requireCourseManagement(db, request, courseId);
  db.transaction((tx) => {
    if (existingQuiz) deleteQuiz(tx, existingQuiz.id);
    if (!content) return;
    const quiz = tx
      .insert(quizzes)
      .values({
        lessonId,
        title: content.title,
        passingScore: content.passingScore / 100,
      })
      .returning()
      .get();
    for (const [index, input] of content.questions.entries()) {
      const question = tx
        .insert(quizQuestions)
        .values({
          quizId: quiz.id,
          questionText: input.text,
          questionType: input.type,
          position: index + 1,
        })
        .returning()
        .get();
      for (const option of input.options) {
        tx.insert(quizOptions)
          .values({
            questionId: question.id,
            optionText: option.text,
            isCorrect: option.isCorrect,
          })
          .run();
      }
    }
  });
  return command.intent === "delete-quiz"
    ? { success: true, deleted: true }
    : { success: true };
}
