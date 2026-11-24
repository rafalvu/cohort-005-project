import { AlertTriangle, ArrowLeft, Users, Award } from "lucide-react";
import { Link } from "react-router";
import { isRouteErrorResponse } from "react-router";
import { PageLinks } from "~/components/page-links";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db } from "~/db";
import { readPage } from "~/lib/pagination";
import { studentRoster } from "~/lib/student-roster.server";
import { coursePermissions } from "~/modules/permissions/course-permissions.server";
import type { Route } from "./+types/instructor.$courseId.students";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Student Roster";
  return [
    { title: `Students: ${title} — Cadence` },
    { name: "description", content: `Enrolled students for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { course } = await coursePermissions.requireCapability(
    request,
    "manage",
    { courseId: params.courseId }
  );
  return {
    course,
    ...studentRoster(db, course.id, readPage(new URL(request.url))),
  };
}

function progressBar(progress: number) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-sm font-medium">{progress}%</span>
    </div>
  );
}

function quizScoreBadge(score: number | null, passed: boolean | null) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const percentage = Math.round(score * 100);

  if (passed) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        {percentage}% · Passed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
      {percentage}% · Failed
    </span>
  );
}

export default function InstructorStudentRoster({
  loaderData,
}: Route.ComponentProps) {
  const { course, students, quizCount } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Students</span>
      </nav>

      <Link
        to={`/instructor/${course.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Course Editor
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Student Roster</h1>
        <p className="mt-1 text-muted-foreground">
          Enrolled students for {course.title}
        </p>
      </div>

      <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="size-4" />
          {students.length} {students.length === 1 ? "student" : "students"} on
          this page
        </span>
        {quizCount > 0 && (
          <span className="flex items-center gap-1.5">
            <Award className="size-4" />
            {quizCount} {quizCount === 1 ? "quiz" : "quizzes"}
          </span>
        )}
      </div>

      <PageLinks
        label="Student pages"
        page={loaderData.page}
        hasNext={loaderData.hasNext}
      />
      {students.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Users className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No students enrolled in this course yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Student
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Enrolled
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Progress
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    {quizCount > 0 && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Quiz Scores
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const enrolledDate = new Date(
                      student.enrolledAt
                    ).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    });

                    return (
                      <tr
                        key={student.userId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">
                              {student.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {student.email}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {enrolledDate}
                        </td>
                        <td className="px-4 py-3">
                          {progressBar(student.progress)}
                        </td>
                        <td className="px-4 py-3">
                          {student.lapsed ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                              Lapsed
                            </span>
                          ) : student.completedAt ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              Completed
                            </span>
                          ) : student.progress > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                              In Progress
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                              Not Started
                            </span>
                          )}
                        </td>
                        {quizCount > 0 && (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {student.quizScores.map((qs) => (
                                <div
                                  key={qs.quizId}
                                  className="flex items-center gap-1"
                                  title={`${qs.quizTitle} (${qs.lessonTitle})`}
                                >
                                  {quizScoreBadge(qs.bestScore, qs.passed)}
                                </div>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading the student roster.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Course not found";
      message =
        "The course you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Not allowed";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to view this roster.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
