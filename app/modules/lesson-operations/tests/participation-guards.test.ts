import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, UserRole } from "~/db/schema";
import { updateLessonDiscussion } from "../discussions.server";
import { updateLessonPersonalData } from "../personal.server";
import { requestFor } from "./fixtures";
import { discussionFixture, commandForm } from "./discussion-fixtures";

const intents = [
  "create-comment",
  "edit-comment",
  "delete-comment",
  "save-note",
  "toggle-bookmark",
] as const;
type Intent = (typeof intents)[number];
let f: Awaited<ReturnType<typeof discussionFixture>>;
let commentId: number;
beforeEach(async () => {
  f = await discussionFixture();
  await f.privateData();
  commentId = (await f.comment()).id;
});
afterEach(() => f.db.$client.close());

function command(intent: Intent) {
  switch (intent) {
    case "create-comment":
      return commandForm({ intent, body: "New writing" });
    case "edit-comment":
      return commandForm({
        intent,
        commentId: String(commentId),
        body: "Edited writing",
      });
    case "delete-comment":
      return commandForm({ intent, commentId: String(commentId) });
    case "save-note":
      return commandForm({ intent, body: "My Note" });
    case "toggle-bookmark":
      return commandForm({ intent });
  }
}
function run(
  intent: Intent,
  request: Request,
  target: unknown = f.target,
  form = command(intent)
) {
  return intent === "save-note" || intent === "toggle-bookmark"
    ? updateLessonPersonalData(f.db, request, target, form)
    : updateLessonDiscussion(f.db, request, target, form, f.notifications);
}

it.each(intents)(
  "%s rejects signed-out and stale identities before invalid commands or targets",
  async (intent) => {
    const before = f.snapshot();
    for (const userId of [null, 999999]) {
      await expect(
        run(
          intent,
          await requestFor(userId),
          { slug: "", lessonId: "bad" },
          new FormData()
        )
      ).rejects.toMatchObject({ init: { status: 401 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(intents)(
  "%s rejects duplicate and unsupported command fields before resolving a missing lesson",
  async (intent) => {
    const request = await requestFor(f.user.id);
    const before = f.snapshot();
    for (const kind of [
      "duplicate-intent",
      "duplicate-field",
      "extra-user",
      "file",
      "missing-intent",
    ]) {
      const form = command(intent);
      if (kind === "duplicate-intent") form.append("intent", intent);
      if (kind === "duplicate-field") {
        const field =
          intent === "delete-comment"
            ? "commentId"
            : intent === "toggle-bookmark"
              ? "intent"
              : "body";
        form.append(field, "2");
      }
      if (kind === "extra-user") form.set("userId", String(f.instructor.id));
      if (kind === "file") form.set("intent", new Blob([intent]), "intent.txt");
      if (kind === "missing-intent") form.delete("intent");
      await expect(
        run(intent, request, { slug: "missing-course", lessonId: 999999 }, form)
      ).rejects.toMatchObject({ init: { status: 400 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(intents)(
  "%s validates lesson identifiers before looking up resources",
  async (intent) => {
    const request = await requestFor(f.user.id);
    const before = f.snapshot();
    for (const lessonId of [
      undefined,
      "",
      "-1",
      "0",
      "1.5",
      "01",
      "1e2",
      "1x",
      "Infinity",
      "9007199254740992",
    ]) {
      await expect(
        run(intent, request, { slug: "missing-course", lessonId })
      ).rejects.toMatchObject({ init: { status: 400 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(intents)(
  "%s resolves actual lesson ancestry before permission even for a Platform Admin",
  async (intent) => {
    const admin = f.addPerson(UserRole.Admin);
    const before = f.snapshot();
    for (const userId of [f.user.id, admin.id]) {
      const request = await requestFor(userId);
      for (const target of [
        { slug: f.course.slug, lessonId: f.otherLesson.id },
        { slug: f.otherCourse.slug, lessonId: f.lesson.id },
        { slug: "missing-course", lessonId: f.lesson.id },
        { slug: f.course.slug, lessonId: 999999 },
      ]) {
        await expect(run(intent, request, target)).rejects.toMatchObject({
          init: { status: 404 },
        });
        expect(f.snapshot()).toEqual(before);
      }
    }
  }
);

it.each(intents)(
  "%s requires content-reading permission for Students, other Instructors and demoted owners",
  async (intent) => {
    const otherInstructor = f.addPerson(UserRole.Instructor);
    f.db
      .update(users)
      .set({ role: UserRole.Student })
      .where(eq(users.id, f.instructor.id))
      .run();
    const before = f.snapshot();
    for (const person of [f.user, otherInstructor, f.instructor]) {
      await expect(
        run(intent, await requestFor(person.id))
      ).rejects.toMatchObject({ init: { status: 403 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(intents)(
  "%s rejects country-blocked Student writing without record or Notification changes",
  async (intent) => {
    await f.enroll();
    f.purchase("IN");
    f.purchase("BR");
    const before = f.snapshot();
    await expect(
      run(intent, await requestFor(f.user.id, "US"))
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(f.snapshot()).toEqual(before);
  }
);

it.each(intents)(
  "%s accepts a qualifying Purchase alongside blocked evidence",
  async (intent) => {
    await f.enroll();
    f.purchase("IN");
    f.purchase("US");
    expect(await run(intent, await requestFor(f.user.id))).toMatchObject({
      ok: true,
    });
  }
);

it.each(["create-comment", "edit-comment", "delete-comment"] as const)(
  "%s validates comment identifiers before resolving the lesson",
  async (intent) => {
    const before = f.snapshot();
    for (const invalid of [
      "",
      "0",
      "-1",
      "1.2",
      "01",
      " 1",
      "1e2",
      "Infinity",
      "9007199254740992",
    ]) {
      const form = command(intent);
      form.set(intent === "create-comment" ? "parentId" : "commentId", invalid);
      await expect(
        run(
          intent,
          await requestFor(f.user.id),
          { slug: "missing", lessonId: 999999 },
          form
        )
      ).rejects.toMatchObject({ init: { status: 400 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(["create-comment", "edit-comment", "save-note"] as const)(
  "%s rejects missing, blank, excessive or nontext writing",
  async (intent) => {
    const before = f.snapshot();
    for (const body of [
      undefined,
      "   ",
      "x".repeat(intent === "save-note" ? 2001 : 5001),
      new Blob(["Writing"]),
    ]) {
      const form = command(intent);
      if (body === undefined) form.delete("body");
      else form.set("body", body);
      await expect(
        run(
          intent,
          await requestFor(f.user.id),
          { slug: "missing", lessonId: 999999 },
          form
        )
      ).rejects.toMatchObject({ init: { status: 400 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);
