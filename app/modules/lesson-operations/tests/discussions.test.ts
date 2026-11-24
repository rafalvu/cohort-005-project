import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { comments, users, UserRole } from "~/db/schema";
import { getLessonPage } from "../index.server";
import { updateLessonDiscussion } from "../discussions.server";
import { requestFor } from "./fixtures";
import { discussionFixture, commandForm as form } from "./discussion-fixtures";

let f: Awaited<ReturnType<typeof discussionFixture>>;
beforeEach(async () => {
  f = await discussionFixture();
});
afterEach(() => f.db.$client.close());

it("a qualified Student posts a Discussion Question and notifies its actual Instructor", async () => {
  await f.enroll();
  f.notifications.sent.length = 0;
  expect(
    await updateLessonDiscussion(
      f.db,
      await requestFor(f.user.id),
      f.target,
      form({ intent: "create-comment", body: "  How does this work?  " }),
      f.notifications
    )
  ).toEqual({ ok: true });
  expect(f.db.select().from(comments).all()).toEqual([
    expect.objectContaining({
      userId: f.user.id,
      lessonId: f.lesson.id,
      parentId: null,
      body: "How does this work?",
    }),
  ]);
  expect(f.notifications.sent).toEqual([
    expect.objectContaining({
      kind: "discussion-question",
      recipient: expect.objectContaining({ id: f.instructor.id }),
      data: expect.objectContaining({ lessonId: f.lesson.id }),
    }),
  ]);
});

it("rejects a foreign parent before checking course permission and leaves records and Notifications unchanged", async () => {
  const parent = await f.comment(f.user.id, f.otherLesson.id);
  const before = f.snapshot();
  await expect(
    updateLessonDiscussion(
      f.db,
      await requestFor(f.user.id),
      f.target,
      form({
        intent: "create-comment",
        body: "Wrong lesson",
        parentId: String(parent.id),
      }),
      f.notifications
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(f.snapshot()).toEqual(before);
});

it("the author can edit their Discussion Question without changing its original Notification", async () => {
  await f.enroll();
  const question = await f.comment();
  const sent = [...f.notifications.sent];
  expect(
    await updateLessonDiscussion(
      f.db,
      await requestFor(f.user.id),
      f.target,
      form({
        intent: "edit-comment",
        commentId: String(question.id),
        body: "A clearer question",
      }),
      f.notifications
    )
  ).toEqual({ ok: true });
  expect(f.db.select().from(comments).all()).toEqual([
    expect.objectContaining({
      id: question.id,
      body: "A clearer question",
      editedAt: expect.any(String),
    }),
  ]);
  expect(f.notifications.sent).toEqual(sent);
});

it("the current owning Instructor can moderate a question while its replies and reply Notifications survive", async () => {
  const question = await f.comment();
  const reply = await f.comment(f.instructor.id, f.lesson.id, question.id);
  expect(
    await updateLessonDiscussion(
      f.db,
      await requestFor(f.instructor.id),
      f.target,
      form({ intent: "delete-comment", commentId: String(question.id) }),
      f.notifications
    )
  ).toEqual({ ok: true });
  expect(f.db.select().from(comments).all()).toEqual([
    expect.objectContaining({ id: question.id, deletedAt: expect.any(String) }),
    expect.objectContaining({ id: reply.id, deletedAt: null }),
  ]);
  expect(f.notifications.feedOf(f.instructor.id)).toEqual([]);
  expect(f.notifications.feedOf(f.user.id)).toEqual([
    expect.objectContaining({
      kind: "discussion-reply",
      data: expect.objectContaining({ commentId: reply.id }),
    }),
  ]);
});

it.each(["Student", "Instructor", "Platform Admin"])(
  "a permitted %s can post a Discussion Reply and notify the question's author",
  async (role) => {
    const question = await f.comment();
    const author =
      role === "Instructor"
        ? f.instructor
        : f.addPerson(
            role === "Platform Admin" ? UserRole.Admin : UserRole.Student
          );
    if (role === "Student") await f.enroll(author.id);
    f.notifications.sent.length = 0;
    expect(
      await updateLessonDiscussion(
        f.db,
        await requestFor(author.id),
        f.target,
        form({
          intent: "create-comment",
          parentId: String(question.id),
          body: "Here is an explanation",
        }),
        f.notifications
      )
    ).toEqual({ ok: true });
    expect(f.db.select().from(comments).all()).toContainEqual(
      expect.objectContaining({
        userId: author.id,
        parentId: question.id,
        lessonId: f.lesson.id,
        body: "Here is an explanation",
      })
    );
    expect(f.notifications.sent).toEqual([
      expect.objectContaining({
        kind: "discussion-reply",
        recipient: expect.objectContaining({ id: f.user.id }),
        actor: expect.objectContaining({ id: author.id }),
      }),
    ]);
  }
);

it("a Student's self-reply does not send a Notification to themselves", async () => {
  await f.enroll();
  const question = await f.comment();
  f.notifications.sent.length = 0;
  await updateLessonDiscussion(
    f.db,
    await requestFor(f.user.id),
    f.target,
    form({
      intent: "create-comment",
      parentId: String(question.id),
      body: "I found the answer",
    }),
    f.notifications
  );
  expect(f.notifications.sent).toEqual([]);
});

it("Discussion Replies stay one level deep and cannot target another lesson, even for a Platform Admin", async () => {
  const admin = f.addPerson(UserRole.Admin);
  const question = await f.comment();
  const reply = await f.comment(f.instructor.id, f.lesson.id, question.id);
  const adjacent = await f.comment(f.user.id, f.next.id);
  const foreign = await f.comment(f.user.id, f.otherLesson.id);
  const before = f.snapshot();
  for (const parentId of [reply.id, adjacent.id, foreign.id, 999999]) {
    await expect(
      updateLessonDiscussion(
        f.db,
        await requestFor(admin.id),
        f.target,
        form({
          intent: "create-comment",
          parentId: String(parentId),
          body: "Another answer",
        }),
        f.notifications
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(f.snapshot()).toEqual(before);
  }
});

it.each(["edit-comment", "delete-comment"])(
  "%s validates the comment's own lesson and parent ancestry before permission",
  async (intent) => {
    const admin = f.addPerson(UserRole.Admin);
    const foreign = await f.comment(f.user.id, f.otherLesson.id);
    const adjacent = await f.comment(f.user.id, f.next.id);
    const invalidReply = await f.comment();
    f.db
      .update(comments)
      .set({ parentId: foreign.id })
      .where(eq(comments.id, invalidReply.id))
      .run();
    const before = f.snapshot();
    for (const userId of [f.user.id, admin.id]) {
      for (const commentId of [
        foreign.id,
        adjacent.id,
        invalidReply.id,
        999999,
      ]) {
        const command = form({ intent, commentId: String(commentId) });
        if (intent === "edit-comment") command.set("body", "Changed writing");
        await expect(
          updateLessonDiscussion(
            f.db,
            await requestFor(userId),
            f.target,
            command,
            f.notifications
          )
        ).rejects.toMatchObject({ init: { status: 404 } });
        expect(f.snapshot()).toEqual(before);
      }
    }
  }
);

it.each(["Student", "Instructor", "Platform Admin"])(
  "a %s cannot edit another person's writing",
  async (role) => {
    const question = await f.comment();
    const person =
      role === "Instructor"
        ? f.instructor
        : f.addPerson(
            role === "Platform Admin" ? UserRole.Admin : UserRole.Student
          );
    if (role === "Student") await f.enroll(person.id);
    const before = f.snapshot();
    await expect(
      updateLessonDiscussion(
        f.db,
        await requestFor(person.id),
        f.target,
        form({
          intent: "edit-comment",
          commentId: String(question.id),
          body: "Rewriting someone else",
        }),
        f.notifications
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(f.snapshot()).toEqual(before);
  }
);

it("a Platform Admin can moderate an existing question without Enrollment", async () => {
  const admin = f.addPerson(UserRole.Admin);
  const question = await f.comment();
  expect(
    await updateLessonDiscussion(
      f.db,
      await requestFor(admin.id),
      f.target,
      form({ intent: "delete-comment", commentId: String(question.id) }),
      f.notifications
    )
  ).toEqual({ ok: true });
  expect(f.db.select().from(comments).all()).toEqual([
    expect.objectContaining({ id: question.id, deletedAt: expect.any(String) }),
  ]);
  expect(f.notifications.feedOf(f.instructor.id)).toEqual([]);
});

it("a Student can delete their own writing but cannot moderate another Student", async () => {
  await f.enroll();
  const own = await f.comment();
  const other = f.addPerson();
  const otherQuestion = await f.comment(other.id);
  const request = await requestFor(f.user.id);
  const before = f.snapshot();
  await expect(
    updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({ intent: "delete-comment", commentId: String(otherQuestion.id) }),
      f.notifications
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(f.snapshot()).toEqual(before);
  expect(
    await updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({ intent: "delete-comment", commentId: String(own.id) }),
      f.notifications
    )
  ).toEqual({ ok: true });
  const deleted = f.snapshot();
  expect(
    await updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({ intent: "delete-comment", commentId: String(own.id) }),
      f.notifications
    )
  ).toEqual({ ok: true });
  expect(f.snapshot()).toEqual(deleted);
  await expect(
    updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({
        intent: "edit-comment",
        commentId: String(own.id),
        body: "Resurrected",
      }),
      f.notifications
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(f.snapshot()).toEqual(deleted);
});

it("demotion removes moderation and Instructor reply status while preserving independently qualified Student writing", async () => {
  const request = await requestFor(f.instructor.id);
  const question = await f.comment();
  f.db
    .update(users)
    .set({ role: UserRole.Student })
    .where(eq(users.id, f.instructor.id))
    .run();
  const before = f.snapshot();
  await expect(
    updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({
        intent: "create-comment",
        parentId: String(question.id),
        body: "Cannot reply yet",
      }),
      f.notifications
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(f.snapshot()).toEqual(before);
  await f.enroll(f.instructor.id);
  const enrolled = f.snapshot();
  await expect(
    updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({ intent: "delete-comment", commentId: String(question.id) }),
      f.notifications
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(f.snapshot()).toEqual(enrolled);
  expect(
    await updateLessonDiscussion(
      f.db,
      request,
      f.target,
      form({
        intent: "create-comment",
        parentId: String(question.id),
        body: "Now replying as a Student",
      }),
      f.notifications
    )
  ).toEqual({ ok: true });
  const page = await getLessonPage(f.db, request, f.target);
  if (page.kind !== "content")
    throw new Error("Expected permitted Student content");
  expect(page.comments[0]?.replies).toEqual([
    expect.objectContaining({
      author: expect.objectContaining({
        id: f.instructor.id,
        isInstructor: false,
        isAdmin: false,
      }),
    }),
  ]);
});

it.each(["Instructor", "Platform Admin"])(
  "the current %s retains content-reading discussion powers when their own Student country evidence blocks activity",
  async (role) => {
    const person =
      role === "Instructor" ? f.instructor : f.addPerson(UserRole.Admin);
    await f.enroll(person.id);
    f.purchase("IN", person.id);
    const question = await f.comment();
    expect(
      await updateLessonDiscussion(
        f.db,
        await requestFor(person.id, "US"),
        f.target,
        form({
          intent: "create-comment",
          parentId: String(question.id),
          body: "Staff explanation",
        }),
        f.notifications
      )
    ).toEqual({ ok: true });
    expect(
      await updateLessonDiscussion(
        f.db,
        await requestFor(person.id, "US"),
        f.target,
        form({ intent: "delete-comment", commentId: String(question.id) }),
        f.notifications
      )
    ).toEqual({ ok: true });
  }
);
