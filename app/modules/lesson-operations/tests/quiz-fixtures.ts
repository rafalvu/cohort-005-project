import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { lessonFixture, requestFor } from "./fixtures";
import { claimSeat } from "~/lib/seat-claims.server";

import { createInstructorCourse } from "~/modules/instructor-operations/reporting.server";
import {
  createCourseSection,
  getCourseEditor,
  updateCourseSettings,
} from "~/modules/instructor-operations/course-editor.server";
import {
  createLesson,
  getCurriculumSectionEditor,
} from "~/modules/instructor-operations/lessons.server";

export async function quizFixture() {
  const fixture = await lessonFixture();
  const { db } = fixture;
  const existingOption = db
    .select()
    .from(schema.quizOptions)
    .where(eq(schema.quizOptions.questionId, fixture.question.id))
    .get();
  if (!existingOption) throw new Error("Quiz fixture needs an answer");
  const correctOption = existingOption;
  const incorrectOption = db
    .insert(schema.quizOptions)
    .values({
      questionId: fixture.question.id,
      optionText: "Incorrect answer",
      isCorrect: false,
    })
    .returning()
    .get();

  function addQuestion(quizId = fixture.quiz.id, position = 1) {
    const question = db
      .insert(schema.quizQuestions)
      .values({
        quizId,
        questionText: `Question ${position + 1}`,
        questionType: schema.QuestionType.TrueFalse,
        position,
      })
      .returning()
      .get();
    const correctOption = db
      .insert(schema.quizOptions)
      .values({ questionId: question.id, optionText: "True", isCorrect: true })
      .returning()
      .get();
    const incorrectOption = db
      .insert(schema.quizOptions)
      .values({
        questionId: question.id,
        optionText: "False",
        isCorrect: false,
      })
      .returning()
      .get();
    return { question, correctOption, incorrectOption };
  }

  function form(
    answers: Array<[number | string, number | string]> = [
      [fixture.question.id, correctOption.id],
    ],
    quizId: number | string = fixture.quiz.id
  ) {
    const formData = new FormData();
    formData.append("intent", "submit-quiz");
    formData.append("quizId", String(quizId));
    for (const [questionId, optionId] of answers)
      formData.append(`question-${questionId}`, String(optionId));
    return formData;
  }

  async function otherQuiz() {
    const request = await requestFor(fixture.instructor.id);
    const course = await createInstructorCourse(
      db,
      new Request(request, {
        method: "POST",
        body: new URLSearchParams({
          title: "Other course",
          description: "Other course",
          salesCopy: fixture.course.salesCopy,
          categoryId: String(fixture.course.categoryId),
        }),
      })
    );
    await updateCourseSettings(db, request, course.id, {
      intent: "update-status",
      status: schema.CourseStatus.Published,
    });
    await updateCourseSettings(db, request, course.id, {
      intent: "update-price",
      price: "79",
    });
    await createCourseSection(db, request, course.id, {
      title: "Other section",
    });
    const section = (await getCourseEditor(db, request, course.id)).course
      .modules[0];
    if (!section) throw new Error("Other section was not created");
    await createLesson(db, request, course.id, {
      moduleId: section.id,
      title: "Other lesson",
    });
    const lesson = (
      await getCurriculumSectionEditor(db, request, course.id, section.id)
    ).module.lessons[0];
    if (!lesson) throw new Error("Other lesson was not created");
    const quiz = db
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Other quiz", passingScore: 0.7 })
      .returning()
      .get();
    return { course, section, lesson, quiz, ...addQuestion(quiz.id) };
  }

  function person(
    kind:
      | "Student"
      | "owning Instructor"
      | "other Instructor"
      | "Platform Admin"
      | "demoted owner"
  ) {
    if (kind === "Student") return fixture.user;
    if (kind === "owning Instructor") return fixture.instructor;
    if (kind === "demoted owner") {
      db.update(schema.users)
        .set({ role: schema.UserRole.Student })
        .where(eq(schema.users.id, fixture.instructor.id))
        .run();
      return fixture.instructor;
    }
    return fixture.addPerson(
      kind === "Platform Admin"
        ? schema.UserRole.Admin
        : schema.UserRole.Instructor
    );
  }

  async function claim(country: string) {
    const buyer = fixture.addPerson();
    const purchase = fixture.purchase(country, buyer.id);
    const team = db.insert(schema.teams).values({}).returning().get();
    const seat = db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: fixture.course.id,
        code: crypto.randomUUID(),
        purchaseId: purchase.id,
      })
      .returning()
      .get();
    const result = await claimSeat(
      db,
      seat.code,
      fixture.user.id,
      country,
      new Date(),
      fixture.notifications
    );
    if (!result.ok) throw new Error(result.error);
  }

  function rejectAnswerWrite(optionId: number) {
    db.$client
      .exec(`CREATE TRIGGER reject_quiz_answer BEFORE INSERT ON quiz_answers
      WHEN NEW.selected_option_id = ${optionId}
      BEGIN SELECT RAISE(ABORT, 'Answer storage unavailable'); END;`);
  }

  function state() {
    return {
      ...fixture.history(),
      answers: db.select().from(schema.quizAnswers).all(),
      notifications: [...fixture.notifications.sent],
    };
  }

  return {
    ...fixture,
    correctOption,
    incorrectOption,
    addQuestion,
    form,
    otherQuiz,
    person,
    claim,
    rejectAnswerWrite,
    state,
  };
}

export { requestFor };
