import type { Route } from "./+types/api.video-tracking";
import { db } from "~/db";
import { recordVideoEvent } from "~/modules/lesson-operations/activity.server";

export async function action({ request }: Route.ActionArgs) {
  return recordVideoEvent(db, request);
}
