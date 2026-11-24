import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  teams,
  users,
  UserRole,
} from "~/db/schema";
import { completeLesson, recordVideoEvent } from "../activity.server";
import { claimSeat } from "~/lib/seat-claims.server";
import { setDevCountry } from "~/lib/session";
import { getLessonPage } from "../index.server";
import { lessonFixture, requestFor } from "./fixtures";

let f: Awaited<ReturnType<typeof lessonFixture>>;
beforeEach(async () => {
  f = await lessonFixture();
});
afterEach(() => f.db.$client.close());

function completionForm() {
  const form = new FormData();
  form.set("intent", "mark-complete");
  return form;
}

it("completes and repeats a qualified Student's lesson without duplicating history or changing Enrollment", async () => {
  const enrollment = await f.enroll();
  const request = await requestFor(f.user.id);
  f.notifications.sent.length = 0;
  expect(
    await completeLesson(f.db, request, f.target, completionForm())
  ).toEqual({ success: true });
  expect(
    await completeLesson(f.db, request, f.target, completionForm())
  ).toEqual({ success: true });
  expect(f.history().progress).toEqual([
    expect.objectContaining({
      userId: f.user.id,
      lessonId: f.lesson.id,
      status: "completed",
      completedAt: expect.any(String),
    }),
  ]);
  expect(f.db.select().from(enrollments).all()).toEqual([enrollment]);
  expect(f.notifications.sent).toEqual([]);
});

async function videoRequest(
  userId: number | null,
  input: unknown,
  country = "US"
) {
  const session = await requestFor(userId, country);
  return new Request("http://localhost/api/video-tracking", {
    method: "POST",
    headers: new Headers([
      ...session.headers,
      ["Content-Type", "application/json"],
    ]),
    body: JSON.stringify(input),
  });
}

it("records each video event and preserves furthest Watched position separately from resume position", async () => {
  await f.enroll();
  f.notifications.sent.length = 0;
  for (const [eventType, positionSeconds] of [
    ["play", 0],
    ["progress", 180.5],
    ["pause", 60],
  ] as const) {
    const result = await recordVideoEvent(
      f.db,
      await videoRequest(f.user.id, {
        lessonId: f.lesson.id,
        eventType,
        positionSeconds,
      })
    );
    expect(result).toEqual({ success: true });
  }
  expect(f.history().watched).toEqual([
    expect.objectContaining({
      userId: f.user.id,
      lessonId: f.lesson.id,
      eventType: "play",
      positionSeconds: 0,
    }),
    expect.objectContaining({
      userId: f.user.id,
      lessonId: f.lesson.id,
      eventType: "progress",
      positionSeconds: 180.5,
    }),
    expect.objectContaining({
      userId: f.user.id,
      lessonId: f.lesson.id,
      eventType: "pause",
      positionSeconds: 60,
    }),
  ]);
  expect(f.history().progress).toEqual([]);
  const page = await getLessonPage(f.db, await requestFor(f.user.id), f.target);
  expect(page).toMatchObject({ lastWatchPosition: 60, watchProgress: 30 });
  expect(f.notifications.sent).toEqual([]);
});

const activities = ["completion", "video"] as const;
type Activity = (typeof activities)[number];
async function activity(kind: Activity, userId: number | null, country = "US") {
  if (kind === "completion") {
    return completeLesson(
      f.db,
      await requestFor(userId, country),
      f.target,
      completionForm()
    );
  }
  return recordVideoEvent(
    f.db,
    await videoRequest(
      userId,
      {
        lessonId: f.lesson.id,
        eventType: "progress",
        positionSeconds: 40,
      },
      country
    )
  );
}
function snapshot() {
  return {
    ...f.history(),
    enrollments: f.db.select().from(enrollments).all(),
    notifications: [...f.notifications.sent],
  };
}

it.each(activities)(
  "%s rejects signed-out and stale identities before malformed targets or commands",
  async (kind) => {
    await f.privateData();
    const before = snapshot();
    for (const userId of [null, 999999]) {
      const operation =
        kind === "completion"
          ? completeLesson(
              f.db,
              await requestFor(userId),
              { slug: "", lessonId: -1 },
              new FormData()
            )
          : recordVideoEvent(
              f.db,
              await videoRequest(userId, { lessonId: -1 })
            );
      await expect(operation).rejects.toMatchObject({ init: { status: 401 } });
      expect(snapshot()).toEqual(before);
    }
  }
);

it.each(activities)(
  "%s requires Student qualification for Students, owning Instructors, other Instructors, Platform Admins, and demoted owners",
  async (kind) => {
    const otherInstructor = f.addPerson(UserRole.Instructor);
    const admin = f.addPerson(UserRole.Admin);
    await f.privateData();
    for (const person of [f.user, f.instructor, otherInstructor, admin]) {
      const before = snapshot();
      await expect(activity(kind, person.id)).rejects.toMatchObject({
        init: { status: 403 },
      });
      expect(snapshot()).toEqual(before);
    }
    f.db
      .update(users)
      .set({ role: UserRole.Student })
      .where(eq(users.id, f.instructor.id))
      .run();
    const before = snapshot();
    await expect(activity(kind, f.instructor.id)).rejects.toMatchObject({
      init: { status: 403 },
    });
    expect(snapshot()).toEqual(before);
  }
);

it.each(activities)(
  "%s denies all-country-blocked Enrollment even for owning Instructors and Platform Admins",
  async (kind) => {
    const admin = f.addPerson(UserRole.Admin);
    await f.privateData();
    for (const person of [f.user, f.instructor, admin]) {
      await f.enroll(person.id);
      f.purchase("IN", person.id);
      f.purchase("BR", person.id);
      const before = snapshot();
      await expect(activity(kind, person.id)).rejects.toMatchObject({
        init: { status: 403 },
      });
      expect(snapshot()).toEqual(before);
    }
  }
);

it.each(activities)(
  "%s permits every role through Enrollment-only fallback and through any qualifying Purchase",
  async (kind) => {
    const admin = f.addPerson(UserRole.Admin);
    for (const person of [f.user, f.instructor, admin]) {
      await f.enroll(person.id);
      expect(await activity(kind, person.id)).toEqual({ success: true });
      f.purchase("IN", person.id);
      f.purchase("US", person.id);
      expect(await activity(kind, person.id)).toEqual({ success: true });
    }
  }
);

it.each(activities)(
  "%s follows live country overrides and accepts qualifying discounted-country evidence",
  async (kind) => {
    await f.enroll();
    f.purchase("IN");
    const initialRequest = await requestFor(f.user.id, "US");
    const headers = new Headers(initialRequest.headers);
    headers.set("Cookie", await setDevCountry(initialRequest, "IN"));
    const request =
      kind === "completion"
        ? new Request(initialRequest.url, { headers })
        : new Request("http://localhost/api/video-tracking", {
            method: "POST",
            headers,
            body: JSON.stringify({
              lessonId: f.lesson.id,
              eventType: "ended",
              positionSeconds: 600,
            }),
          });
    const result =
      kind === "completion"
        ? await completeLesson(f.db, request, f.target, completionForm())
        : await recordVideoEvent(f.db, request);
    expect(result).toEqual({ success: true });
  }
);

it("upgrades an existing in-progress record without changing other people's completion or other lesson history", async () => {
  await f.enroll();
  await f.privateData();
  f.db
    .insert(lessonProgress)
    .values([
      {
        userId: f.user.id,
        lessonId: f.lesson.id,
        status: LessonProgressStatus.InProgress,
      },
      {
        userId: f.instructor.id,
        lessonId: f.lesson.id,
        status: LessonProgressStatus.Completed,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    .run();
  const unrelated = f
    .history()
    .progress.filter(
      (row) => row.userId !== f.user.id || row.lessonId !== f.lesson.id
    );
  await completeLesson(
    f.db,
    await requestFor(f.user.id),
    f.target,
    completionForm()
  );
  expect(
    f
      .history()
      .progress.filter(
        (row) => row.userId !== f.user.id || row.lessonId !== f.lesson.id
      )
  ).toEqual(unrelated);
  expect(
    f
      .history()
      .progress.filter(
        (row) => row.userId === f.user.id && row.lessonId === f.lesson.id
      )
  ).toEqual([
    expect.objectContaining({
      status: "completed",
      completedAt: expect.any(String),
    }),
  ]);
});

it.each([0, -1, 1.5, "2junk", "02", "", Number.MAX_SAFE_INTEGER + 1])(
  "completion rejects malformed lesson ID %s before looking up the course",
  async (lessonId) => {
    const before = snapshot();
    await expect(
      completeLesson(
        f.db,
        await requestFor(f.user.id),
        { slug: "missing", lessonId },
        completionForm()
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(snapshot()).toEqual(before);
  }
);

it("completion validates the entire command before resolving missing targets", async () => {
  for (const pairs of [
    [],
    [["intent", "wrong"]],
    [
      ["intent", "mark-complete"],
      ["intent", "mark-complete"],
    ],
    [
      ["intent", "mark-complete"],
      ["userId", "5"],
    ],
  ]) {
    const form = new FormData();
    for (const [key, value] of pairs) form.append(key, value);
    const before = snapshot();
    await expect(
      completeLesson(
        f.db,
        await requestFor(f.user.id),
        { slug: "missing", lessonId: 999999 },
        form
      )
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(snapshot()).toEqual(before);
  }
});

it.each(["student", "admin"])(
  "completion validates course/section/lesson ancestry before %s permission",
  async (role) => {
    const person = role === "admin" ? f.addPerson(UserRole.Admin) : f.user;
    const foreignCourse = f.db
      .insert(courses)
      .values({
        ...f.course,
        id: undefined,
        title: "Other course",
        slug: "other-course",
      })
      .returning()
      .get();
    const section = f.db
      .insert(modules)
      .values({
        courseId: foreignCourse.id,
        title: "Other section",
        position: 0,
      })
      .returning()
      .get();
    const foreignLesson = f.db
      .insert(lessons)
      .values({ moduleId: section.id, title: "Other lesson", position: 0 })
      .returning()
      .get();
    const before = snapshot();
    for (const target of [
      { slug: f.course.slug, lessonId: foreignLesson.id },
      { slug: "missing-course", lessonId: f.lesson.id },
      { slug: f.course.slug, lessonId: 999999 },
    ]) {
      await expect(
        completeLesson(
          f.db,
          await requestFor(person.id),
          target,
          completionForm()
        )
      ).rejects.toMatchObject({ init: { status: 404 } });
      expect(snapshot()).toEqual(before);
    }
  }
);

it("video derives permission from its actual lesson's course despite an Enrollment elsewhere", async () => {
  await f.enroll();
  const foreignCourse = f.db
    .insert(courses)
    .values({
      ...f.course,
      id: undefined,
      title: "Other course",
      slug: "other-course",
    })
    .returning()
    .get();
  const section = f.db
    .insert(modules)
    .values({ courseId: foreignCourse.id, title: "Other section", position: 0 })
    .returning()
    .get();
  const foreignLesson = f.db
    .insert(lessons)
    .values({ moduleId: section.id, title: "Other lesson", position: 0 })
    .returning()
    .get();
  const before = snapshot();
  await expect(
    recordVideoEvent(
      f.db,
      await videoRequest(f.user.id, {
        lessonId: foreignLesson.id,
        eventType: "play",
        positionSeconds: 0,
      })
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  expect(snapshot()).toEqual(before);
});

it.each([
  null,
  [],
  {},
  { lessonId: -1 },
  { lessonId: "2junk" },
  { lessonId: 999999, eventType: "unknown", positionSeconds: 2 },
  { lessonId: 999999, eventType: "play", positionSeconds: -1 },
  { lessonId: 999999, eventType: "play", positionSeconds: "2" },
  { lessonId: 999999, eventType: "play", positionSeconds: null },
  { lessonId: 999999, eventType: "play", positionSeconds: 2, userId: 5 },
])(
  "video rejects malformed commands before target resolution: %j",
  async (input) => {
    const before = snapshot();
    await expect(
      recordVideoEvent(f.db, await videoRequest(f.user.id, input))
    ).rejects.toMatchObject({ init: { status: 400 } });
    expect(snapshot()).toEqual(before);
  }
);

it("video authenticates before parsing invalid JSON and resolves missing lessons before checking permission", async () => {
  const before = snapshot();
  for (const userId of [null, 999999, f.user.id]) {
    const session = await requestFor(userId);
    const request = new Request("http://localhost/api/video-tracking", {
      method: "POST",
      headers: session.headers,
      body: "{",
    });
    await expect(recordVideoEvent(f.db, request)).rejects.toMatchObject({
      init: { status: userId === f.user.id ? 400 : 401 },
    });
  }
  for (const person of [f.user, f.addPerson(UserRole.Admin)]) {
    await expect(
      recordVideoEvent(
        f.db,
        await videoRequest(person.id, {
          lessonId: 999999,
          eventType: "play",
          positionSeconds: 0,
        })
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  }
  expect(snapshot()).toEqual(before);
});

it.each(activities)(
  "%s accepts a qualifying Claimed Seat alongside a blocked Individual Purchase",
  async (kind) => {
    const buyer = f.addPerson();
    const team = f.db.insert(teams).values({}).returning().get();
    const purchase = f.purchase("US", buyer.id);
    f.db
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: f.course.id,
        purchaseId: purchase.id,
        code: "activity-seat",
      })
      .run();
    const claimed = await claimSeat(
      f.db,
      "activity-seat",
      f.user.id,
      "US",
      new Date(),
      f.notifications
    );
    expect(claimed.ok).toBe(true);
    f.purchase("IN");
    f.notifications.sent.length = 0;
    expect(await activity(kind, f.user.id)).toEqual({ success: true });
    expect(f.notifications.sent).toEqual([]);
  }
);
