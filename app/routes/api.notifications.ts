import { and, desc, eq, gt, lte, isNull, max } from "drizzle-orm";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/db";
import { notifications, users } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import { resolveNotification } from "~/lib/notification-reads.server";

const querySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  filter: z.enum(["all", "unread"]).default("all"),
  cursor: z.string().optional(),
});
const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.number().int().positive(),
});
function parseCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(value));
  } catch {
    throw data("Invalid cursor", { status: 400 });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.CADENCE_NOTIFICATIONS_ENABLED !== "true")
    throw data("Unavailable", { status: 404 });
  const recipientId = await requireUserId(request);
  if (!db.select().from(users).where(eq(users.id, recipientId)).get())
    throw data("Sign in required", { status: 401 });
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "id"))
      throw data("Unavailable", { status: 404 });
    throw data("Invalid input", { status: 400 });
  }
  const { id, limit, filter } = parsed.data;
  const cursor = parseCursor(parsed.data.cursor);
  const rows = db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        gt(
          notifications.createdAt,
          new Date(Date.now() - 90 * 86400000).toISOString()
        )
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all();
  const items = [];
  for (const row of rows) {
    const target = await resolveNotification(request, row);
    if (target)
      items.push({
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        readAt: row.readAt,
        target,
      });
  }
  const item = id === undefined ? null : items.find((item) => item.id === id);
  if (id !== undefined && !item) throw data("Unavailable", { status: 404 });
  const candidates = items.filter(
    (item) =>
      (filter === "all" || item.readAt === null) &&
      (!cursor ||
        item.createdAt < cursor.createdAt ||
        (item.createdAt === cursor.createdAt && item.id < cursor.id))
  );
  const page = candidates.slice(0, limit);
  const last = page.at(-1);
  return {
    item: item ?? null,
    items: page,
    unreadCount: items.filter((item) => item.readAt === null).length,
    nextCursor:
      candidates.length > limit && last
        ? JSON.stringify({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("read"),
    id: z.coerce.number().int().positive(),
  }),
  z.object({ intent: z.literal("read-all") }),
]);
export async function action({ request }: LoaderFunctionArgs) {
  if (process.env.CADENCE_NOTIFICATIONS_ENABLED !== "true")
    throw data("Unavailable", { status: 404 });
  // Capture synchronously at invocation, before session/body work can admit arrivals.
  const watermark =
    db
      .select({ id: max(notifications.id) })
      .from(notifications)
      .get()?.id ?? 0;
  if (request.method !== "POST")
    throw data("Method not allowed", { status: 405 });
  if (
    request.headers.get("Origin") !== new URL(request.url).origin ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw data("Forbidden", { status: 403 });
  const parsed = actionSchema.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "id"))
      throw data("Unavailable", { status: 404 });
    throw data("Invalid input", { status: 400 });
  }
  const recipientId = await requireUserId(request);
  if (!db.select().from(users).where(eq(users.id, recipientId)).get())
    throw data("Sign in required", { status: 401 });
  if (parsed.data.intent === "read-all") {
    const rows = db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          lte(notifications.id, watermark),
          isNull(notifications.readAt),
          gt(
            notifications.createdAt,
            new Date(Date.now() - 90 * 86400000).toISOString()
          )
        )
      )
      .all();
    for (const row of rows) {
      if (await resolveNotification(request, row))
        db.update(notifications)
          .set({ readAt: new Date().toISOString() })
          .where(
            and(
              eq(notifications.id, row.id),
              eq(notifications.recipientId, recipientId),
              isNull(notifications.readAt)
            )
          )
          .run();
    }
    return { success: true };
  }
  const row = db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, parsed.data.id),
        eq(notifications.recipientId, recipientId),
        gt(
          notifications.createdAt,
          new Date(Date.now() - 90 * 86400000).toISOString()
        )
      )
    )
    .get();
  if (!row || !(await resolveNotification(request, row)))
    throw data("Unavailable", { status: 404 });
  db.update(notifications)
    .set({ readAt: row.readAt ?? new Date().toISOString() })
    .where(
      and(
        eq(notifications.id, row.id),
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .run();
  return { success: true };
}
