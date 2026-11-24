import { data } from "react-router";
import { z } from "zod";
import { toggleBookmark } from "~/lib/bookmarks.server";
import { saveNote } from "~/lib/notes.server";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import {
  getCoursePermissions,
  requireCurrentPerson,
} from "~/modules/course-permissions/index.server";
import { resolveLessonTarget, type LessonDatabase } from "./targets.server";

const commandSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("save-note"),
      body: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
    })
    .strict(),
  z.object({ intent: z.literal("toggle-bookmark") }).strict(),
]);

export async function updateLessonPersonalData(
  db: LessonDatabase,
  request: Request,
  input: unknown,
  form: FormData
) {
  const person = await requireCurrentPerson(db, request);
  const parsed = commandSchema.safeParse(Object.fromEntries(form));
  if (
    !parsed.success ||
    [...form.keys()].some((key) => form.getAll(key).length !== 1)
  ) {
    throw data("Invalid personal lesson command", { status: 400 });
  }
  const { course, lesson } = resolveLessonTarget(db, input);
  const permission = await getCoursePermissions(db, request, course.id);
  if (!permission.canViewContent)
    throw data("Course permission is required", { status: 403 });
  if (parsed.data.intent === "toggle-bookmark") {
    return {
      ok: true,
      bookmarked: toggleBookmark(db, person.id, lesson.id, new Date()),
    };
  }
  const result = saveNote(
    db,
    person.id,
    lesson.id,
    parsed.data.body,
    new Date()
  );
  if (!result.ok) throw data(result.error, { status: 400 });
  return { ok: true };
}
