import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { data } from "react-router";
import type * as schema from "~/db/schema";
import { users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

type Db = BetterSQLite3Database<typeof schema>;

export async function getCurrentPerson(db: Db, request: Request) {
  const userId = await getCurrentUserId(request);
  return userId === null
    ? undefined
    : db.select().from(users).where(eq(users.id, userId)).get();
}

export async function requireCurrentPerson(db: Db, request: Request) {
  const person = await getCurrentPerson(db, request);
  if (!person)
    throw data("Select a user from the DevUI panel.", { status: 401 });
  return person;
}
