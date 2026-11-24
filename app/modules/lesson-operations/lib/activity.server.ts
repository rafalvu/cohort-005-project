import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import {
  lessonProgress,
  LessonProgressStatus,
  videoWatchEvents,
} from "~/db/schema";
import { requireCurrentPerson } from "~/lib/current-person.server";
import { getCoursePermissions } from "~/modules/course-permissions/index.server";
import {
  positiveIdSchema,
  resolveLessonById,
  resolveLessonTarget,
  type LessonDatabase,
} from "./targets.server";

const completionSchema = z
  .object({ intent: z.literal("mark-complete") })
  .strict();

export async function completeLesson(
  db: LessonDatabase,
  request: Request,
  input: unknown,
  form: FormData
) {
  const person = await requireCurrentPerson(db, request);
  const parsed = completionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success || form.getAll("intent").length !== 1) {
    throw data("Invalid completion command", { status: 400 });
  }
  const { course, lesson } = resolveLessonTarget(db, input);
  const permission = await getCoursePermissions(db, request, course.id);
  if (!permission.canParticipate) {
    throw data("Student permission is required for lesson activity", {
      status: 403,
    });
  }
  db.transaction((tx) => {
    const existing = tx
      .select({ id: lessonProgress.id })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, person.id),
          eq(lessonProgress.lessonId, lesson.id)
        )
      )
      .get();
    const completed = {
      status: LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    };
    if (existing) {
      tx.update(lessonProgress)
        .set(completed)
        .where(eq(lessonProgress.id, existing.id))
        .run();
    } else {
      tx.insert(lessonProgress)
        .values({ userId: person.id, lessonId: lesson.id, ...completed })
        .run();
    }
  });
  return { success: true };
}

const videoEventSchema = z
  .object({
    lessonId: positiveIdSchema,
    eventType: z.enum(["play", "pause", "progress", "ended"]),
    positionSeconds: z.number().finite().nonnegative(),
  })
  .strict();

export async function recordVideoEvent(db: LessonDatabase, request: Request) {
  const person = await requireCurrentPerson(db, request);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw data("Invalid video event", { status: 400 });
  }
  const parsed = videoEventSchema.safeParse(input);
  if (!parsed.success) throw data("Invalid video event", { status: 400 });
  const { lessonId, eventType, positionSeconds } = parsed.data;
  const { course, lesson } = resolveLessonById(db, lessonId);
  const permission = await getCoursePermissions(db, request, course.id);
  if (!permission.canParticipate) {
    throw data("Student permission is required for lesson activity", {
      status: 403,
    });
  }
  db.insert(videoWatchEvents)
    .values({
      userId: person.id,
      lessonId: lesson.id,
      eventType,
      positionSeconds,
    })
    .run();
  return { success: true };
}
