import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as schema from "../app/db/schema";
import { seedBaseData } from "../app/test/setup";

const directory = mkdtempSync(join(tmpdir(), "cadence-browser-"));
const sqlite = new Database(join(directory, "data.db"));
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: resolve("drizzle") });
const { user, course } = seedBaseData(db);
db.insert(schema.enrollments)
  .values({ userId: user.id, courseId: course.id })
  .run();
sqlite.close();
symlinkSync(resolve("build"), join(directory, "build"), "dir");
const server = spawn(
  process.execPath,
  [
    resolve("node_modules/@react-router/serve/dist/cli.js"),
    "build/server/index.js",
  ],
  {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "4179",
      KNOCK_SECRET_API_KEY: "",
      POSTMARK_SERVER_TOKEN: "",
    },
    stdio: "inherit",
  }
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => server.kill("SIGTERM"));
server.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
