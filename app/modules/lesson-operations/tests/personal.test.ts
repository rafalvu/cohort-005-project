import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, UserRole } from "~/db/schema";
import { getNote } from "~/lib/notes.server";
import { isBookmarked } from "~/lib/bookmarks.server";
import { updateLessonPersonalData } from "../personal.server";
import { requestFor } from "./fixtures";
import { discussionFixture, commandForm } from "./discussion-fixtures";

let f: Awaited<ReturnType<typeof discussionFixture>>;
beforeEach(async () => {
  f = await discussionFixture();
});
afterEach(() => f.db.$client.close());

it("saves and revises only the current person's Note on the permitted lesson", async () => {
  await f.enroll();
  await f.privateData();
  const other = f.addPerson();
  await f.enroll(other.id);
  const request = await requestFor(other.id);
  for (const body of ["My first note", "  Revised note  "]) {
    expect(
      await updateLessonPersonalData(
        f.db,
        request,
        f.target,
        commandForm({ intent: "save-note", body })
      )
    ).toEqual({ ok: true });
  }
  expect(getNote(f.db, other.id, f.lesson.id)?.body).toBe("Revised note");
  expect(getNote(f.db, f.user.id, f.lesson.id)?.body).toBe(
    "Secret personal note"
  );
  expect(isBookmarked(f.db, f.user.id, f.lesson.id)).toBe(true);
});

it("adds and removes only the current person's Bookmark without changing another person's Note or Bookmark", async () => {
  await f.enroll();
  await f.privateData();
  const other = f.addPerson();
  await f.enroll(other.id);
  const sent = [...f.notifications.sent];
  const request = await requestFor(other.id);
  expect(
    await updateLessonPersonalData(
      f.db,
      request,
      f.target,
      commandForm({ intent: "toggle-bookmark" })
    )
  ).toEqual({ ok: true, bookmarked: true });
  expect(isBookmarked(f.db, other.id, f.lesson.id)).toBe(true);
  expect(
    await updateLessonPersonalData(
      f.db,
      request,
      f.target,
      commandForm({ intent: "toggle-bookmark" })
    )
  ).toEqual({ ok: true, bookmarked: false });
  expect(isBookmarked(f.db, other.id, f.lesson.id)).toBe(false);
  expect(isBookmarked(f.db, f.user.id, f.lesson.id)).toBe(true);
  expect(getNote(f.db, f.user.id, f.lesson.id)?.body).toBe(
    "Secret personal note"
  );
  expect(f.notifications.sent).toEqual(sent);
});

it.each(["save-note", "toggle-bookmark"])(
  "%s cannot select another person's private records, including as a Platform Admin",
  async (intent) => {
    await f.privateData();
    const admin = f.addPerson(UserRole.Admin);
    const before = f.snapshot();
    const note = getNote(f.db, f.user.id, f.lesson.id);
    for (const field of [
      "userId",
      "studentId",
      "noteId",
      "bookmarkId",
      "lessonId",
    ]) {
      const command = commandForm({
        intent,
        [field]: String(note?.id ?? f.user.id),
      });
      if (intent === "save-note")
        command.set("body", "Unauthorized replacement");
      await expect(
        updateLessonPersonalData(
          f.db,
          await requestFor(admin.id),
          f.target,
          command
        )
      ).rejects.toMatchObject({ init: { status: 400 } });
      expect(f.snapshot()).toEqual(before);
    }
  }
);

it.each(["Instructor", "Platform Admin"])(
  "a current %s can keep personal Notes and Bookmarks through content-reading permission",
  async (role) => {
    await f.privateData();
    const person =
      role === "Instructor" ? f.instructor : f.addPerson(UserRole.Admin);
    const request = await requestFor(person.id);
    expect(
      await updateLessonPersonalData(
        f.db,
        request,
        f.target,
        commandForm({ intent: "save-note", body: "My private staff Note" })
      )
    ).toEqual({ ok: true });
    expect(
      await updateLessonPersonalData(
        f.db,
        request,
        f.target,
        commandForm({ intent: "toggle-bookmark" })
      )
    ).toEqual({ ok: true, bookmarked: true });
    expect(getNote(f.db, person.id, f.lesson.id)?.body).toBe(
      "My private staff Note"
    );
    expect(getNote(f.db, f.user.id, f.lesson.id)?.body).toBe(
      "Secret personal note"
    );
    expect(isBookmarked(f.db, f.user.id, f.lesson.id)).toBe(true);
  }
);

it("a demoted owner can change their private data only through independently valid Student permission", async () => {
  const request = await requestFor(f.instructor.id);
  await updateLessonPersonalData(
    f.db,
    request,
    f.target,
    commandForm({ intent: "save-note", body: "Retained Note" })
  );
  await updateLessonPersonalData(
    f.db,
    request,
    f.target,
    commandForm({ intent: "toggle-bookmark" })
  );
  f.db
    .update(users)
    .set({ role: UserRole.Student })
    .where(eq(users.id, f.instructor.id))
    .run();
  const before = f.snapshot();
  for (const command of [
    commandForm({ intent: "save-note", body: "Not permitted yet" }),
    commandForm({ intent: "toggle-bookmark" }),
  ]) {
    await expect(
      updateLessonPersonalData(f.db, request, f.target, command)
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(f.snapshot()).toEqual(before);
  }
  await f.enroll(f.instructor.id);
  expect(
    await updateLessonPersonalData(
      f.db,
      request,
      f.target,
      commandForm({ intent: "save-note", body: "Student Note" })
    )
  ).toEqual({ ok: true });
  expect(
    await updateLessonPersonalData(
      f.db,
      request,
      f.target,
      commandForm({ intent: "toggle-bookmark" })
    )
  ).toEqual({ ok: true, bookmarked: false });
  expect(getNote(f.db, f.instructor.id, f.lesson.id)?.body).toBe(
    "Student Note"
  );
});
