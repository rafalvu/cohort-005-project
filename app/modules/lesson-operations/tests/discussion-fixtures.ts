import { bookmarks, comments, notes } from "~/db/schema";
import { createComment } from "~/lib/comments.server";
import { lessonFixture, requestFor } from "./fixtures";

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

export async function discussionFixture() {
  const fixture = await lessonFixture();
  const { db, course, user, lesson, notifications } = fixture;
  const request = await requestFor(fixture.instructor.id);
  const otherCourse = await createInstructorCourse(
    db,
    new Request(request, {
      method: "POST",
      body: new URLSearchParams({
        title: "Another course",
        description: course.description,
        salesCopy: course.salesCopy,
        categoryId: String(course.categoryId),
      }),
    })
  );
  await updateCourseSettings(db, request, otherCourse.id, {
    intent: "update-status",
    status: course.status,
  });
  await updateCourseSettings(db, request, otherCourse.id, {
    intent: "update-price",
    price: "79",
  });
  await updateCourseSettings(db, request, otherCourse.id, {
    intent: "update-ppp-enabled",
    pppEnabled: "true",
  });
  await createCourseSection(db, request, otherCourse.id, {
    title: "Another section",
  });
  const otherSection = (await getCourseEditor(db, request, otherCourse.id))
    .course.modules[0];
  if (!otherSection) throw new Error("Other section was not created");
  await createLesson(db, request, otherCourse.id, {
    moduleId: otherSection.id,
    title: "Another lesson",
  });
  const otherLesson = (
    await getCurriculumSectionEditor(
      db,
      request,
      otherCourse.id,
      otherSection.id
    )
  ).module.lessons[0];
  if (!otherLesson) throw new Error("Other lesson was not created");
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
