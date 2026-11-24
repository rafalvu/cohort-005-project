import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { noteBodySchema } from "./bookmarks-notes";
import { plainText } from "~/lib/text";

type Db = BetterSQLite3Database<typeof schema>;

// Callers enforce content access; every read and write is scoped to its owner.
export function getLessonSavedState(
  db: Db,
  studentId: number,
  lessonId: number
) {
  const bookmark = db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .get();
  const note = db
    .select({
      body: notes.body,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();
  return { bookmarked: Boolean(bookmark), note: note ?? null };
}

export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number,
  now: Date
) {
  return db.transaction((tx) => {
    const removed = tx
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
      )
      .returning({ id: bookmarks.id })
      .get();
    if (removed) return false;

    tx.insert(bookmarks)
      .values({ userId: studentId, lessonId, createdAt: now.toISOString() })
      .run();
    return true;
  });
}

export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
) {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Invalid Note.",
    };

  const updatedAt = now.toISOString();
  db.insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: plainText(parsed.data),
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: plainText(parsed.data), updatedAt },
    })
    .run();
  return { ok: true as const };
}

const lessonReference = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseId: courses.id,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

export function getSavedLessons(db: Db, studentId: number) {
  const savedBookmarks = db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...lessonReference,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();

  const savedNotes = db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonReference,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();

  return { savedBookmarks, savedNotes };
}
