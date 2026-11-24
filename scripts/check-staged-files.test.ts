import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const project = fileURLToPath(new URL("../", import.meta.url));
const checker = join(project, "scripts/check-staged-files.mjs");
const runner = join(project, "scripts/run-pre-commit.mjs");
// A hook or an alternate-index verification must not leak its Git context
// into the disposable repositories used by these integration tests.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);
let repo: string;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, env, encoding: "utf8" });
}

function write(path: string, content: string | Buffer) {
  const destination = join(repo, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function stage(path: string, content: string | Buffer) {
  write(path, content);
  git("add", "--", path);
}

function check() {
  const result = spawnSync(process.execPath, [runner], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

function copyRunner() {
  mkdirSync(join(repo, "scripts"), { recursive: true });
  for (const file of ["run-pre-commit.mjs", "write-staged-formatting.mjs"]) {
    copyFileSync(join(project, "scripts", file), join(repo, "scripts", file));
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cadence-staged-check-"));
  git("init", "--quiet");
  git("config", "user.name", "Hook test");
  git("config", "user.email", "hook-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", ".githooks");
  stage(".prettierrc", readFileSync(join(project, ".prettierrc")));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("staged-file checks", () => {
  it("accepts an empty index and formatted UTF-8 files in an initial commit", () => {
    stage("a-unicode.ts", 'const greeting = "Cześć 🌍";\n');
    stage("example.ts", 'const label = "hello";\n');
    expect(check().status).toBe(0);
    git("commit", "--quiet", "-m", "baseline");
    expect(check()).toEqual({
      status: 0,
      output: "No staged files to check.\n",
    });
  });

  it("automatically formats the staged version when the working file is already fixed", () => {
    stage("example.ts", "const value=1\n");
    write("example.ts", "const value = 1;\n");
    const result = check();
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      'Prettier formatted and staged: "example.ts"'
    );
    expect(git("show", ":example.ts")).toBe("const value = 1;\n");
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(
      "const value = 1;\n"
    );
  });

  it("updates fully staged working files and preserves executable file modes", () => {
    stage("example.ts", "const value=1\n");
    chmodSync(join(repo, "example.ts"), 0o755);
    git("add", "example.ts");
    expect(check().status).toBe(0);
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(
      "const value = 1;\n"
    );
    expect(git("diff")).toBe("");
    expect(git("ls-files", "--stage", "example.ts")).toMatch(/^100755 /);
  });

  it("formats partial staging without changing or staging the unstaged edits", () => {
    stage("example.ts", "const value=1\n");
    const working = "const value=2\n// leave this edit unstaged\n";
    write("example.ts", working);
    expect(check().status).toBe(0);
    expect(git("show", ":example.ts")).toBe("const value = 1;\n");
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(working);
    expect(git("stash", "list")).toBe("");
  });

  it("preserves an unstaged deletion while formatting the staged file", () => {
    stage("example.ts", "const value=1\n");
    rmSync(join(repo, "example.ts"));
    expect(check().status).toBe(0);
    expect(git("show", ":example.ts")).toBe("const value = 1;\n");
    expect(git("diff", "--name-status")).toBe("D\texample.ts\n");
  });

  it("ignores unstaged content and formatting configuration changes", () => {
    stage("example.ts", 'const label = "hello";\n');
    write("example.ts", "unformatted".repeat(3_000));
    write(".prettierrc", '{"singleQuote":true}');
    expect(check().status).toBe(0);
  });

  it("accepts exactly 20,000 bytes and rejects one byte over the limit", () => {
    stage("notes.txt", "a".repeat(20_000));
    expect(check().status).toBe(0);
    stage("notes.txt", "a".repeat(20_001));
    write("notes.txt", "small unstaged replacement");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('"notes.txt": approximately 5,001 tokens');
    expect(result.output).toContain("20,001 bytes");
    expect(result.output).toContain("Separate cohesive responsibilities");
    expect(result.output).toContain("app/modules/README.md");
    expect(result.output).toContain("Stage the refactor");
  });

  it("counts UTF-8 bytes, not JavaScript characters", () => {
    stage("unicode.txt", "😀".repeat(5_001));
    expect(check()).toEqual({
      status: 1,
      output: expect.stringContaining("20,004 bytes"),
    });
  });

  it("checks the size after formatting and makes no changes when it fails", () => {
    stage(
      "example.ts",
      `const values=[${Array(7_000).fill("1").join(",")}];\n`
    );
    const before = git("show", ":example.ts");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain("limit is 5,000 tokens");
    expect(git("show", ":example.ts")).toBe(before);
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(before);
  });

  it("accepts files that formatting brings under the size limit", () => {
    stage("example.ts", " ".repeat(20_001) + "const value=1\n");
    expect(check().status).toBe(0);
    expect(git("show", ":example.ts")).toBe("const value = 1;\n");
  });

  it("preserves spaces, newlines, and leading dashes in file paths", () => {
    const path = "-odd name\n[example].ts";
    stage(path, "const value=1\n");
    expect(check()).toEqual({
      status: 0,
      output: expect.stringContaining(JSON.stringify(path)),
    });
    expect(git("show", `:${path}`)).toBe("const value = 1;\n");
  });

  it("checks modified and renamed files and ignores staged deletions", () => {
    stage("old.txt", "x".repeat(20_001));
    stage("example.ts", "const value = 1;\n");
    git("commit", "--quiet", "-m", "baseline");
    git("mv", "old.txt", "renamed.txt");
    stage("example.ts", "const value=2\n");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      '"renamed.txt": approximately 5,001 tokens'
    );
    expect(git("show", ":example.ts")).toBe("const value=2\n");
    git("rm", "--force", "--", "renamed.txt");
    expect(check().status).toBe(0);
    expect(git("show", ":example.ts")).toBe("const value = 2;\n");
  });

  it("exempts generated lockfiles and Drizzle snapshots only from size checks", () => {
    const json = `{\n  "data": "${"x".repeat(20_001)}"\n}\n`;
    stage("package-lock.json", json);
    stage("drizzle/meta/0014_snapshot.json", json);
    stage("nested/pnpm-lock.yaml", `data: ${"x".repeat(20_001)}\n`);
    expect(check().status).toBe(0);
    stage("package-lock.json", '{"lockfileVersion":3}');
    expect(check()).toEqual({
      status: 0,
      output: expect.stringContaining(
        'Prettier formatted and staged: "package-lock.json"'
      ),
    });
    stage("handwritten_snapshot.json", json);
    expect(check().output).toContain(
      '"handwritten_snapshot.json": approximately'
    );
  });

  it("skips symlinks without reading their targets", () => {
    write("target.txt", "x".repeat(20_001));
    symlinkSync("target.txt", join(repo, "linked.ts"));
    git("add", "linked.ts");
    expect(check().status).toBe(0);
  });

  it("fails closed on syntax errors", () => {
    stage("example.ts", "const value=1\n");
    stage("broken.ts", "const = ;\n");
    const before = git("diff", "--cached", "--binary");
    expect(check()).toEqual({
      status: 1,
      output: expect.stringContaining('Prettier could not check "broken.ts"'),
    });
    expect(git("diff", "--cached", "--binary")).toBe(before);
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(
      "const value=1\n"
    );
  });

  it("installs the tracked hook and blocks an actual commit until fixed", () => {
    mkdirSync(join(repo, ".githooks"));
    copyFileSync(
      join(project, ".githooks/pre-commit"),
      join(repo, ".githooks/pre-commit")
    );
    chmodSync(join(repo, ".githooks/pre-commit"), 0o644);
    git("config", "--unset", "core.hooksPath");
    execFileSync(
      process.execPath,
      [join(project, "scripts/install-git-hooks.mjs")],
      {
        cwd: repo,
        env,
      }
    );
    expect(git("config", "--local", "--get", "core.hooksPath").trim()).toBe(
      ".githooks"
    );
    copyRunner();
    symlinkSync(checker, join(repo, "scripts/check-staged-files.mjs"));
    stage("example.ts", "const = ;\n");
    const commit = () =>
      spawnSync("git", ["commit", "--quiet", "-m", "hook integration"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
    const rejected = commit();
    expect(rejected.status).toBe(1);
    expect(rejected.stdout + rejected.stderr).toContain(
      "Prettier could not check"
    );
    stage("example.ts", "const value=1\n");
    expect(commit().status).toBe(0);
    expect(git("show", "HEAD:example.ts")).toBe("const value = 1;\n");
    expect(git("diff")).toBe("");
  });

  it("stops a stalled check at the time budget and blocks the commit", () => {
    write("scripts/check-staged-files.mjs", "while (true) {}\n");
    copyRunner();
    stage("example.ts", "const value=1\n");
    const before = git("diff", "--cached", "--binary");
    const result = spawnSync(
      process.execPath,
      [join(repo, "scripts/run-pre-commit.mjs")],
      { cwd: repo, env, encoding: "utf8", timeout: 4_000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("three-second budget");
    expect(result.stderr).toContain("checks were not completed");
    expect(git("diff", "--cached", "--binary")).toBe(before);
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(
      "const value=1\n"
    );
  });
});
