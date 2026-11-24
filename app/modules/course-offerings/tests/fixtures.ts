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

export async function offeringFixture() {
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
      content: "Protected body",
      videoUrl: "https://video.example/secret",
      githubRepoUrl: "https://code.example/secret",
    });
    createdLessons.push(
      (await getLessonEditor(db, request, base.course.id, created.id)).lesson
    );
  }
  const lessons = createdLessons;
  const firstLesson = lessons[0];
  if (!firstLesson) throw new Error("No lesson seeded");
  async function enroll(userId = base.user.id) {
    const result = await enrollStudent(
      db,
      userId,
      base.course.id,
      new Date(),
      notifications
    );
    if (!result.ok) throw new Error(result.error);
  }
  function purchase(country: string, userId = base.user.id) {
    return db
      .insert(schema.purchases)
      .values({
        userId,
        courseId: base.course.id,
        country,
        amountPaid: 7900,
      })
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
  function complete(userId = base.user.id) {
    db.insert(schema.lessonProgress)
      .values({
        userId,
        lessonId: firstLesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
  }
  function demote() {
    db.update(schema.users)
      .set({ role: schema.UserRole.Student })
      .where(eq(schema.users.id, base.instructor.id))
      .run();
  }
  function unenroll(userId = base.user.id) {
    db.delete(schema.enrollments)
      .where(eq(schema.enrollments.userId, userId))
      .run();
  }
  return {
    db,
    ...base,
    section,
    lessons,
    firstLesson,
    notifications,
    enroll,
    purchase,
    addPerson,
    complete,
    demote,
    unenroll,
  };
}

export async function requestFor(userId: number | null, country = "US") {
  const url = "http://localhost/courses/test-course";
  const headers = new Headers({ "CF-IPCountry": country });
  if (userId !== null)
    headers.set("Cookie", await setCurrentUserId(new Request(url), userId));
  return new Request(url, { headers });
}
