import { db } from "~/db";
import {
  getCoursePermissions,
  requireCurrentPerson,
  requireCourseContent,
  requireCourseManagement,
  requireInstructorOrAdmin as requireCurrentInstructorOrAdmin,
  type CoursePermissions,
} from "~/modules/course-permissions/index.server";

// Compatibility during migration: new operations use the injected module directly.
export type Access = CoursePermissions;

export function getAccess(request: Request, courseId: number) {
  return getCoursePermissions(db, request, courseId);
}

export async function requireUserId(request: Request): Promise<number> {
  return (await requireCurrentPerson(db, request)).id;
}

export function requireContentAccess(request: Request, courseId: number) {
  return requireCourseContent(db, request, courseId);
}

export function requireStaff(request: Request, courseId: number) {
  return requireCourseManagement(db, request, courseId);
}

export function requireInstructorOrAdmin(request: Request) {
  return requireCurrentInstructorOrAdmin(db, request);
}
