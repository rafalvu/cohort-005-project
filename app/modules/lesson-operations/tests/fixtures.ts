import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { setCurrentUserId } from "~/lib/session";
import {
  createCourseSection,
  getCourseEditor,
} from "~/modules/instructor-operations/course-editor.server";
import {
  createLesson,
  getLessonEditor,
  updateLesson,
} from "~/modules/instructor-operations/lessons.server";
import { createComment } from "~/lib/comments.server";
import { saveNote } from "~/lib/notes.server";
import { toggleBookmark } from "~/lib/bookmarks.server";

export async function lessonFixture() {
  const db = createTestDb();
  const base = seedBaseData(db);
  const notifications = fakeNotifications();
  db.update(schema.courses)
    .set({ price: 7900, pppEnabled: true })
    .where(eq(schema.courses.id, base.course.id))
    .run();
  const request = await requestFor(base.instructor.id);
  await createCourseSection(db, request, base.course.id, {
    title: "Getting started",
  });
  const section = (await getCourseEditor(db, request, base.course.id)).course
    .modules[0];
  if (!section) throw new Error("Curriculum section was not created");
  const createdLessons = [];
  for (const position of [0, 1, 2]) {
    const title = `Lesson ${position + 1}`;
    await createLesson(db, request, base.course.id, {
      moduleId: section.id,
      title,
    });
    const created = (
      await getCourseEditor(db, request, base.course.id)
    ).course.modules[0]?.lessons.find((lesson) => lesson.title === title);
    if (!created) throw new Error("Lesson was not created");
    await updateLesson(db, request, base.course.id, created.id, {
      intent: "update-lesson",
      durationMinutes: "10",
      content: `Protected body ${position}`,
      videoUrl: `https://video.example/secret-${position}`,
      githubRepoUrl: `https://code.example/secret-${position}`,
    });
    createdLessons.push(
      (await getLessonEditor(db, request, base.course.id, created.id)).lesson
    );
  }
  const [previous, lesson, next] = createdLessons;
  if (!previous || !lesson || !next)
    throw new Error("Lesson curriculum was not created");
  const quiz = db
    .insert(schema.quizzes)
    .values({
      lessonId: lesson.id,
      title: "Secret assessment",
      passingScore: 0.7,
    })
    .returning()
    .get();
  const question = db
    .insert(schema.quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: "Secret question",
      questionType: schema.QuestionType.MultipleChoice,
      position: 0,
    })
    .returning()
    .get();
  db.insert(schema.quizOptions)
    .values({
      questionId: question.id,
      optionText: "Secret option",
      isCorrect: true,
    })
    .run();

  async function enroll(userId = base.user.id) {
    const result = await enrollStudent(
      db,
      userId,
      base.course.id,
      new Date(),
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    return result.enrollment;
  }
  function purchase(country: string, userId = base.user.id) {
    return db
      .insert(schema.purchases)
      .values({ userId, courseId: base.course.id, country, amountPaid: 7900 })
      .returning()
      .get();
  }
  function addPerson(role = schema.UserRole.Student) {
    return db
      .insert(schema.users)
      .values({
        name: "Another person",
        email: `${crypto.randomUUID()}@example.com`,
        role,
      })
      .returning()
      .get();
  }
  async function privateData() {
    await createComment(
      db,
      base.user.id,
      lesson.id,
      null,
      "Secret discussion",
      new Date(),
      notifications
    );
    saveNote(db, base.user.id, lesson.id, "Secret personal note", new Date());
    toggleBookmark(db, base.user.id, lesson.id, new Date());
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: previous.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    db.insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "pause",
        positionSeconds: 120,
      })
      .run();
  }
  function history() {
    return {
      progress: db.select().from(schema.lessonProgress).all(),
      watched: db.select().from(schema.videoWatchEvents).all(),
      attempts: db.select().from(schema.quizAttempts).all(),
    };
  }
  return {
    db,
    ...base,
    section,
    previous,
    lesson,
    next,
    quiz,
    question,
    notifications,
    enroll,
    purchase,
    addPerson,
    privateData,
    history,
    target: { slug: base.course.slug, lessonId: String(lesson.id) },
  };
}

export async function requestFor(userId: number | null, country = "US") {
  const url = "http://localhost/courses/test-course/lessons/2";
  const headers = new Headers({ "CF-IPCountry": country });
  if (userId !== null)
    headers.set("Cookie", await setCurrentUserId(new Request(url), userId));
  return new Request(url, { headers });
}
