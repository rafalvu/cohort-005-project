import { eq } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import {
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
} from "~/db/schema";
import {
  getCoursePermissions,
  requireCurrentPerson,
} from "~/modules/course-permissions/index.server";
import {
  positiveIdSchema,
  resolveLessonTarget,
  type LessonDatabase,
} from "./targets.server";

const submissionSchema = z.object({
  intent: z.literal("submit-quiz"),
  quizId: positiveIdSchema,
  answers: z.array(
    z.object({ questionId: positiveIdSchema, optionId: positiveIdSchema })
  ),
});

const formFieldsSchema = z
  .array(
    z.tuple([
      z.string().regex(/^(intent|quizId|question-[1-9]\d*)$/),
      z.string(),
    ])
  )
  .refine(
    (fields) => new Set(fields.map(([key]) => key)).size === fields.length
  );

function parseSubmission(formData: FormData) {
  const fields = formFieldsSchema.safeParse([...formData.entries()]);
  if (!fields.success) throw data("Invalid quiz submission", { status: 400 });
  const answers = [];
  for (const [key, value] of fields.data) {
    if (key.startsWith("question-"))
      answers.push({
        questionId: key.slice("question-".length),
        optionId: value,
      });
  }
  const parsed = submissionSchema.safeParse({
    intent: formData.get("intent"),
    quizId: formData.get("quizId"),
    answers,
  });
  if (!parsed.success) throw data("Invalid quiz submission", { status: 400 });
  return parsed.data;
}

function gradeFor(score: number) {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export async function submitQuiz(
  db: LessonDatabase,
  request: Request,
  input: unknown,
  formData: FormData
) {
  const person = await requireCurrentPerson(db, request);
  const submission = parseSubmission(formData);
  const { course, lesson } = resolveLessonTarget(db, input);
  const quiz = db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, submission.quizId))
    .get();
  if (!quiz || quiz.lessonId !== lesson.id)
    throw data("Quiz not found", { status: 404 });
  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(quizQuestions.position, quizQuestions.id)
    .all();
  for (const answer of submission.answers) {
    if (!questions.some((question) => question.id === answer.questionId))
      throw data("Question not found in this quiz", { status: 404 });
    const option = db
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.id, answer.optionId))
      .get();
    if (!option || option.questionId !== answer.questionId)
      throw data("Option not found in this question", { status: 404 });
  }
  const permission = await getCoursePermissions(db, request, course.id);
  if (!permission.canParticipate)
    throw data("Enrollment and country qualification are required", {
      status: 403,
    });
  const answers = new Map(
    submission.answers.map((answer) => [answer.questionId, answer.optionId])
  );
  const questionResults = questions.map((question) => {
    const selectedOptionId = answers.get(question.id) ?? null;
    const correctOptionId =
      selectedOptionId === null
        ? null
        : (db
            .select()
            .from(quizOptions)
            .where(eq(quizOptions.questionId, question.id))
            .all()
            .find((option) => option.isCorrect)?.id ?? null);
    return {
      questionId: question.id,
      correct:
        selectedOptionId !== null && selectedOptionId === correctOptionId,
      selectedOptionId,
      correctOptionId,
    };
  });
  const totalCorrect = questionResults.filter(
    (answer) => answer.correct
  ).length;
  const totalQuestions = questions.length;
  const score = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
  const passed = score > 0.7;
  return db.transaction((tx) => {
    const attempt = tx
      .insert(quizAttempts)
      .values({ userId: person.id, quizId: quiz.id, score, passed })
      .returning()
      .get();
    for (const result of questionResults) {
      if (result.selectedOptionId !== null)
        tx.insert(quizAnswers)
          .values({
            attemptId: attempt.id,
            questionId: result.questionId,
            selectedOptionId: result.selectedOptionId,
          })
          .run();
    }
    return {
      quizResult: {
        attemptId: attempt.id,
        score,
        passed,
        grade: gradeFor(score),
        totalCorrect,
        totalQuestions,
        questionResults,
      },
    };
  });
}
