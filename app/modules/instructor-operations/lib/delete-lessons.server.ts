import { inArray } from "drizzle-orm";
import {
  bookmarks,
  comments,
  lessons,
  lessonProgress,
  notes,
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  videoWatchEvents,
} from "~/db/schema";
import type { Db } from "./targets.server";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// The caller resolves and authorizes the complete lesson set before entering its transaction.
export function deleteLessons(tx: Transaction, lessonIds: number[]) {
  if (lessonIds.length === 0) return [];
  const quizIds = tx
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(inArray(quizzes.lessonId, lessonIds));
  const questionIds = tx
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(inArray(quizQuestions.quizId, quizIds));
  const attemptIds = tx
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .where(inArray(quizAttempts.quizId, quizIds));
  const commentIds = tx
    .select({ id: comments.id })
    .from(comments)
    .where(inArray(comments.lessonId, lessonIds))
    .all()
    .map((comment) => comment.id);
  tx.delete(quizAnswers)
    .where(inArray(quizAnswers.attemptId, attemptIds))
    .run();
  tx.delete(quizAttempts).where(inArray(quizAttempts.quizId, quizIds)).run();
  tx.delete(quizOptions)
    .where(inArray(quizOptions.questionId, questionIds))
    .run();
  tx.delete(quizQuestions).where(inArray(quizQuestions.quizId, quizIds)).run();
  tx.delete(quizzes).where(inArray(quizzes.lessonId, lessonIds)).run();
  tx.delete(comments).where(inArray(comments.lessonId, lessonIds)).run();
  tx.delete(notes).where(inArray(notes.lessonId, lessonIds)).run();
  tx.delete(bookmarks).where(inArray(bookmarks.lessonId, lessonIds)).run();
  tx.delete(lessonProgress)
    .where(inArray(lessonProgress.lessonId, lessonIds))
    .run();
  tx.delete(videoWatchEvents)
    .where(inArray(videoWatchEvents.lessonId, lessonIds))
    .run();
  tx.delete(lessons).where(inArray(lessons.id, lessonIds)).run();
  return commentIds;
}
