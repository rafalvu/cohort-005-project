import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import * as prettier from "prettier";

const maxTokens = 5_000;
const bytesPerToken = 4;
const lockfiles = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "skills-lock.json",
]);

function git(...args) {
  return execFileSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
}

async function checkStagedFiles() {
  process.chdir(git("rev-parse", "--show-toplevel").toString().trimEnd());

  // Raw, NUL-delimited records preserve unusual filenames and give us the
  // staged blob IDs. Disabling rename detection checks each destination once.
  const records = git(
    "diff",
    "--cached",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "--diff-filter=ACMTU",
    "-z"
  )
    .toString()
    .split("\0");
  if (!records[0]) {
    return { root: process.cwd(), staged: false, updates: [] };
  }

  // Use the staged settings too: an unstaged config edit must not change the
  // formatting rules for this commit. This repo uses a JSON .prettierrc.
  const config = JSON.parse(git("show", ":.prettierrc").toString());
  let failed = false;
  let oversized = false;
  const updates = [];
  const files = [];

  function checkSize(path, label, bytes) {
    const generated =
      lockfiles.has(basename(path)) ||
      /^drizzle\/meta\/\d+_snapshot\.json$/.test(path);
    if (generated || bytes <= maxTokens * bytesPerToken) return;
    console.error(
      `${label}: approximately ${Math.ceil(bytes / bytesPerToken).toLocaleString("en-US")} tokens ` +
        `(${bytes.toLocaleString("en-US")} bytes); limit is 5,000 tokens (20,000 bytes).`
    );
    failed = oversized = true;
  }

  for (let index = 0; index < records.length - 1; index += 2) {
    const [, mode, , blob, status] = records[index].split(" ");
    const path = records[index + 1];
    const label = JSON.stringify(path);
    if (status === "U") {
      console.error(`Unresolved merge conflict: ${label}`);
      failed = true;
      continue;
    }
    // Symlinks and submodules are references, not regular file contents.
    if (mode !== "100644" && mode !== "100755") continue;

    files.push({ path, blob, label, mode });
  }

  // Read sizes in one Git process instead of spawning one per staged file.
  const sizes = files.length
    ? execFileSync("git", ["cat-file", "--batch-check=%(objectsize)"], {
        input: files.map(({ blob }) => blob).join("\n") + "\n",
        encoding: "utf8",
      })
        .trimEnd()
        .split("\n")
        .map(Number)
    : [];
  const formatFiles = [];
  for (const [index, file] of files.entries()) {
    const { path, label } = file;
    const bytes = sizes[index];
    try {
      const { inferredParser } = await prettier.getFileInfo(path, {
        resolveConfig: false,
      });
      if (!inferredParser) {
        checkSize(path, label, bytes);
        continue;
      }
      formatFiles.push({ ...file, bytes, parser: inferredParser });
    } catch (error) {
      console.error(`Prettier could not check ${label}: ${error.message}`);
      failed = true;
    }
  }

  // Fetch only the blobs Prettier needs, in one process. Slice by byte length
  // so UTF-8 text and embedded newlines cannot corrupt the batch framing.
  const contents = formatFiles.length
    ? execFileSync("git", ["cat-file", "--batch"], {
        input: formatFiles.map(({ blob }) => blob).join("\n") + "\n",
        maxBuffer: formatFiles.reduce((sum, { bytes }) => sum + bytes + 128, 0),
      })
    : Buffer.alloc(0);
  let offset = 0;
  for (const { path, label, bytes, parser, blob, mode } of formatFiles) {
    const start = contents.indexOf(10, offset) + 1;
    const source = contents.toString("utf8", start, start + bytes);
    offset = start + bytes + 1;
    try {
      const formatted = await prettier.format(source, {
        ...config,
        filepath: path,
        parser,
      });
      checkSize(path, label, Buffer.byteLength(formatted));
      if (formatted !== source) {
        updates.push({ path, blob, mode, source, formatted });
      }
    } catch (error) {
      console.error(`Prettier could not check ${label}: ${error.message}`);
      failed = true;
    }
  }

  if (oversized) {
    console.error(`
Split oversized files before committing:
- Separate cohesive responsibilities into clearly named files; extract helpers or components with small interfaces.
- For app/modules, read app/modules/README.md and preserve public entry points and private implementation folders.
- Split tests by behavior and move large fixtures or data into focused files.
- Split documentation by topic and link the smaller documents from an overview.
- Keep behavior unchanged and run the relevant checks. Do not minify, remove useful documentation, or split at arbitrary line counts just to pass.
Stage the refactor, then rerun npm run check:staged.`);
  }
  if (failed) {
    console.error(
      "\nPre-commit checks failed. Fix and re-stage before committing."
    );
    process.exitCode = 1;
  } else {
    return { root: process.cwd(), staged: true, updates };
  }
}

try {
  // This worker only prepares changes. The parent applies them after successful
  // validation, so a timeout cannot interrupt a write to the index or worktree.
  const prepared = await checkStagedFiles();
  if (prepared) console.log(JSON.stringify(prepared));
} catch (error) {
  console.error(`Unable to check staged files: ${error.message}`);
  process.exitCode = 1;
}
