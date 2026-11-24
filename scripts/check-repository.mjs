import { execFileSync } from "node:child_process";
import postcss from "postcss";
import { existsSync, readFileSync } from "node:fs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const paths = git("ls-files", "-z").split("\0").filter(Boolean);
for (const path of paths) {
  if (
    /^(?:build|node_modules|\.react-router|coverage|test-results|playwright-report)\//.test(
      path
    )
  ) {
    throw new Error(`Generated output is tracked: ${path}`);
  }
  const authored =
    /^(app|docs|scripts|request-logger|e2e|\.github)\//.test(path) &&
    !path.startsWith("request-logger/logs/");
  if (
    !authored ||
    !/\.(?:md|[cm]?[jt]sx?|sh|css|ya?ml|json)$/.test(path) ||
    !existsSync(path)
  )
    continue;
  const source = readFileSync(path, "utf8");
  if (source && !source.endsWith("\n"))
    throw new Error(`Missing final newline in ${path}`);
  source.split(/\r?\n/).forEach((line, index) => {
    if (!/[ \t]$/.test(line)) return;
    if (path.endsWith(".md") && /\S {2}$/.test(line)) return;
    throw new Error(`Trailing whitespace in ${path}:${index + 1}`);
  });
  if (path.endsWith(".css")) {
    postcss.parse(source, { from: path }).walkDecls((decl) => {
      if (
        !decl.prop.startsWith("--") &&
        /#[0-9a-f]{3,8}\b/i.test(decl.value.replace(/url\([^)]*\)/gi, ""))
      ) {
        throw new Error(
          `Use a color token in ${path}:${decl.source.start.line}`
        );
      }
    });
  }
}

// The PR target or previous branch tip is the immutable migration baseline.
const base = process.env.MIGRATION_BASE;
if (base && !/^0+$/.test(base)) {
  if (!/^[0-9a-f]{40}$/.test(base))
    throw new Error("Invalid migration baseline");
  const journal = "drizzle/meta/_journal.json";
  const previous = JSON.parse(git("show", `${base}:${journal}`));
  const current = JSON.parse(readFileSync(journal, "utf8"));
  const changes = git(
    "diff",
    "--no-renames",
    "--name-only",
    "--diff-filter=MDT",
    base,
    "--",
    "drizzle"
  );
  if (
    changes.split("\n").some((path) => path && path !== journal) ||
    previous.version !== current.version ||
    previous.dialect !== current.dialect ||
    previous.entries.some(
      (entry, index) =>
        JSON.stringify(entry) !== JSON.stringify(current.entries[index])
    )
  ) {
    throw new Error(
      "Add a new migration and journal entry. An existing migration changed."
    );
  }
}
