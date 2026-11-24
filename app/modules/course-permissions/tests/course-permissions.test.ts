import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireCurrentPerson } from "~/lib/current-person.server";
import {
  getCoursePermissions,
  requireCourseManagement,
  requireInstructorOrAdmin,
} from "~/modules/course-permissions/index.server";
import { eq } from "drizzle-orm";
import { coupons, courses, users, UserRole } from "~/db/schema";
import {
  approveRefundRequest,
  declineRefundRequest,
  raiseRefundRequest,
} from "~/lib/refunds.server";
import { claimSeat } from "~/lib/seat-claims.server";
import { permissionFixture, requestFor, NOW } from "./fixtures";

let f: ReturnType<typeof permissionFixture>;
beforeEach(() => {
  f = permissionFixture();
});
afterEach(() => {
  f.db.$client.close();
});

describe("Student country qualification", () => {
  it("excludes an Approved Purchase without restoring Enrollment and permits later Enrollment without evidence", async () => {
    await f.enroll();
    const purchase = f.purchase("IN");
    const raised = await raiseRefundRequest(
      f.db,
      purchase.id,
      f.user.id,
      "Refund please",
      NOW,
      f.notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    expect(
      await approveRefundRequest(
        f.db,
        raised.refundRequestId,
        f.addPerson(UserRole.Admin).id,
        null,
        NOW,
        f.notifications
      )
    ).toMatchObject({ ok: true });

    const request = await requestFor(f.user.id);
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ enrolled: false, canParticipate: false });
    await f.enroll();
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({
      enrolled: true,
      canParticipate: true,
      pppBlocked: false,
    });
  });
  it("keeps Enrollment-only permission when the Student bought a Team Licence for others", async () => {
    await f.enroll();
    f.teamLicence("IN", f.user.id);

    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({
      enrolled: true,
      canParticipate: true,
      pppBlocked: false,
    });
  });
  it("applies the Team Licence country restriction to a Claimed Seat", async () => {
    const { seat } = f.teamLicence("IN");
    expect(
      await claimSeat(f.db, seat.code, f.user.id, "IN", NOW, f.notifications)
    ).toMatchObject({ ok: true });

    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({
      enrolled: true,
      canParticipate: false,
      canViewContent: false,
      pppBlocked: true,
      pppPurchaseCountry: "IN",
    });
  });
  it("accepts a passing Individual Purchase alongside a blocked Purchase", async () => {
    await f.enroll();
    f.purchase("IN");
    f.purchase("US");

    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({
      enrolled: true,
      canParticipate: true,
      canViewContent: true,
      pppBlocked: false,
    });
  });
});

describe("live identity", () => {
  it.each([null, 999999])(
    "rejects absent or stale identity %s before protected work",
    async (userId) => {
      const request = await requestFor(userId);
      expect(
        await getCoursePermissions(f.db, request, f.course.id)
      ).toMatchObject({
        userId: null,
        canViewContent: false,
        canParticipate: false,
        isStaff: false,
      });
      await expect(requireCurrentPerson(f.db, request)).rejects.toMatchObject({
        init: { status: 401 },
      });
    }
  );
});

describe("protected permission entry points", () => {
  it("checks live identity, identifier, existing course, then permission", async () => {
    const student = await requestFor(f.user.id);
    const admin = await requestFor(f.addPerson(UserRole.Admin).id);
    for (const guard of [requireCourseManagement]) {
      await expect(
        guard(f.db, await requestFor(999999), -1)
      ).rejects.toMatchObject({ init: { status: 401 } });
      await expect(guard(f.db, student, -1)).rejects.toMatchObject({
        init: { status: 400 },
      });
      await expect(guard(f.db, admin, 999999)).rejects.toMatchObject({
        init: { status: 404 },
      });
      await expect(guard(f.db, student, f.course.id)).rejects.toMatchObject({
        init: { status: 403 },
      });
      expect(await guard(f.db, admin, f.course.id)).toMatchObject({
        isAdmin: true,
        canViewContent: true,
      });
    }
  });

  it("requires a live Instructor or Platform Admin for aggregate operations", async () => {
    await expect(
      requireInstructorOrAdmin(f.db, await requestFor(999999))
    ).rejects.toMatchObject({ init: { status: 401 } });
    await expect(
      requireInstructorOrAdmin(f.db, await requestFor(f.user.id))
    ).rejects.toMatchObject({ init: { status: 403 } });
    expect(
      await requireInstructorOrAdmin(f.db, await requestFor(f.instructor.id))
    ).toMatchObject({ userId: f.instructor.id, isAdmin: false });
    const admin = f.addPerson(UserRole.Admin);
    expect(
      await requireInstructorOrAdmin(f.db, await requestFor(admin.id))
    ).toMatchObject({ userId: admin.id, isAdmin: true });
  });
});

describe("current roles and Student participation", () => {
  it.each([
    { role: UserRole.Student, owner: false, staff: false },
    { role: UserRole.Instructor, owner: false, staff: false },
    { role: UserRole.Student, owner: true, staff: false },
    { role: UserRole.Instructor, owner: true, staff: true },
    { role: UserRole.Admin, owner: false, staff: true },
  ])(
    "requires current role and ownership for $role owner=$owner",
    async ({ role, owner, staff }) => {
      const person = owner ? f.instructor : f.addPerson(role);
      f.db.update(users).set({ role }).where(eq(users.id, person.id)).run();
      const request = await requestFor(person.id);
      expect(
        await getCoursePermissions(f.db, request, f.course.id)
      ).toMatchObject({
        canViewContent: staff,
        canParticipate: false,
        isStaff: staff,
        isOwningInstructor: owner && role === UserRole.Instructor,
      });

      await f.enroll(person.id);
      f.purchase("IN", person.id);
      expect(
        await getCoursePermissions(f.db, request, f.course.id)
      ).toMatchObject({
        enrolled: true,
        pppBlocked: true,
        canViewContent: staff,
        canParticipate: false,
      });
    }
  );

  it("rechecks a demoted owner's role while preserving ordinary Student qualification", async () => {
    const request = await requestFor(f.instructor.id);
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ isStaff: true, canViewContent: true });
    f.db
      .update(users)
      .set({ role: UserRole.Student })
      .where(eq(users.id, f.instructor.id))
      .run();
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ isStaff: false, canViewContent: false });
    await f.enroll(f.instructor.id);
    f.purchase("US", f.instructor.id);
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({
      isStaff: false,
      canViewContent: true,
      canParticipate: true,
    });
    await expect(
      requireCourseManagement(f.db, request, f.course.id)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it.each([UserRole.Instructor, UserRole.Admin])(
    "permits qualified %s participation independently of staff reading",
    async (role) => {
      const person =
        role === UserRole.Instructor ? f.instructor : f.addPerson(role);
      await f.enroll(person.id);
      f.purchase("US", person.id);
      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(person.id),
          f.course.id
        )
      ).toMatchObject({
        isStaff: true,
        canViewContent: true,
        canParticipate: true,
      });
    }
  );
});

describe("country calculation compatibility", () => {
  it.each([
    { purchase: "IN", current: "IN", blocked: false },
    { purchase: "IN", current: "PL", blocked: true },
    { purchase: "PL", current: "US", blocked: true },
    { purchase: "NG", current: "US", blocked: true },
    { purchase: "US", current: "IN", blocked: false },
    { purchase: null, current: "US", blocked: false },
    { purchase: "ZZ", current: "US", blocked: false },
    { purchase: "IN", current: null, blocked: false },
    { purchase: "IN", current: "XX", blocked: false },
  ])(
    "preserves purchase=$purchase current=$current",
    async ({ purchase, current, blocked }) => {
      await f.enroll();
      f.purchase(purchase);
      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(f.user.id, current),
          f.course.id
        )
      ).toMatchObject({
        pppBlocked: blocked,
        canParticipate: !blocked,
        canViewContent: !blocked,
      });
    }
  );

  it("uses the current course price and PPP setting", async () => {
    await f.enroll();
    f.purchase("IN");
    const request = await requestFor(f.user.id);
    f.db
      .update(courses)
      .set({ price: 0 })
      .where(eq(courses.id, f.course.id))
      .run();
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ canParticipate: true });
    f.db
      .update(courses)
      .set({ price: 7900, pppEnabled: false })
      .where(eq(courses.id, f.course.id))
      .run();
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ canParticipate: true });
    f.db
      .update(courses)
      .set({ pppEnabled: true })
      .where(eq(courses.id, f.course.id))
      .run();
    expect(
      await getCoursePermissions(f.db, request, f.course.id)
    ).toMatchObject({ canParticipate: false });
  });

  it("prioritizes the real session country over the header and uppercases both", async () => {
    await f.enroll();
    f.purchase("IN");
    expect(
      await getCoursePermissions(
        f.db,
        await requestFor(f.user.id, "US", "in"),
        f.course.id
      )
    ).toMatchObject({ canParticipate: true });
    expect(
      await getCoursePermissions(
        f.db,
        await requestFor(f.user.id, "in"),
        f.course.id
      )
    ).toMatchObject({ canParticipate: true });
    expect(
      await getCoursePermissions(
        f.db,
        await requestFor(f.user.id, "IN", "us"),
        f.course.id
      )
    ).toMatchObject({ canParticipate: false, pppBlockedCountry: "US" });
  });
});

describe("overlapping evidence and Enrollment authority", () => {
  it.each([
    { purchases: [], seats: [], permitted: true },
    { purchases: ["IN", "PL"], seats: [], permitted: false },
    { purchases: ["US", "IN"], seats: [], permitted: true },
    { purchases: [], seats: ["US"], permitted: true },
    { purchases: [], seats: ["IN", "PL"], permitted: false },
    { purchases: [], seats: ["IN", "US"], permitted: true },
    { purchases: ["IN"], seats: ["US"], permitted: true },
    { purchases: ["US"], seats: ["IN"], permitted: true },
    { purchases: ["IN"], seats: ["PL"], permitted: false },
  ])(
    "evaluates Purchases $purchases and Claimed Seats $seats",
    async ({ purchases, seats, permitted }) => {
      await f.enroll();
      for (const country of purchases) f.purchase(country);
      for (const country of seats) f.historicalClaim(country);
      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(f.user.id),
          f.course.id
        )
      ).toMatchObject({
        enrolled: true,
        canParticipate: permitted,
        canViewContent: permitted,
      });
    }
  );

  it.each(["empty", "purchase", "seat"])(
    "never grants missing Enrollment from %s evidence",
    async (evidence) => {
      if (evidence === "purchase") f.purchase("US");
      if (evidence === "seat") f.historicalClaim("US");
      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(f.user.id),
          f.course.id
        )
      ).toMatchObject({
        enrolled: false,
        canParticipate: false,
        canViewContent: false,
      });
    }
  );

  it("ignores unrelated Purchases and Seats while preserving an existing blocked restriction", async () => {
    await f.enroll();
    f.purchase("IN");
    const otherCourse = f.otherCourse();
    f.purchase("US", f.user.id, otherCourse.id);
    f.purchase("US", f.addPerson().id);
    f.historicalClaim("US", f.user.id, otherCourse.id);
    f.historicalClaim("US", f.addPerson().id);
    f.teamLicence("US", f.user.id);
    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({ canParticipate: false, pppBlocked: true });
  });

  it.each(["unclaimed", "refunded", "mismatched-course"])(
    "excludes a %s Seat from surviving evidence",
    async (invalidity) => {
      await f.enroll();
      f.purchase("IN");
      const { seat } = f.historicalClaim("US");
      if (invalidity === "unclaimed")
        f.db
          .update(coupons)
          .set({ redeemedAt: null })
          .where(eq(coupons.id, seat.id))
          .run();
      if (invalidity === "refunded")
        f.db
          .update(coupons)
          .set({ refundedAt: NOW.toISOString() })
          .where(eq(coupons.id, seat.id))
          .run();
      if (invalidity === "mismatched-course")
        f.db
          .update(coupons)
          .set({ courseId: f.otherCourse().id })
          .where(eq(coupons.id, seat.id))
          .run();
      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(f.user.id),
          f.course.id
        )
      ).toMatchObject({ canParticipate: false, pppBlocked: true });
    }
  );
});

describe("Refund Request qualification", () => {
  async function raise(purchase: { id: number; userId: number }) {
    const raised = await raiseRefundRequest(
      f.db,
      purchase.id,
      purchase.userId,
      "Refund please",
      NOW,
      f.notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    return raised.refundRequestId;
  }

  it.each([
    { country: "IN", permitted: false },
    { country: "US", permitted: true },
  ])(
    "keeps $country Purchase evidence through Open and Declined requests",
    async ({ country, permitted }) => {
      await f.enroll();
      const purchase = f.purchase(country);
      const refundRequestId = await raise(purchase);
      const request = await requestFor(f.user.id);
      expect(
        await getCoursePermissions(f.db, request, f.course.id)
      ).toMatchObject({ enrolled: true, canParticipate: permitted });
      expect(
        await declineRefundRequest(
          f.db,
          refundRequestId,
          f.addPerson(UserRole.Admin).id,
          "Still usable",
          NOW,
          f.notifications
        )
      ).toMatchObject({ ok: true });
      expect(
        await getCoursePermissions(f.db, request, f.course.id)
      ).toMatchObject({ enrolled: true, canParticipate: permitted });
    }
  );

  it("does not use an Approved passing Purchase to bypass another surviving restriction after re-enrollment", async () => {
    await f.enroll();
    const passing = f.purchase("US");
    f.purchase("IN");
    expect(
      await approveRefundRequest(
        f.db,
        await raise(passing),
        f.addPerson(UserRole.Admin).id,
        null,
        NOW,
        f.notifications
      )
    ).toMatchObject({ ok: true });
    await f.enroll();

    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({
      enrolled: true,
      canParticipate: false,
      pppBlocked: true,
      pppPurchaseCountry: "IN",
    });
  });

  it.each([
    { seatCountry: "US", purchaseCountry: "IN", permitted: true },
    { seatCountry: "IN", purchaseCountry: "US", permitted: false },
  ])(
    "evaluates the surviving $seatCountry Claimed Seat when an Individual Purchase is approved",
    async ({ seatCountry, purchaseCountry, permitted }) => {
      const { seat } = f.teamLicence(seatCountry);
      expect(
        await claimSeat(
          f.db,
          seat.code,
          f.user.id,
          seatCountry,
          NOW,
          f.notifications
        )
      ).toMatchObject({ ok: true });
      const purchase = f.purchase(purchaseCountry);
      expect(
        await approveRefundRequest(
          f.db,
          await raise(purchase),
          f.addPerson(UserRole.Admin).id,
          null,
          NOW,
          f.notifications
        )
      ).toMatchObject({ ok: true });

      expect(
        await getCoursePermissions(
          f.db,
          await requestFor(f.user.id),
          f.course.id
        )
      ).toMatchObject({
        enrolled: true,
        canParticipate: permitted,
        canViewContent: permitted,
      });
    }
  );

  it("excludes a refunded Team Licence as the buyer's evidence even though its Seats remain in history", async () => {
    await f.enroll();
    const { purchase } = f.teamLicence("IN", f.user.id);
    expect(
      await approveRefundRequest(
        f.db,
        await raise(purchase),
        f.addPerson(UserRole.Admin).id,
        null,
        NOW,
        f.notifications
      )
    ).toMatchObject({ ok: true });
    expect(
      await getCoursePermissions(f.db, await requestFor(f.user.id), f.course.id)
    ).toMatchObject({ enrolled: true, canParticipate: true });
  });
});
