import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("~/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const schema = await import("~/db/schema");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  return { db, getSqlite: () => sqlite };
});

import { db, getSqlite } from "~/db";
import * as s from "~/db/schema";
import { listRefundRequests, resolveRefund } from "~/lib/refunds.server";
import { getAccess } from "~/lib/access.server";
import { setCurrentUserId } from "~/lib/session";
import { action as requestRefund } from "~/routes/courses.$slug.refund";
import { action as purchaseCourse } from "~/routes/courses.$slug.purchase";
import {
  loader as lessonLoader,
  action as lessonAction,
} from "~/routes/courses.$slug.lessons.$lessonId";
import { loader as courseLoader } from "~/routes/courses.$slug";
import { loader as moduleLoader } from "~/routes/courses.$slug.$moduleId";
import { action as trackVideo } from "~/routes/api.video-tracking";
import {
  action as adminAction,
  loader as adminLoader,
} from "~/routes/admin.refunds";

async function request(
  userId: number | null,
  form?: Record<string, string>,
  json?: object
) {
  const headers = new Headers({ "CF-IPCountry": "US" });
  if (userId)
    headers.set(
      "Cookie",
      (await setCurrentUserId(new Request("http://localhost"), userId)).split(
        ";"
      )[0]
    );
  if (json) headers.set("Content-Type", "application/json");
  return new Request("http://localhost/courses/course", {
    headers,
    method: form || json ? "POST" : "GET",
    body: json
      ? JSON.stringify(json)
      : form
        ? new URLSearchParams(form)
        : undefined,
  });
}

function args<T>(
  request: Request,
  params = { slug: "course", lessonId: "1", moduleId: "1" }
): T {
  return { request, params, context: {} } as T;
}

beforeEach(() => {
  const sqlite = getSqlite();
  sqlite.pragma("foreign_keys = OFF");
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'"
    )
    .all() as { name: string }[];
  for (const { name } of tables) sqlite.exec(`DELETE FROM "${name}"`);
  sqlite.pragma("foreign_keys = ON");
  db.insert(s.users)
    .values([
      { id: 1, name: "Admin", email: "admin@test.dev", role: s.UserRole.Admin },
      {
        id: 2,
        name: "Learner",
        email: "learner@test.dev",
        role: s.UserRole.Student,
      },
      {
        id: 3,
        name: "Other learner",
        email: "other@test.dev",
        role: s.UserRole.Student,
      },
    ])
    .run();
  db.insert(s.categories)
    .values({ id: 1, name: "Category", slug: "category" })
    .run();
  db.insert(s.courses)
    .values({
      id: 1,
      title: "Course",
      slug: "course",
      description: "Course",
      salesCopy: "Course",
      instructorId: 1,
      categoryId: 1,
      status: s.CourseStatus.Published,
      price: 20000,
      pppEnabled: false,
    })
    .run();
  db.insert(s.modules)
    .values({ id: 1, courseId: 1, title: "Module", position: 1 })
    .run();
  db.insert(s.lessons)
    .values([
      {
        id: 1,
        moduleId: 1,
        title: "Lesson",
        position: 1,
        content: "SECRET_LESSON",
        videoUrl: "https://video.test/secret",
        githubRepoUrl: "https://repo.test/secret",
      },
      {
        id: 2,
        moduleId: 1,
        title: "Next lesson",
        position: 2,
        content: "SECRET_NEXT",
      },
      { id: 3, moduleId: 1, title: "Third lesson", position: 3 },
    ])
    .run();
  db.insert(s.purchases)
    .values({ id: 1, userId: 2, courseId: 1, amountPaid: 12500 })
    .run();
  db.insert(s.enrollments)
    .values([
      { id: 1, userId: 2, courseId: 1 },
      { id: 2, userId: 3, courseId: 1 },
    ])
    .run();
  db.insert(s.refunds)
    .values({ id: 1, purchaseId: 1, reason: "Not the course I needed." })
    .run();
  db.insert(s.lessonProgress)
    .values([
      {
        id: 1,
        userId: 2,
        lessonId: 1,
        status: s.LessonProgressStatus.Completed,
      },
      {
        id: 2,
        userId: 3,
        lessonId: 1,
        status: s.LessonProgressStatus.Completed,
      },
    ])
    .run();
  db.insert(s.quizzes)
    .values({ id: 1, lessonId: 1, title: "Quiz", passingScore: 0.5 })
    .run();
  db.insert(s.quizQuestions)
    .values({
      id: 1,
      quizId: 1,
      questionText: "Question",
      questionType: s.QuestionType.MultipleChoice,
      position: 1,
    })
    .run();
  db.insert(s.quizOptions)
    .values({ id: 1, questionId: 1, optionText: "Answer", isCorrect: true })
    .run();
  db.insert(s.quizAttempts)
    .values({ id: 1, userId: 2, quizId: 1, score: 1, passed: true })
    .run();
  db.insert(s.quizAnswers)
    .values({ id: 1, attemptId: 1, questionId: 1, selectedOptionId: 1 })
    .run();
  db.insert(s.videoWatchEvents)
    .values([
      {
        id: 1,
        userId: 2,
        lessonId: 1,
        eventType: "progress",
        positionSeconds: 120,
      },
      {
        id: 2,
        userId: 2,
        lessonId: 1,
        eventType: "progress",
        positionSeconds: 60,
      },
    ])
    .run();
});

describe("refund review lifecycle", () => {
  it("requires admin authorization on both reads and writes", async () => {
    await expect(listRefundRequests(await request(null))).rejects.toMatchObject(
      { init: { status: 401 } }
    );
    await expect(adminLoader(args(await request(2)))).rejects.toMatchObject({
      init: { status: 403 },
    });
    await expect(
      adminAction(
        args(await request(2, { refundId: "1", decision: "approve" }))
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(db.select().from(s.refunds).get()?.status).toBe(
      s.RefundStatus.Requested
    );
  });

  it("shows current progress and original amount rather than the current price", async () => {
    const [row] = await listRefundRequests(await request(1));
    expect(row.amountPaid).toBe(12500);
    expect(row.progress).toEqual({
      completedLessons: 1,
      totalLessons: 3,
      percentage: 33,
      videoSeconds: 120,
    });
  });

  it("approves once, archives all progress, revokes access and repurchases from zero", async () => {
    const approved = await resolveRefund(await request(1), 1, "approve");
    expect(approved).toMatchObject({
      status: s.RefundStatus.Approved,
      amountApproved: 12500,
      amountRefunded: null,
      resolvedByUserId: 1,
    });
    expect(approved.resolvedAt).toBeTruthy();
    const archive = JSON.parse(
      db.select().from(s.refundProgressArchives).get()!.snapshot
    );
    expect(archive.lessonProgress).toHaveLength(1);
    expect(archive.quizAttempts).toHaveLength(1);
    expect(archive.quizAnswers).toHaveLength(1);
    expect(archive.videoWatchEvents).toHaveLength(2);
    expect(archive.enrollments).toHaveLength(1);
    expect(
      db
        .select()
        .from(s.lessonProgress)
        .where(eq(s.lessonProgress.userId, 2))
        .all()
    ).toEqual([]);
    expect(db.select().from(s.quizAttempts).all()).toEqual([]);
    expect(db.select().from(s.quizAnswers).all()).toEqual([]);
    expect(db.select().from(s.videoWatchEvents).all()).toEqual([]);
    expect((await getAccess(await request(2), 1)).canViewContent).toBe(false);
    expect((await getAccess(await request(3), 1)).canViewContent).toBe(true);
    expect(
      db
        .select()
        .from(s.lessonProgress)
        .where(eq(s.lessonProgress.userId, 3))
        .all()
    ).toHaveLength(1);
    await expect(
      resolveRefund(await request(1), 1, "approve")
    ).rejects.toMatchObject({ init: { status: 409 } });
    await expect(
      resolveRefund(await request(1), 1, "decline")
    ).rejects.toMatchObject({ init: { status: 409 } });
    await expect(
      requestRefund(
        args(await request(2, { reason: "Please refund this course." }))
      )
    ).rejects.toMatchObject({ init: { status: 409 } });
    await expect(
      purchaseCourse(args(await request(2, { intent: "confirm-purchase" })))
    ).rejects.toMatchObject({ status: 302 });
    expect((await getAccess(await request(2), 1)).canViewContent).toBe(true);
    const course = await courseLoader(args(await request(2)));
    expect(course.progress).toBe(0);
    expect(course.lessonProgressMap).toEqual({});
    expect(course.refundOffer?.amount).toBe(20000);
    expect(db.select().from(s.refundProgressArchives).all()).toHaveLength(1);
  });

  it("declines without changing access or progress, and blocks resubmission", async () => {
    await resolveRefund(await request(1), 1, "decline");
    expect(db.select().from(s.refunds).get()).toMatchObject({
      status: s.RefundStatus.Declined,
      amountApproved: null,
      amountRefunded: null,
      resolvedByUserId: 1,
    });
    expect((await getAccess(await request(2), 1)).canViewContent).toBe(true);
    expect(db.select().from(s.lessonProgress).all()).toHaveLength(2);
    expect(db.select().from(s.quizAttempts).all()).toHaveLength(1);
    expect(db.select().from(s.refundProgressArchives).all()).toHaveLength(0);
    await expect(
      requestRefund(
        args(await request(2, { reason: "Please refund this course." }))
      )
    ).rejects.toMatchObject({ init: { status: 409 } });
  });

  it("rolls back the decision and all removals if archiving fails", async () => {
    getSqlite().exec(
      "CREATE TRIGGER fail_archive BEFORE INSERT ON refund_progress_archives BEGIN SELECT RAISE(ABORT, 'archive failed'); END"
    );
    try {
      await expect(
        resolveRefund(await request(1), 1, "approve")
      ).rejects.toThrow("archive failed");
      expect(db.select().from(s.refunds).get()?.status).toBe(
        s.RefundStatus.Requested
      );
      expect(db.select().from(s.lessonProgress).all()).toHaveLength(2);
      expect((await getAccess(await request(2), 1)).canViewContent).toBe(true);
    } finally {
      getSqlite().exec("DROP TRIGGER fail_archive");
    }
  });

  it("excludes team purchases from the queue and rejects forged approvals", async () => {
    db.insert(s.teams).values({ id: 1 }).run();
    db.insert(s.coupons)
      .values({ teamId: 1, courseId: 1, purchaseId: 1, code: "TEAM" })
      .run();
    expect(await listRefundRequests(await request(1))).toEqual([]);
    await expect(
      resolveRefund(await request(1), 1, "approve")
    ).rejects.toMatchObject({ init: { status: 403 } });
    await expect(
      requestRefund(
        args(await request(2, { reason: "Please refund this course." }))
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("blocks lesson content, quiz and progress writes after approval", async () => {
    await resolveRefund(await request(1), 1, "approve");
    const req = await request(2);
    const lesson = await lessonLoader(args(req));
    expect(lesson.canViewContent).toBe(false);
    expect(lesson.contentHtml).toBeNull();
    expect(lesson.lesson.videoUrl).toBeNull();
    expect(lesson.quiz).toBeNull();
    expect(lesson.bestAttempt).toBeNull();
    for (const result of [
      lesson,
      await courseLoader(args(req)),
      await moduleLoader(args(req)),
    ]) {
      expect(JSON.stringify(result)).not.toContain("SECRET_");
      expect(JSON.stringify(result)).not.toContain("https://video.test/secret");
      expect(JSON.stringify(result)).not.toContain("https://repo.test/secret");
    }
    await expect(
      lessonAction(args(await request(2, { intent: "mark-complete" })))
    ).rejects.toMatchObject({ init: { status: 403 } });
    await expect(
      lessonAction(
        args(await request(2, { intent: "submit-quiz", quizId: "1" }))
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    await expect(
      trackVideo(
        args(
          await request(2, undefined, {
            lessonId: 1,
            eventType: "progress",
            positionSeconds: 300,
          })
        )
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(
      db
        .select()
        .from(s.lessonProgress)
        .where(eq(s.lessonProgress.userId, 2))
        .all()
    ).toEqual([]);
  });
});
