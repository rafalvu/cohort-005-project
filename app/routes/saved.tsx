import { Bookmark, NotebookPen } from "lucide-react";
import { Link } from "react-router";
import { PageLinks } from "~/components/page-links";
import { Card, CardContent } from "~/components/ui/card";
import { db } from "~/db";
import { listBookmarks } from "~/lib/bookmarks.server";
import { listNotes } from "~/lib/notes.server";
import { readPage } from "~/lib/pagination";
import { formatRelativeTime } from "~/lib/utils";
import { people } from "~/modules/permissions/person.server";
import type { Route } from "./+types/saved";

export function meta() {
  return [
    { title: "Saved — Cadence" },
    { name: "description", content: "Your bookmarks and notes" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { id: userId } = await people.requirePerson(request);

  const url = new URL(request.url);
  const bookmarksPage = readPage(url, "bookmarksPage");
  const notesPage = readPage(url, "notesPage");
  return {
    bookmarksPage,
    notesPage,
    savedBookmarks: listBookmarks(db, userId, bookmarksPage),
    savedNotes: listNotes(db, userId, notesPage),
  };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { savedBookmarks, savedNotes } = loaderData;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          The lessons you flagged, and what you wrote about them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Bookmark className="size-4 text-muted-foreground" />
            Bookmarks
          </h2>

          {savedBookmarks.items.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No bookmarks yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {savedBookmarks.items.map((bookmark) => (
                <SavedLessonCard key={bookmark.id} lesson={bookmark.lesson} />
              ))}
            </div>
          )}
          <PageLinks
            label="Bookmark pages"
            parameter="bookmarksPage"
            page={loaderData.bookmarksPage}
            hasNext={savedBookmarks.hasNext}
          />
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <NotebookPen className="size-4 text-muted-foreground" />
            Notes
          </h2>

          {savedNotes.items.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No notes yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {savedNotes.items.map((note) => (
                <SavedLessonCard key={note.id} lesson={note.lesson}>
                  {/* Plain text — a Note is never rendered as Markdown. */}
                  <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                  <p
                    suppressHydrationWarning
                    className="text-xs text-muted-foreground"
                  >
                    Edited {formatRelativeTime(note.updatedAt)}
                  </p>
                </SavedLessonCard>
              ))}
            </div>
          )}
          <PageLinks
            label="Note pages"
            parameter="notesPage"
            page={loaderData.notesPage}
            hasNext={savedNotes.hasNext}
          />
        </section>
      </div>
    </div>
  );
}

type SavedLesson =
  Route.ComponentProps["loaderData"]["savedBookmarks"]["items"][number]["lesson"];

/** A row on the Saved page: a link to the Lesson, named with its Course. */
function SavedLessonCard({
  lesson,
  children,
}: {
  lesson: SavedLesson;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <Link
          to={`/courses/${lesson.courseSlug}/lessons/${lesson.id}`}
          className="text-sm font-medium hover:underline"
        >
          {lesson.title}
        </Link>
        <p className="text-xs text-muted-foreground">{lesson.courseTitle}</p>
        {children}
      </CardContent>
    </Card>
  );
}
