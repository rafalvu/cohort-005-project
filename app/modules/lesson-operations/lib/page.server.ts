import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  lessons,
  modules,
  users,
  lessonProgress,
  LessonProgressStatus,
  videoWatchEvents,
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
} from "~/db/schema";
import { getCoursePermissions } from "~/modules/course-permissions/index.server";
import { getNote } from "~/lib/notes.server";
import { isBookmarked } from "~/lib/bookmarks.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { getLessonThread, renderThread } from "./discussion-read.server";
import { resolveLessonTarget, type LessonDatabase } from "./targets.server";

export async function getLessonPage(
  db: LessonDatabase,
  request: Request,
  input: unknown
) {
  const { course, module, lesson } = resolveLessonTarget(db, input);
  const permission = await getCoursePermissions(db, request, course.id);
  const curriculum = db
    .select({ id: modules.id, title: modules.title })
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(modules.position, modules.id)
    .all()
    .map((section) => ({
      id: section.id,
      title: section.title,
      lessons: db
        .select({
          id: lessons.id,
          title: lessons.title,
          durationMinutes: lessons.durationMinutes,
        })
        .from(lessons)
        .where(eq(lessons.moduleId, section.id))
        .orderBy(lessons.position, lessons.id)
        .all()
        .map((item) => ({
          id: item.id,
          title: item.title,
          durationMinutes: item.durationMinutes,
          href: `/courses/${course.slug}/lessons/${item.id}`,
        })),
    }));
  const navigation = curriculum.flatMap((section) => section.lessons);
  const index = navigation.findIndex((item) => item.id === lesson.id);
  const instructor = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();
  const preview = {
    course: { id: course.id, title: course.title, slug: course.slug },
    lesson: {
      id: lesson.id,
      title: lesson.title,
      durationMinutes: lesson.durationMinutes,
      href: `/courses/${course.slug}/lessons/${lesson.id}`,
    },
    module: { id: module.id, title: module.title },
    curriculum,
    prevLesson: navigation[index - 1] ?? null,
    nextLesson: navigation[index + 1] ?? null,
    instructorName: instructor?.name ?? "your instructor",
    enrollmentHref: `/courses/${course.slug}`,
    purchaseHref: `/courses/${course.slug}/purchase`,
  };
  if (!permission.canViewContent || permission.userId === null) {
    return {
      ...preview,
      kind: "preview" as const,
      canViewContent: false as const,
      denial: permission.pppBlocked
        ? ("country" as const)
        : ("enrollment" as const),
    };
  }
  const userId = permission.userId;
  let lessonStatus: string | null = null;
  const lessonProgressMap: Record<number, string> = {};
  let lastWatchPosition = 0;
  let watchProgress = 0;
  if (permission.canParticipate) {
    const existing = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.lessonId, lesson.id)
        )
      )
      .get();
    if (!existing) {
      db.insert(lessonProgress)
        .values({
          userId,
          lessonId: lesson.id,
          status: LessonProgressStatus.InProgress,
        })
        .run();
    } else if (existing.status !== LessonProgressStatus.Completed) {
      db.update(lessonProgress)
        .set({ status: LessonProgressStatus.InProgress })
        .where(eq(lessonProgress.id, existing.id))
        .run();
    }
    const progress = db
      .select({
        lessonId: lessonProgress.lessonId,
        status: lessonProgress.status,
      })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          inArray(
            lessonProgress.lessonId,
            navigation.map((item) => item.id)
          )
        )
      )
      .all();
    for (const record of progress)
      lessonProgressMap[record.lessonId] = record.status;
    lessonStatus = lessonProgressMap[lesson.id] ?? null;
    if (lesson.videoUrl) {
      const recent = db
        .select({ position: videoWatchEvents.positionSeconds })
        .from(videoWatchEvents)
        .where(
          and(
            eq(videoWatchEvents.userId, userId),
            eq(videoWatchEvents.lessonId, lesson.id)
          )
        )
        .orderBy(desc(videoWatchEvents.createdAt), desc(videoWatchEvents.id))
        .get();
      lastWatchPosition = recent?.position ?? 0;
      const watched = db
        .select({
          position: sql<number>`max(${videoWatchEvents.positionSeconds})`,
        })
        .from(videoWatchEvents)
        .where(
          and(
            eq(videoWatchEvents.userId, userId),
            eq(videoWatchEvents.lessonId, lesson.id)
          )
        )
        .get();
      const duration = (lesson.durationMinutes ?? 0) * 60;
      watchProgress =
        duration > 0
          ? Math.min(
              Math.round(((watched?.position ?? 0) / duration) * 100),
              100
            )
          : 0;
    }
  }
  const quizRecord = db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      passingScore: quizzes.passingScore,
    })
    .from(quizzes)
    .where(eq(quizzes.lessonId, lesson.id))
    .get();
  const quiz = quizRecord
    ? {
        id: quizRecord.id,
        title: quizRecord.title,
        passingScore: quizRecord.passingScore,
        questions: db
          .select({
            id: quizQuestions.id,
            questionText: quizQuestions.questionText,
            questionType: quizQuestions.questionType,
            position: quizQuestions.position,
          })
          .from(quizQuestions)
          .where(eq(quizQuestions.quizId, quizRecord.id))
          .orderBy(quizQuestions.position, quizQuestions.id)
          .all()
          .map((question) => ({
            id: question.id,
            questionText: question.questionText,
            questionType: question.questionType,
            position: question.position,
            options: db
              .select({
                id: quizOptions.id,
                optionText: quizOptions.optionText,
              })
              .from(quizOptions)
              .where(eq(quizOptions.questionId, question.id))
              .all(),
          })),
      }
    : null;
  const bestAttempt =
    quizRecord && permission.canParticipate
      ? (db
          .select({ score: quizAttempts.score, passed: quizAttempts.passed })
          .from(quizAttempts)
          .where(
            and(
              eq(quizAttempts.userId, userId),
              eq(quizAttempts.quizId, quizRecord.id)
            )
          )
          .orderBy(desc(quizAttempts.score))
          .get() ?? null)
      : null;
  const note = getNote(db, userId, lesson.id);
  return {
    ...preview,
    kind: "content" as const,
    canViewContent: true as const,
    lesson: {
      id: lesson.id,
      title: lesson.title,
      durationMinutes: lesson.durationMinutes,
      videoUrl: lesson.videoUrl,
      githubRepoUrl: lesson.githubRepoUrl,
    },
    contentHtml: lesson.content ? await renderMarkdown(lesson.content) : null,
    currentUserId: userId,
    enrolled: permission.enrolled,
    canParticipate: permission.canParticipate,
    canModerate: permission.isStaff,
    lessonStatus,
    lessonProgressMap,
    lastWatchPosition,
    watchProgress,
    quiz,
    bestAttempt,
    comments: await renderThread(
      getLessonThread(db, lesson.id, course.instructorId)
    ),
    bookmarked: isBookmarked(db, userId, lesson.id),
    note: note ? { body: note.body, updatedAt: note.updatedAt } : null,
  };
}
