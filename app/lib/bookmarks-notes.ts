import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

export const noteBodySchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, "Note must be 2,000 characters or fewer.");

export const saveNoteSchema = z.object({
  intent: z.literal("save-note"),
  body: noteBodySchema,
});

export const toggleBookmarkSchema = z.object({
  intent: z.literal("toggle-bookmark"),
});
