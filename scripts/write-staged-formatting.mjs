import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeStagedFormatting({ root, updates }) {
  if (!updates.length) return;
  const git = (args, options = {}) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", ...options });

  // Do not overwrite staging changes made while Prettier was running.
  const current = new Map(
    git(["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf("\t");
        return [entry.slice(tab + 1), entry.slice(0, tab)];
      })
  );
  for (const { path, mode, blob } of updates) {
    if (current.get(path) !== `${mode} ${blob} 0`) {
      throw new Error(
        `Staging changed while formatting ${JSON.stringify(path)}. Retry the commit.`
      );
    }
  }

  const temporary = mkdtempSync(join(tmpdir(), "cadence-prettier-"));
  try {
    const paths = updates.map(({ formatted }, index) => {
      const path = join(temporary, String(index));
      writeFileSync(path, formatted);
      return path;
    });
    const hashes = git(["hash-object", "-w", "--no-filters", "--stdin-paths"], {
      input: paths.map((path) => JSON.stringify(path)).join("\n") + "\n",
    })
      .trimEnd()
      .split("\n");

    // One atomic index update, using only formatted staged blobs. Never git add
    // a working file: it may contain edits the user deliberately left unstaged.
    git(["update-index", "-z", "--index-info"], {
      input: updates
        .map(({ mode, path }, index) => `${mode} ${hashes[index]}\t${path}\0`)
        .join(""),
    });

    for (const { path, source, formatted } of updates) {
      const workingPath = join(root, path);
      try {
        if (
          lstatSync(workingPath).isFile() &&
          readFileSync(workingPath).equals(Buffer.from(source))
        ) {
          writeFileSync(workingPath, formatted);
        }
      } catch (error) {
        // An unstaged deletion must stay deleted.
        if (error.code !== "ENOENT") throw error;
      }
      console.log(`Prettier formatted and staged: ${JSON.stringify(path)}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
