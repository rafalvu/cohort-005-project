import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { setCurrentUserId } from "~/lib/session";
import { markdown } from "~/lib/text";

export function offeringFixture() {
  const db = createTestDb();
  const base = seedBaseData(db);
  const notifications = fakeNotifications();
  db.update(schema.courses)
    .set({ price: 7900, pppEnabled: true })
    .where(eq(schema.courses.id, base.course.id))
    .run();
  const section = db
    .insert(schema.modules)
    .values({
      courseId: base.course.id,
      title: "Getting started",
      position: 0,
    })
    .returning()
    .get();
  const lessons = [0, 1, 2].map((position) =>
    db
      .insert(schema.lessons)
      .values({
        moduleId: section.id,
        title: `Lesson ${position + 1}`,
        position,
        durationMinutes: 10,
        content: markdown("Protected body"),
        videoUrl: "https://video.example/secret",
        githubRepoUrl: "https://code.example/secret",
      })
      .returning()
      .get()
  );
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
