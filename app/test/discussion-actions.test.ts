import { sql, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestDb, seedDiscussionData } from "./setup";
import {
  comments,
  courses,
  purchases,
  users,
  enrollments,
  UserRole,
} from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { listStoredNotifications } from "~/lib/notifications.server";

const holder = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestDb> | undefined,
}));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));
import {
  action as lessonAction,
  loader as lessonLoader,
} from "~/routes/courses.$slug.lessons.$lessonId";
import {
  action as queueAction,
  loader as queueLoader,
} from "~/routes/instructor.questions";
function database() {
  if (!holder.db) throw new Error("Test database is not initialized");
  return holder.db;
}
let fixture: ReturnType<typeof seedDiscussionData>;
let admins: number[];
beforeEach(() => {
  holder.db = createTestDb();
  fixture = seedDiscussionData(holder.db);
  holder.db
    .insert(enrollments)
    .values({ userId: fixture.user.id, courseId: fixture.course.id })
    .run();
  admins = [1, 2].map(
    (n) =>
      database()
        .insert(users)
        .values({
          name: `Admin ${n}`,
          email: `admin${n}@example.com`,
          role: UserRole.Admin,
        })
        .returning()
        .get().id
  );
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "true");
});
afterEach(() => {
  database().$client.close();
  vi.unstubAllEnvs();
});
async function post(
  actor: number,
  fields: Record<string, string>,
  queue = false,
  slug = fixture.course.slug
) {
  const url = `http://localhost/courses/${slug}/lessons/${fixture.lesson.id}`;
  const cookie = await setCurrentUserId(new Request(url), actor);
  const request = new Request(url, {
    method: "POST",
    headers: { Cookie: cookie, "CF-IPCountry": "US" },
    body: new URLSearchParams(fields),
  });
  const args = {
    request,
    url: new URL(url),
    pattern: queue
      ? "/instructor/questions"
      : "/courses/:slug/lessons/:lessonId",
    params: { slug, lessonId: String(fixture.lesson.id) },
    context: {},
  };
  return queue
    ? queueAction({ ...args, params: {} } as Parameters<typeof queueAction>[0])
    : lessonAction(args as Parameters<typeof lessonAction>[0]);
}
async function discussion() {
  const url = `http://localhost/courses/${fixture.course.slug}/lessons/${fixture.lesson.id}`;
  const cookie = await setCurrentUserId(new Request(url), fixture.instructor.id);
  const result = await lessonLoader({
    request: new Request(url, {
      headers: { Cookie: cookie, "CF-IPCountry": "US" },
    }),
    params: { slug: fixture.course.slug, lessonId: String(fixture.lesson.id) },
    context: {},
  } as Parameters<typeof lessonLoader>[0]);
  return result.comments;
}
function history(userId: number) {
  return listStoredNotifications(database(), { recipientId: userId }).rows;
}
test("a new question notifies every Platform Admin and its owning Instructor", async () => {
  expect(
    await post(fixture.user.id, {
      intent: "create-comment",
      body: "How does this work?",
      operationId: crypto.randomUUID(),
    })
  ).toEqual({ ok: true });
  for (const id of [...admins, fixture.instructor.id])
    expect(history(id).map((n) => n.kind)).toEqual(["question_created"]);
  expect(history(fixture.user.id)).toEqual([]);
});

test.each([false, true])(
  "replies notify accessible participants through queue=%s without adding the owning Instructor",
  async (queue) => {
    const peer = database()
      .insert(users)
      .values({
        name: "Peer",
        email: "peer@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    database()
      .insert(enrollments)
      .values({ userId: peer.id, courseId: fixture.course.id })
      .run();
    await post(peer.id, {
      intent: "create-comment",
      parentId: String(fixture.question.id),
      body: "Peer reply",
      operationId: crypto.randomUUID(),
    });
    expect(history(fixture.user.id).map((n) => n.kind)).toEqual([
      "reply_created",
    ]);
    expect(history(fixture.instructor.id)).toEqual([]);
    await post(
      admins[0],
      {
        intent: queue ? "reply" : "create-comment",
        commentId: String(fixture.question.id),
        parentId: String(fixture.question.id),
        body: "Staff reply",
        operationId: crypto.randomUUID(),
      },
      queue
    );
    expect(history(fixture.user.id)).toHaveLength(2);
    expect(history(peer.id).map((n) => n.kind)).toEqual(["reply_created"]);
    expect(history(admins[1])).toEqual([]);
  }
);

test.each([false, true])(
  "replayed and simultaneous submissions save one source and one event through queue=%s",
  async (queue) => {
    const fields = {
      intent: queue ? "reply" : "create-comment",
      commentId: String(fixture.question.id),
      parentId: String(fixture.question.id),
      body: "Only once",
      operationId: crypto.randomUUID(),
    };
    const results = await Promise.all([
      post(fixture.instructor.id, fields, queue),
      post(fixture.instructor.id, fields, queue),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    await post(fixture.instructor.id, fields, queue);
    expect(history(fixture.user.id)).toHaveLength(1);
    expect(await discussion()).toMatchObject([
      { id: fixture.question.id, replies: [{ body: "Only once" }] },
    ]);
    expect((await discussion())[0].replies).toHaveLength(1);
  }
);

test("lesson action rejects a lesson reached under a different course slug", async () => {
  database()
    .insert(courses)
    .values({
      title: "Other",
      slug: "other",
      description: "Other",
      salesCopy: "Other",
      status: fixture.course.status,
      instructorId: fixture.instructor.id,
      categoryId: fixture.category.id,
    })
    .run();
  await expect(
    post(
      admins[0],
      {
        intent: "create-comment",
        body: "Wrong destination",
        operationId: crypto.randomUUID(),
      },
      false,
      "other"
    )
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(history(admins[1])).toEqual([]);
});

test.each([false, true])(
  "required Notification persistence failure rolls back every recipient and source through queue=%s",
  async (queue) => {
    // Fail after an earlier recipient insert, using the actual SQLite persistence boundary.
    if (queue)
      database()
        .insert(comments)
        .values({
          userId: admins[0],
          lessonId: fixture.lesson.id,
          parentId: fixture.question.id,
          body: "Prior reply",
        })
        .run();
    const before = await discussion();
    const blocked = queue ? admins[0] : admins[1];
    database().run(
      sql.raw(
        `CREATE TRIGGER reject_notification BEFORE INSERT ON notifications WHEN NEW.recipient_id = ${blocked} BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END`
      )
    );
    await expect(
      post(
        fixture.instructor.id,
        {
          intent: queue ? "reply" : "create-comment",
          commentId: String(fixture.question.id),
          body: "Must roll back",
          operationId: crypto.randomUUID(),
        },
        queue
      )
    ).rejects.toThrow();
    expect(await discussion()).toEqual(before);
    for (const id of [...admins, fixture.user.id])
      expect(history(id)).toEqual([]);
  }
);

test.each(["owner", "admin"])(
  "%s questions exclude the actor and do not enter the Instructor queue",
  async (role) => {
    const actor = role === "owner" ? fixture.instructor.id : admins[0];
    await post(actor, {
      intent: "create-comment",
      body: "Staff question",
      operationId: crypto.randomUUID(),
    });
    expect(history(fixture.instructor.id)).toEqual([]);
    for (const id of admins)
      expect(history(id)).toHaveLength(id === actor ? 0 : 1);
  }
);

test("overlapping ownership and Platform Admin role receives only one question update", async () => {
  database()
    .update(users)
    .set({ role: UserRole.Admin })
    .where(eq(users.id, fixture.instructor.id))
    .run();
  await post(fixture.user.id, {
    intent: "create-comment",
    body: "Overlap question",
    operationId: crypto.randomUUID(),
  });
  expect(history(fixture.instructor.id)).toHaveLength(1);
});

test("recipient access uses their Enrollment, ownership and role independently of the actor's country", async () => {
  const lapsed = database()
    .insert(users)
    .values({
      name: "Lapsed",
      email: "lapsed@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
  const otherInstructor = database()
    .insert(users)
    .values({
      name: "Other instructor",
      email: "other-instructor@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();
  for (const userId of [
    lapsed.id,
    otherInstructor.id,
    fixture.instructor.id,
    admins[0],
    fixture.user.id,
    fixture.user.id,
  ])
    database()
      .insert(comments)
      .values({
        userId,
        lessonId: fixture.lesson.id,
        parentId: fixture.question.id,
        body: "Previously participated",
      })
      .run();
  database()
    .update(courses)
    .set({ price: 10000, pppEnabled: true })
    .where(eq(courses.id, fixture.course.id))
    .run();
  database()
    .insert(purchases)
    .values({
      userId: fixture.user.id,
      courseId: fixture.course.id,
      amountPaid: 2000,
      country: "IN",
    })
    .run();
  await post(admins[1], {
    intent: "create-comment",
    parentId: String(fixture.question.id),
    body: "From full-price country",
    operationId: crypto.randomUUID(),
  });
  for (const id of [fixture.user.id, fixture.instructor.id, admins[0]])
    expect(history(id)).toHaveLength(1);
  for (const id of [lapsed.id, otherInstructor.id, admins[1]])
    expect(history(id)).toEqual([]);
});

test.each([false, true])(
  "deleted questions receive no new reply Notifications via queue=%s",
  async (queue) => {
    database()
      .update(comments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(comments.id, fixture.question.id))
      .run();
    await post(
      fixture.instructor.id,
      {
        intent: queue ? "reply" : "create-comment",
        commentId: String(fixture.question.id),
        parentId: String(fixture.question.id),
        body: "Reply to placeholder",
        operationId: crypto.randomUUID(),
      },
      queue
    );
    expect(history(fixture.user.id)).toEqual([]);
  }
);

test("inactive feature preserves discussion posting without producing Notifications", async () => {
  vi.stubEnv("CADENCE_NOTIFICATIONS_ENABLED", "false");
  await post(fixture.user.id, {
    intent: "create-comment",
    body: "Feature off",
    operationId: crypto.randomUUID(),
  });
  for (const id of [...admins, fixture.instructor.id])
    expect(history(id)).toEqual([]);
  expect(await discussion()).toHaveLength(2);
  expect(await discussion()).toEqual(
    expect.arrayContaining([expect.objectContaining({ body: "Feature off" })])
  );
});

test("unauthorized actors and malformed operation identities create no source or Notifications", async () => {
  database().delete(enrollments).run();
  await expect(
    post(fixture.user.id, {
      intent: "create-comment",
      body: "No access",
      operationId: crypto.randomUUID(),
    })
  ).rejects.toMatchObject({ init: { status: 403 } });
  await expect(
    post(
      fixture.user.id,
      {
        intent: "reply",
        commentId: String(fixture.question.id),
        body: "Not staff",
        operationId: crypto.randomUUID(),
      },
      true
    )
  ).rejects.toMatchObject({ init: { status: 403 } });
  await expect(
    post(fixture.instructor.id, {
      intent: "create-comment",
      body: "Missing identity",
    })
  ).rejects.toMatchObject({ init: { status: 400 } });
  expect(await discussion()).toMatchObject([
    { id: fixture.question.id, replies: [] },
  ]);
  expect(await discussion()).toHaveLength(1);
  for (const id of [...admins, fixture.instructor.id])
    expect(history(id)).toEqual([]);
});

test("operation identity conflicts are rejected; different operations stay distinct and replay after edit is harmless", async () => {
  const fields = {
    intent: "create-comment",
    body: "Original",
    operationId: crypto.randomUUID(),
  };
  await post(fixture.user.id, fields);
  await expect(
    post(fixture.user.id, { ...fields, body: "Different payload" })
  ).rejects.toMatchObject({ init: { status: 409 } });
  const question = (await discussion()).find(
    (question) => question.body === "Original"
  );
  if (!question) throw new Error("Created Discussion Question was not visible");
  await post(fixture.user.id, {
    intent: "edit-comment",
    commentId: String(question.id),
    body: "Edited",
  });
  await post(fixture.user.id, fields);
  expect(history(fixture.instructor.id)).toHaveLength(1);
  await post(fixture.user.id, { ...fields, operationId: crypto.randomUUID() });
  expect(history(fixture.instructor.id)).toHaveLength(2);
});

test("deleting a staff reply restores the unanswered queue without a new event", async () => {
  const fields = {
    intent: "reply",
    commentId: String(fixture.question.id),
    body: "Staff answer",
    operationId: crypto.randomUUID(),
  };
  await post(fixture.instructor.id, fields, true);
  const replyId = (await discussion())[0].replies[0].id;
  await post(fixture.instructor.id, {
    intent: "delete-comment",
    commentId: String(replyId),
  });
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    fixture.instructor.id
  );
  const result = await queueLoader({
    request: new Request("http://localhost/instructor/questions", {
      headers: { Cookie: cookie },
    }),
    params: {},
    context: {},
  } as Parameters<typeof queueLoader>[0]);
  expect(result.questions.map((q) => q.id)).toEqual([fixture.question.id]);
  expect(history(fixture.instructor.id)).toEqual([]);
  expect(history(fixture.user.id)).toEqual([]);
  await post(fixture.instructor.id, fields, true);
  expect(await discussion()).toMatchObject([
    { id: fixture.question.id, replies: [] },
  ]);
  expect(await discussion()).toHaveLength(1);
});

test("replaying a lesson reply through the Instructor queue preserves one event", async () => {
  const operationId = crypto.randomUUID();
  await post(fixture.instructor.id, {
    intent: "create-comment",
    parentId: String(fixture.question.id),
    body: "Same reply",
    operationId,
  });
  await post(
    fixture.instructor.id,
    {
      intent: "reply",
      commentId: String(fixture.question.id),
      body: "Same reply",
      operationId,
    },
    true
  );
  expect(history(fixture.user.id)).toHaveLength(1);
  expect(await discussion()).toMatchObject([
    { id: fixture.question.id, replies: [{ body: "Same reply" }] },
  ]);
  expect((await discussion())[0].replies).toHaveLength(1);
});

test("concurrent question submissions notify each recipient only once and can retry after rollback", async () => {
  const fields = {
    intent: "create-comment",
    body: "One new question",
    operationId: crypto.randomUUID(),
  };
  database().run(
    sql.raw(
      "CREATE TRIGGER reject_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'Injected persistence failure'); END"
    )
  );
  await expect(post(fixture.user.id, fields)).rejects.toThrow();
  database().run(sql.raw("DROP TRIGGER reject_notification"));
  await Promise.all([
    post(fixture.user.id, fields),
    post(fixture.user.id, fields),
  ]);
  for (const id of [...admins, fixture.instructor.id])
    expect(history(id)).toHaveLength(1);
  expect(await discussion()).toHaveLength(2);
  expect(await discussion()).toEqual(
    expect.arrayContaining([expect.objectContaining({ body: "One new question" })])
  );
});
