import {
  bookmarks,
  comments,
  courses,
  lessons,
  modules,
  notes,
} from "~/db/schema";
import { createComment } from "~/lib/comments.server";
import { lessonFixture } from "./fixtures";

export function discussionFixture() {
  const fixture = lessonFixture();
  const { db, course, user, lesson, notifications } = fixture;
  const otherCourse = db
    .insert(courses)
    .values({
      title: "Another course",
      slug: "another-course",
      instructorId: course.instructorId,
      description: course.description,
      salesCopy: course.salesCopy,
      status: course.status,
      categoryId: course.categoryId,
      price: 7900,
      pppEnabled: true,
    })
    .returning()
    .get();
  const otherSection = db
    .insert(modules)
    .values({ courseId: otherCourse.id, title: "Another section", position: 0 })
    .returning()
    .get();
  const otherLesson = db
    .insert(lessons)
    .values({ moduleId: otherSection.id, title: "Another lesson", position: 0 })
    .returning()
    .get();
  async function comment(
    authorId = user.id,
    lessonId = lesson.id,
    parentId: number | null = null
  ) {
    const result = await createComment(
      db,
      authorId,
      lessonId,
      parentId,
      "Original writing",
      new Date(),
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    return result.comment;
  }
  function snapshot() {
    return {
      comments: db.select().from(comments).all(),
      notes: db.select().from(notes).all(),
      bookmarks: db.select().from(bookmarks).all(),
      notifications: [...notifications.sent],
      feeds: db
        .select({ id: comments.userId })
        .from(comments)
        .all()
        .map(({ id }) => notifications.feedOf(id)),
      instructorFeed: notifications.feedOf(fixture.instructor.id),
    };
  }
  return {
    ...fixture,
    otherCourse,
    otherSection,
    otherLesson,
    comment,
    snapshot,
  };
}

export function commandForm(input: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) form.set(key, value);
  return form;
}
