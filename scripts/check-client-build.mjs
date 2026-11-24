import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const canary = `private-build-check-${randomUUID()}`;
const secretNames = [
  "KNOCK_SECRET_API_KEY",
  "KNOCK_SIGNING_KEY",
  "POSTMARK_SERVER_TOKEN",
];
execFileSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...Object.fromEntries(secretNames.map((key) => [key, canary])),
  },
});
for (const file of readdirSync("build/client", {
  recursive: true,
  withFileTypes: true,
})) {
  if (!file.isFile()) continue;
  const path = join(file.parentPath, file.name);
  const content = readFileSync(path, "utf8");
  if (path.endsWith(".js") && content.includes("better_sqlite3.node")) {
    throw new Error(`Server-side SQLite driver in ${path}`);
  }
  if (
    content.includes(canary) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(
      content
    )
  ) {
    throw new Error(`Possible private credential in ${path}`);
  }
}
