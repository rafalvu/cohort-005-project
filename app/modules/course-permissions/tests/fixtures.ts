import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { setCurrentUserId, setDevCountry } from "~/lib/session";

export const NOW = new Date("2026-11-23T12:00:00.000Z");

export function permissionFixture() {
  const db = createTestDb();
  const base = seedBaseData(db);
  db.update(schema.courses)
    .set({ price: 7900, pppEnabled: true })
    .where(eq(schema.courses.id, base.course.id))
    .run();
  const notifications = fakeNotifications();

  function addPerson(role = schema.UserRole.Student) {
    return db
      .insert(schema.users)
      .values({
        name: "Another person",
        email: `${crypto.randomUUID()}@example.com`,
        role,
      })
      .returning()
      .get();
  }

  function purchase(
    country: string | null,
    userId = base.user.id,
    courseId = base.course.id
  ) {
    return db
      .insert(schema.purchases)
      .values({
        userId,
        courseId,
        country,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
  }

  function teamLicence(
    country: string | null,
    userId = addPerson().id,
    courseId = base.course.id
  ) {
    const bought = purchase(country, userId, courseId);
    const team = db.insert(schema.teams).values({}).returning().get();
    const seat = db
      .insert(schema.coupons)
      .values({
        purchaseId: bought.id,
        courseId,
        teamId: team.id,
        code: crypto.randomUUID(),
      })
      .returning()
      .get();
    return { purchase: bought, seat };
  }

  // Existing histories may contain overlapping claims; claimSeat correctly refuses a new claim while enrolled.
  function historicalClaim(
    country: string | null,
    studentId = base.user.id,
    courseId = base.course.id
  ) {
    const licence = teamLicence(country, addPerson().id, courseId);
    const seat = db
      .update(schema.coupons)
      .set({ redeemedByUserId: studentId, redeemedAt: NOW.toISOString() })
      .where(eq(schema.coupons.id, licence.seat.id))
      .returning()
      .get();
    return { purchase: licence.purchase, seat };
  }

  function otherCourse() {
    return db
      .insert(schema.courses)
      .values({
        ...base.course,
        id: undefined,
        slug: crypto.randomUUID(),
        price: 7900,
      })
      .returning()
      .get();
  }

  async function enroll(userId = base.user.id, courseId = base.course.id) {
    const result = await enrollStudent(
      db,
      userId,
      courseId,
      NOW,
      notifications
    );
    if (!result.ok) throw new Error(result.error);
    return result.enrollment;
  }

  return {
    db,
    ...base,
    notifications,
    addPerson,
    purchase,
    teamLicence,
    historicalClaim,
    otherCourse,
    enroll,
  };
}

export async function requestFor(
  userId: number | null,
  country: string | null = "US",
  devCountry?: string
) {
  const headers = new Headers();
  if (country) headers.set("CF-IPCountry", country);
  const url = "http://localhost/courses/test-course";
  if (userId !== null) {
    headers.set("Cookie", await setCurrentUserId(new Request(url), userId));
  }
  if (devCountry) {
    headers.set(
      "Cookie",
      await setDevCountry(new Request(url, { headers }), devCountry)
    );
  }
  return new Request(url, { headers });
}
