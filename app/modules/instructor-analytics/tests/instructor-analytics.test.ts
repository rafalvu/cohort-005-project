import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  getInstructorAnalytics,
  type AnalyticsInput,
} from "../index.server";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const RECENT = "2026-06-14T12:00:00.000Z";
let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

afterEach(() => {
  db.$client.close();
});

function analytics(params = "", overrides: Partial<AnalyticsInput> = {}) {
  return getInstructorAnalytics(db, {
    viewer: { userId: base.instructor.id, isAdmin: false },
    searchParams: new URLSearchParams(params),
    now: NOW,
    ...overrides,
  });
}

describe("Instructor analytics", () => {
  it("returns an empty dashboard with safe defaults and selectable unsold courses", () => {
    const result = analytics();
    expect(result).toMatchObject({
      tab: "overview",
      range: "30d",
      isAdmin: false,
      instructorId: base.instructor.id,
      selectedCourseId: null,
      summary: { grossCents: 0, feeCents: 0, netCents: 0, purchaseCount: 0 },
      questions: { inRange: 0, older: 0 },
      audience: {
        buyerCount: 0,
        studentCount: 0,
        revenuePerStudentCents: null,
      },
      ratings: { average: null, count: 0 },
      courses: [],
      buyers: [],
      instructors: [],
      courseOptions: [{ courseId: base.course.id, title: base.course.title }],
      progress: null,
      funnel: null,
      quizzes: null,
      countries: null,
      unpublished: false,
      refundExposure: {
        grossCents: 0,
        netCents: 0,
        purchaseCount: 0,
        sharePercent: 0,
        closingTodayCount: 0,
        courses: [],
      },
    });
    expect(result.series.granularity).toBe("day");
    expect(result.series.points).toHaveLength(31);
    expect(result.series.points[0]).toEqual({
      bucket: "2026-05-16",
      grossCents: 0,
      netCents: 0,
    });
    expect(result.series.points.at(-1)).toEqual({
      bucket: "2026-06-15",
      grossCents: 0,
      netCents: 0,
    });
  });
});

let sequence = 0;
function person(role = schema.UserRole.Student) {
  const id = ++sequence;
  return db
    .insert(schema.users)
    .values({ name: `Person ${id}`, email: `person${id}@example.com`, role })
    .returning()
    .get();
}
function course(overrides: Partial<typeof schema.courses.$inferInsert> = {}) {
  const id = ++sequence;
  return db
    .insert(schema.courses)
    .values({
      title: `Course ${id}`,
      slug: `course-${id}`,
      description: "Course",
      salesCopy: base.course.salesCopy,
      categoryId: base.category.id,
      instructorId: base.instructor.id,
      status: schema.CourseStatus.Published,
      ...overrides,
    })
    .returning()
    .get();
}
function purchase(
  overrides: Partial<typeof schema.purchases.$inferInsert> = {}
) {
  return db
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 10000,
      createdAt: RECENT,
      ...overrides,
    })
    .returning()
    .get();
}
function enroll(
  userId = base.user.id,
  courseId = base.course.id,
  enrolledAt = RECENT
) {
  return db
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt })
    .returning()
    .get();
}
function lesson(courseId = base.course.id) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 0 })
    .returning()
    .get();
  return db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 0 })
    .returning()
    .get();
}
function question(
  lessonId: number,
  overrides: Partial<typeof schema.comments.$inferInsert> = {}
) {
  return db
    .insert(schema.comments)
    .values({
      lessonId,
      userId: base.user.id,
      body: base.course.salesCopy,
      createdAt: RECENT,
      ...overrides,
    })
    .returning()
    .get();
}

describe("viewer scope and URL filters", () => {
  it("pins Instructors to their own figures even when both URL ids target somebody else", () => {
    const other = person(schema.UserRole.Instructor);
    const otherCourse = course({ instructorId: other.id });
    purchase({ courseId: otherCourse.id, amountPaid: 90000 });
    enroll(base.user.id, otherCourse.id);
    question(lesson(otherCourse.id).id);
    db.insert(schema.courseRatings)
      .values({
        userId: base.user.id,
        courseId: otherCourse.id,
        rating: 5,
        createdAt: RECENT,
      })
      .run();
    purchase({ amountPaid: 3333 });
    const result = analytics(
      `instructor=${other.id}&course=${otherCourse.id}&tab=course`
    );
    expect(result).toMatchObject({
      instructorId: base.instructor.id,
      selectedCourseId: null,
      tab: "course",
      summary: {
        grossCents: 3333,
        feeCents: 667,
        netCents: 2666,
        purchaseCount: 1,
      },
      audience: {
        buyerCount: 1,
        studentCount: 0,
        revenuePerStudentCents: null,
      },
      ratings: { count: 0, average: null },
      questions: { inRange: 0, older: 0 },
      instructors: [],
      progress: null,
      funnel: null,
      quizzes: null,
      countries: null,
      refundExposure: { grossCents: 3333, purchaseCount: 1 },
    });
    expect(result.courseOptions).toEqual([
      { courseId: base.course.id, title: base.course.title },
    ]);
    expect(result.courses.map((c) => c.courseId)).toEqual([base.course.id]);
    expect(result.buyers[0].spendCents).toBe(3333);
    expect(
      result.series.points.find((p) => p.bucket === "2026-06-14")?.grossCents
    ).toBe(3333);
  });

  it("lets Platform Admins view platform totals or filter to one owner, including a Platform Admin owner", () => {
    const admin = person(schema.UserRole.Admin);
    const adminCourse = course({ instructorId: admin.id });
    const nonOwner = person(schema.UserRole.Instructor);
    purchase();
    purchase({ courseId: adminCourse.id, amountPaid: 20000 });
    const viewer = { userId: admin.id, isAdmin: true };
    const all = analytics("range=all", { viewer });
    expect(all.instructorId).toBeNull();
    expect(all.summary.grossCents).toBe(30000);
    expect(all.instructors.map((i) => i.id).sort()).toEqual(
      [base.instructor.id, admin.id].sort()
    );
    expect(all.instructors.map((i) => i.id)).not.toContain(nonOwner.id);
    const filtered = analytics(
      `instructor=${admin.id}&course=${adminCourse.id}`,
      { viewer }
    );
    expect(filtered.summary.grossCents).toBe(20000);
    expect(filtered.selectedCourseId).toBe(adminCourse.id);
    expect(filtered.courseOptions).toEqual([
      { courseId: adminCourse.id, title: adminCourse.title },
    ]);
    expect(
      analytics(`instructor=${admin.id}&course=${base.course.id}`, { viewer })
        .selectedCourseId
    ).toBeNull();
  });

  it.each(["", "0", "-1", "1.5", "garbage", "Infinity"])(
    "treats invalid ids %j as no selection and normalizes unknown tabs and ranges",
    (id) => {
      const result = analytics(
        `instructor=${id}&course=${id}&range=garbage&tab=garbage`,
        {
          viewer: { userId: base.instructor.id, isAdmin: true },
        }
      );
      expect(result).toMatchObject({
        instructorId: null,
        selectedCourseId: null,
        range: "30d",
        tab: "overview",
      });
    }
  );

  it("allows a nonexistent owner filter to return an empty dashboard", () => {
    expect(
      analytics("instructor=99999&course=99999", {
        viewer: { userId: base.instructor.id, isAdmin: true },
      })
    ).toMatchObject({
      instructorId: 99999,
      selectedCourseId: null,
      courseOptions: [],
      unpublished: true,
      summary: { grossCents: 0 },
    });
  });

  it("offers unsold draft courses in title order and shows the publishing prompt only for a specific unpublished owner", () => {
    const owner = person(schema.UserRole.Instructor);
    const z = course({
      instructorId: owner.id,
      title: "Zebra",
      status: schema.CourseStatus.Archived,
    });
    const a = course({
      instructorId: owner.id,
      title: "Alpha",
      status: schema.CourseStatus.Draft,
    });
    const viewer = { userId: owner.id, isAdmin: false };
    const result = analytics(`course=${a.id}`, { viewer });
    expect(result.unpublished).toBe(true);
    expect(result.courseOptions.map((c) => c.courseId)).toEqual([a.id, z.id]);
    expect(result.courses).toEqual([]);
    expect(result.selectedCourseId).toBe(a.id);
    expect(
      analytics("", { viewer: { ...viewer, isAdmin: true } }).unpublished
    ).toBe(false);
  });
});

describe("revenue windows and chart buckets", () => {
  it.each([
    ["7d", "2026-06-08T12:00:00.000Z", "2026-06-08T11:59:59.999Z", 8],
    ["30d", "2026-05-16T12:00:00.000Z", "2026-05-16T11:59:59.999Z", 31],
    ["90d", "2026-03-17T12:00:00.000Z", "2026-03-17T11:59:59.999Z", 91],
  ])(
    "includes the exact %s cutoff and fills the complete daily window",
    (range, cutoff, before, buckets) => {
      purchase({ createdAt: before, amountPaid: 90000 });
      purchase({ createdAt: cutoff, amountPaid: 3 });
      purchase({ createdAt: RECENT, amountPaid: 100 });
      const result = analytics(`range=${range}`);
      expect(result.summary).toEqual({
        grossCents: 103,
        feeCents: 21,
        netCents: 82,
        purchaseCount: 2,
      });
      expect(result.courses[0]).toMatchObject(result.summary);
      expect(result.buyers[0]).toMatchObject({
        spendCents: 103,
        purchaseCount: 2,
      });
      expect(result.series.points).toHaveLength(buckets);
      expect(result.series.points[0]).toEqual({
        bucket: cutoff.slice(0, 10),
        grossCents: 3,
        netCents: 2,
      });
      expect(result.series.points[1].grossCents).toBe(0);
      expect(result.series.points.at(-1)?.bucket).toBe("2026-06-15");
    }
  );

  it("uses monthly all-time buckets, filling gaps across years and stopping at the supplied now", () => {
    purchase({ createdAt: "2025-12-31T23:59:00.000Z", amountPaid: 500 });
    purchase({ createdAt: "2026-02-01T00:00:00.000Z", amountPaid: 1500 });
    const result = analytics("range=all", {
      now: new Date("2026-02-28T23:59:59.000Z"),
    });
    expect(result.series).toEqual({
      granularity: "month",
      points: [
        { bucket: "2025-12", grossCents: 500, netCents: 400 },
        { bucket: "2026-01", grossCents: 0, netCents: 0 },
        { bucket: "2026-02", grossCents: 1500, netCents: 1200 },
      ],
    });
  });

  it("returns no all-time buckets when no Purchases exist", () => {
    expect(analytics("range=all").series).toEqual({
      granularity: "month",
      points: [],
    });
  });

  it("ranks course revenue and counts distinct buyers while retaining zero-value Purchases", () => {
    const second = course();
    course();
    purchase({ amountPaid: 0 });
    purchase({ amountPaid: 100 });
    purchase({ courseId: second.id, amountPaid: 500 });
    const result = analytics();
    expect(result.summary.purchaseCount).toBe(3);
    expect(result.audience.buyerCount).toBe(1);
    expect(result.courses.map((c) => [c.courseId, c.grossCents])).toEqual([
      [second.id, 500],
      [base.course.id, 100],
    ]);
  });
});

function seats(
  p: typeof schema.purchases.$inferSelect,
  claimedBy: (number | null)[]
) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.coupons)
    .values(
      claimedBy.map((userId) => ({
        teamId: team.id,
        courseId: p.courseId,
        purchaseId: p.id,
        code: `seat-${++sequence}`,
        redeemedByUserId: userId,
        redeemedAt: userId === null ? null : RECENT,
      }))
    )
    .run();
}

describe("Students, Team Licences, and buyer rankings", () => {
  it("attributes Individual Purchases and fractional Claimed Seats without charging Students for Unclaimed Seats", () => {
    const teamAdmin = person();
    const second = person();
    const third = person();
    const free = person();
    for (const student of [base.user, second, third, free]) enroll(student.id);
    purchase({ amountPaid: 1000, createdAt: "2026-01-01T12:00:00.000Z" });
    const licence = purchase({ userId: teamAdmin.id, amountPaid: 3333 });
    seats(licence, [base.user.id, second.id, third.id, null, null]);
    const result = analytics("range=7d");
    // 1000 + three shares rounded to 667 cents; fourth Student enrolled free.
    expect(result.audience).toEqual({
      buyerCount: 1,
      studentCount: 4,
      revenuePerStudentCents: 750,
    });
    expect(result.summary.grossCents).toBe(3333);
    expect(result.buyers).toEqual([
      {
        userId: teamAdmin.id,
        name: teamAdmin.name,
        email: teamAdmin.email,
        spendCents: 3333,
        purchaseCount: 1,
        seatsBought: 5,
        seatsUnredeemed: 2,
        enrolled: false,
      },
    ]);
  });

  it("sums fractional Seat shares before rounding a Student's attributed revenue", () => {
    enroll();
    const buyer = person();
    seats(purchase({ userId: buyer.id, amountPaid: 100 }), [
      base.user.id,
      null,
      null,
    ]);
    seats(purchase({ userId: buyer.id, amountPaid: 100 }), [
      base.user.id,
      null,
      null,
    ]);
    expect(analytics().audience.revenuePerStudentCents).toBe(67);
  });

  it("does not count a Team Licence as an Individual Purchase when its buyer is also a Student", () => {
    enroll();
    seats(purchase({ amountPaid: 3000 }), [base.user.id, null, null]);
    expect(analytics().audience.revenuePerStudentCents).toBe(1000);
    expect(analytics().buyers[0].enrolled).toBe(true);
  });

  it("counts Students once across courses, filters Enrollment dates, and attributes only the selected Instructor's revenue", () => {
    const second = course();
    enroll();
    enroll(base.user.id, second.id);
    enroll(person().id, base.course.id, "2026-06-08T11:59:59.999Z");
    const atCutoff = person();
    enroll(atCutoff.id, base.course.id, "2026-06-08T12:00:00.000Z");
    const otherCourse = course({
      instructorId: person(schema.UserRole.Instructor).id,
    });
    purchase({ amountPaid: 1000 });
    purchase({ courseId: second.id, amountPaid: 3000 });
    purchase({ courseId: otherCourse.id, amountPaid: 90000 });
    seats(
      purchase({
        courseId: otherCourse.id,
        userId: person().id,
        amountPaid: 90000,
      }),
      [base.user.id]
    );
    expect(analytics("range=7d").audience).toEqual({
      buyerCount: 1,
      studentCount: 2,
      revenuePerStudentCents: 2000,
    });
  });

  it("reports lifetime Enrollment but only in-range Seats on a buyer's ranking", () => {
    enroll(base.user.id, base.course.id, "2020-01-01T12:00:00.000Z");
    seats(
      purchase({ amountPaid: 10000, createdAt: "2020-01-01T12:00:00.000Z" }),
      [null, null]
    );
    purchase({ amountPaid: 500 });
    expect(analytics("range=7d").buyers[0]).toMatchObject({
      spendCents: 500,
      seatsBought: 0,
      seatsUnredeemed: 0,
      enrolled: true,
    });
  });

  it("returns the ten highest-spending buyers in descending order", () => {
    const buyers = Array.from({ length: 12 }, () => person());
    buyers.forEach((buyer, index) =>
      purchase({ userId: buyer.id, amountPaid: (index + 1) * 100 })
    );
    expect(analytics().buyers.map((b) => b.spendCents)).toEqual([
      1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300,
    ]);
    expect(analytics().audience.buyerCount).toBe(12);
  });
});

describe("unanswered Discussion Questions", () => {
  it("splits unanswered Discussion Questions into in-range and older without losing old work", () => {
    const l = lesson();
    question(l.id, { createdAt: "2026-06-08T12:00:00.000Z" });
    question(l.id, { createdAt: "2026-06-08T11:59:59.999Z" });
    expect(analytics("range=7d").questions).toEqual({ inRange: 1, older: 1 });
    expect(analytics("range=all").questions).toEqual({ inRange: 2, older: 0 });
  });

  it("excludes staff-authored, deleted, and staff-answered Discussion Questions", () => {
    const l = lesson();
    const admin = person(schema.UserRole.Admin);
    question(l.id, { userId: admin.id });
    question(l.id, { userId: base.instructor.id });
    question(l.id, { deletedAt: RECENT });
    const instructorAnswered = question(l.id);
    question(l.id, {
      parentId: instructorAnswered.id,
      userId: base.instructor.id,
    });
    const adminAnswered = question(l.id);
    question(l.id, { parentId: adminAnswered.id, userId: admin.id });
    expect(analytics().questions).toEqual({ inRange: 0, older: 0 });
  });

  it("keeps Discussion Questions with deleted staff replies or replies from Students and other Instructors", () => {
    const l = lesson();
    const otherInstructor = person(schema.UserRole.Instructor);
    const q1 = question(l.id);
    question(l.id, {
      parentId: q1.id,
      userId: base.instructor.id,
      deletedAt: RECENT,
    });
    const q2 = question(l.id);
    question(l.id, { parentId: q2.id, userId: base.user.id });
    const q3 = question(l.id);
    question(l.id, { parentId: q3.id, userId: otherInstructor.id });
    expect(analytics().questions).toEqual({ inRange: 3, older: 0 });
  });
});

function progress(
  userId: number,
  lessonId: number,
  status = schema.LessonProgressStatus.Completed
) {
  db.insert(schema.lessonProgress).values({ userId, lessonId, status }).run();
}
function quiz(lessonId: number, title = "Quiz") {
  return db
    .insert(schema.quizzes)
    .values({ lessonId, title, passingScore: 0.8 })
    .returning()
    .get();
}
function attempt(
  quizId: number,
  overrides: Partial<typeof schema.quizAttempts.$inferInsert> = {}
) {
  db.insert(schema.quizAttempts)
    .values({
      quizId,
      userId: base.user.id,
      score: 1,
      passed: true,
      attemptedAt: RECENT,
      ...overrides,
    })
    .run();
}

describe("course progress and drop-off", () => {
  it("returns meaningful empty panels for a selected course without lessons or Students", () => {
    expect(analytics(`course=${base.course.id}`)).toMatchObject({
      progress: {
        enrolledCount: 0,
        totalLessons: 0,
        averageProgressPercent: null,
        finishedCount: 0,
      },
      funnel: { enrolledCount: 0, modules: [] },
      quizzes: [],
      countries: {
        grossCents: 0,
        netCents: 0,
        purchaseCount: 0,
        discountedGrossCents: 0,
        discountedNetCents: 0,
        discountedSharePercent: 0,
        rows: [],
      },
    });
    enroll();
    expect(analytics(`course=${base.course.id}`).progress).toEqual({
      enrolledCount: 1,
      totalLessons: 0,
      averageProgressPercent: null,
      finishedCount: 0,
    });
  });

  it("keeps Students who never started in the average and ignores duplicate completion rows and foreign lessons", () => {
    const l = lesson();
    const secondLesson = db
      .insert(schema.lessons)
      .values({ moduleId: l.moduleId, title: "Second", position: 1 })
      .returning()
      .get();
    const finisher = person();
    const untouched = person();
    const outsider = person();
    const foreignLesson = lesson(course().id);
    enroll(base.user.id, base.course.id, "2020-01-01T12:00:00.000Z");
    enroll(finisher.id);
    enroll(untouched.id);
    progress(base.user.id, l.id);
    progress(base.user.id, l.id);
    progress(
      base.user.id,
      secondLesson.id,
      schema.LessonProgressStatus.InProgress
    );
    progress(base.user.id, foreignLesson.id);
    progress(finisher.id, l.id);
    progress(finisher.id, secondLesson.id);
    progress(outsider.id, l.id);
    const result = analytics(`course=${base.course.id}&range=7d`);
    expect(result.progress).toEqual({
      enrolledCount: 3,
      totalLessons: 2,
      averageProgressPercent: 50,
      finishedCount: 1,
    });
    expect(analytics(`course=${base.course.id}&range=all`).progress).toEqual(
      result.progress
    );
  });

  it("orders the curriculum and counts furthest reach across skipped lessons, excluding unenrolled progress", () => {
    // Insert later modules/lessons first so ordering must come from positions.
    const m2 = db
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Second", position: 2 })
      .returning()
      .get();
    const m1 = db
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "First", position: 1 })
      .returning()
      .get();
    const l3 = db
      .insert(schema.lessons)
      .values({ moduleId: m2.id, title: "Three", position: 1 })
      .returning()
      .get();
    const l2 = db
      .insert(schema.lessons)
      .values({ moduleId: m1.id, title: "Two", position: 2 })
      .returning()
      .get();
    const l1 = db
      .insert(schema.lessons)
      .values({ moduleId: m1.id, title: "One", position: 1 })
      .returning()
      .get();
    const early = person();
    const neverStarted = person();
    enroll();
    enroll(early.id);
    enroll(neverStarted.id);
    progress(base.user.id, l3.id, schema.LessonProgressStatus.InProgress);
    progress(base.user.id, l3.id); // One Student reaching the same lesson twice.
    progress(early.id, l1.id);
    progress(neverStarted.id, l3.id, schema.LessonProgressStatus.NotStarted);
    progress(person().id, l3.id);
    expect(analytics(`course=${base.course.id}`).funnel).toEqual({
      enrolledCount: 3,
      modules: [
        {
          moduleId: m1.id,
          title: "First",
          reachedCount: 2,
          dropWithin: 1,
          lessons: [
            {
              lessonId: l1.id,
              title: "One",
              reachedCount: 2,
              dropFromPrevious: 1,
            },
            {
              lessonId: l2.id,
              title: "Two",
              reachedCount: 1,
              dropFromPrevious: 1,
            },
          ],
        },
        {
          moduleId: m2.id,
          title: "Second",
          reachedCount: 1,
          dropWithin: 0,
          lessons: [
            {
              lessonId: l3.id,
              title: "Three",
              reachedCount: 1,
              dropFromPrevious: 0,
            },
          ],
        },
      ],
    });
  });

  it("returns zero reach and undefined average when lessons exist but nobody enrolled", () => {
    lesson();
    expect(analytics(`course=${base.course.id}`)).toMatchObject({
      progress: {
        enrolledCount: 0,
        totalLessons: 1,
        averageProgressPercent: null,
        finishedCount: 0,
      },
      funnel: {
        enrolledCount: 0,
        modules: [
          {
            reachedCount: 0,
            dropWithin: 0,
            lessons: [{ reachedCount: 0, dropFromPrevious: 0 }],
          },
        ],
      },
    });
  });
});

describe("quiz attempts and ratings", () => {
  it("uses each Student's best in-range attempt and its recorded verdict, keeping unattempted quizzes", () => {
    const l = lesson();
    const q = quiz(l.id);
    const unused = quiz(l.id, "Unattempted");
    attempt(q.id, {
      score: 1,
      passed: true,
      attemptedAt: "2026-06-08T11:59:59.999Z",
    });
    attempt(q.id, { score: 0.4, passed: false });
    // Recorded verdict can differ from the current quiz threshold.
    attempt(q.id, {
      score: 0.6,
      passed: true,
      attemptedAt: "2026-06-08T12:00:00.000Z",
    });
    attempt(q.id, { userId: person().id, score: 0.5, passed: false });
    attempt(quiz(lesson(course().id).id).id);
    expect(analytics(`course=${base.course.id}&range=7d`).quizzes).toEqual([
      {
        quizId: q.id,
        title: q.title,
        moduleTitle: "Module",
        lessonTitle: l.title,
        passingScorePercent: 80,
        studentCount: 2,
        passedCount: 1,
        passRatePercent: 50,
        averageBestScorePercent: 55,
      },
      {
        quizId: unused.id,
        title: unused.title,
        moduleTitle: "Module",
        lessonTitle: l.title,
        passingScorePercent: 80,
        studentCount: 0,
        passedCount: 0,
        passRatePercent: null,
        averageBestScorePercent: null,
      },
    ]);
    expect(
      analytics(`course=${base.course.id}&range=all`).quizzes?.[0]
        .averageBestScorePercent
    ).toBe(75);
  });

  it("rounds ratings to one decimal and filters them by creation time and Instructor", () => {
    const otherCourse = course({
      instructorId: person(schema.UserRole.Instructor).id,
    });
    for (const [rating, createdAt, courseId] of [
      [5, "2026-06-08T12:00:00.000Z", base.course.id],
      [4, RECENT, base.course.id],
      [4, RECENT, base.course.id],
      [1, "2026-06-08T11:59:59.999Z", base.course.id],
      [1, RECENT, otherCourse.id],
    ] as const) {
      db.insert(schema.courseRatings)
        .values({ userId: person().id, courseId, rating, createdAt })
        .run();
    }
    expect(analytics("range=7d").ratings).toEqual({ average: 4.3, count: 3 });
    expect(analytics("range=all").ratings).toEqual({ average: 3.5, count: 4 });
  });
});

describe("country revenue", () => {
  it("groups and ranks countries, including unknown and missing countries, with shares and discounted totals", () => {
    purchase({ amountPaid: 1000, country: "US" });
    purchase({ amountPaid: 500, country: "PL" });
    purchase({
      amountPaid: 500,
      country: "PL",
      createdAt: "2026-06-08T12:00:00.000Z",
    });
    purchase({ amountPaid: 200, country: "XX" });
    purchase({ amountPaid: 300, country: null });
    purchase({
      amountPaid: 90000,
      country: "PL",
      createdAt: "2026-06-08T11:59:59.999Z",
    });
    purchase({ courseId: course().id, amountPaid: 90000 });
    const result = analytics(`course=${base.course.id}&range=7d`).countries!;
    expect(result).toMatchObject({
      grossCents: 2500,
      netCents: 2000,
      purchaseCount: 5,
      discountedGrossCents: 1000,
      discountedNetCents: 800,
      discountedSharePercent: 40,
    });
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((r) => r.grossCents)).toEqual([
      1000, 1000, 300, 200,
    ]);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        {
          country: "US",
          grossCents: 1000,
          netCents: 800,
          purchaseCount: 1,
          sharePercent: 40,
          averagePaidCents: 1000,
          discountPercent: 0,
        },
        {
          country: "PL",
          grossCents: 1000,
          netCents: 800,
          purchaseCount: 2,
          sharePercent: 40,
          averagePaidCents: 500,
          discountPercent: 30,
        },
        {
          country: null,
          grossCents: 300,
          netCents: 240,
          purchaseCount: 1,
          sharePercent: 12,
          averagePaidCents: 300,
          discountPercent: null,
        },
        {
          country: "XX",
          grossCents: 200,
          netCents: 160,
          purchaseCount: 1,
          sharePercent: 8,
          averagePaidCents: 200,
          discountPercent: 0,
        },
      ])
    );
  });

  it("returns zero percentages for zero-price Purchases", () => {
    purchase({ amountPaid: 0, country: "PL" });
    expect(analytics(`course=${base.course.id}`).countries).toMatchObject({
      grossCents: 0,
      discountedSharePercent: 0,
      rows: [{ sharePercent: 0, averagePaidCents: 0, netCents: 0 }],
    });
  });
});

// Construct refund fixtures in local time: this panel deliberately uses local
// calendar days, while the chart fixtures above explicitly exercise UTC days.
function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("refund exposure", () => {
  it("includes the entire fourteenth local day, grouping by course with the most urgent deadline", () => {
    const second = course();
    purchase({ amountPaid: 1000, createdAt: localIso(2026, 6, 1, 23) });
    purchase({ amountPaid: 2000, createdAt: localIso(2026, 6, 10) });
    purchase({ amountPaid: 5000, createdAt: localIso(2026, 5, 31, 23) });
    purchase({
      courseId: second.id,
      amountPaid: 4000,
      createdAt: localIso(2026, 6, 14),
    });
    const now = new Date(2026, 5, 15, 23, 59, 59);
    expect(analytics("range=all", { now }).refundExposure).toEqual({
      grossCents: 7000,
      netCents: 5600,
      purchaseCount: 3,
      sharePercent: 58,
      closingTodayCount: 1,
      courses: [
        {
          courseId: second.id,
          title: second.title,
          grossCents: 4000,
          purchaseCount: 1,
          daysLeft: 13,
        },
        {
          courseId: base.course.id,
          title: base.course.title,
          grossCents: 3000,
          purchaseCount: 2,
          daysLeft: 0,
        },
      ],
    });
    expect(
      analytics("range=all", { now: new Date(2026, 5, 16, 0, 0, 0) })
        .refundExposure
    ).toMatchObject({
      grossCents: 6000,
      purchaseCount: 2,
      closingTodayCount: 0,
    });
  });

  it.each([
    ["month rollover", localIso(2026, 1, 25, 23), new Date(2026, 1, 8, 0)],
    ["leap day", localIso(2024, 2, 15, 23), new Date(2024, 1, 29, 23)],
    ["year rollover", localIso(2025, 12, 25, 23), new Date(2026, 0, 8, 0)],
    ["spring DST", localIso(2026, 3, 20, 23), new Date(2026, 3, 3, 0)],
    ["autumn DST", localIso(2026, 10, 20, 23), new Date(2026, 10, 3, 0)],
  ])("uses calendar days through %s", (_name, purchasedAt, now) => {
    purchase({ createdAt: purchasedAt, amountPaid: 3333 });
    const result = analytics("range=all", { now });
    expect(result.refundExposure).toMatchObject({
      grossCents: 3333,
      netCents: 2666,
      sharePercent: 100,
      closingTodayCount: 1,
      courses: [{ daysLeft: 0 }],
    });
  });

  it("applies the selected revenue window even when an older Purchase is still refundable", () => {
    purchase({ createdAt: "2026-06-07T12:00:00.000Z", amountPaid: 5000 });
    purchase({ createdAt: "2026-06-08T12:00:00.000Z", amountPaid: 1000 });
    expect(analytics("range=7d").refundExposure).toMatchObject({
      grossCents: 1000,
      purchaseCount: 1,
      sharePercent: 100,
    });
    expect(analytics("range=30d").refundExposure).toMatchObject({
      grossCents: 6000,
      purchaseCount: 2,
    });
  });

  it("keeps zero-price Purchases without dividing by zero", () => {
    purchase({ amountPaid: 0 });
    expect(analytics().refundExposure).toMatchObject({
      grossCents: 0,
      netCents: 0,
      purchaseCount: 1,
      sharePercent: 0,
    });
  });

  it("returns zero exposure when all Purchases have expired", () => {
    purchase({ createdAt: "2020-01-01T00:00:00.000Z" });
    expect(analytics("range=all").refundExposure).toEqual({
      grossCents: 0,
      netCents: 0,
      purchaseCount: 0,
      sharePercent: 0,
      closingTodayCount: 0,
      courses: [],
    });
  });
});

describe("explicit dependencies", () => {
  it("uses each supplied database and time independently without mutating the inputs", () => {
    purchase();
    const otherDb = createTestDb();
    try {
      const params = new URLSearchParams("range=7d&tab=course");
      const now = new Date(NOW);
      const input = {
        viewer: { userId: base.instructor.id, isAdmin: false },
        searchParams: params,
        now,
      };
      expect(getInstructorAnalytics(db, input).summary.grossCents).toBe(10000);
      expect(getInstructorAnalytics(otherDb, input).summary.grossCents).toBe(0);
      expect(
        getInstructorAnalytics(db, {
          ...input,
          now: new Date("2026-07-01T12:00:00.000Z"),
        }).summary.grossCents
      ).toBe(0);
      expect(getInstructorAnalytics(db, input).summary.grossCents).toBe(10000);
      expect(params.toString()).toBe("range=7d&tab=course");
      expect(now.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    } finally {
      otherDb.$client.close();
    }
  });

  it("propagates database failures instead of returning a misleading empty dashboard", () => {
    const closed = createTestDb();
    closed.$client.close();
    expect(() =>
      getInstructorAnalytics(closed, {
        viewer: { userId: base.instructor.id, isAdmin: false },
        searchParams: new URLSearchParams(),
        now: NOW,
      })
    ).toThrow();
  });
});
