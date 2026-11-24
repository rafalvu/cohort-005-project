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
  const result = spawnSync(process.execPath, [checker], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
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

  it("rejects staged formatting errors even when the working file is fixed", () => {
    stage("example.ts", "const value=1\n");
    write("example.ts", "const value = 1;\n");
    const before = git("diff", "--cached", "--binary");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      'Prettier formatting required: "example.ts"'
    );
    expect(result.output).toContain("npx prettier --write");
    expect(git("diff", "--cached", "--binary")).toBe(before);
    expect(readFileSync(join(repo, "example.ts"), "utf8")).toBe(
      "const value = 1;\n"
    );
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

  it("preserves spaces, newlines, and leading dashes in file paths", () => {
    const path = "-odd name\n[example].ts";
    stage(path, "const value=1\n");
    expect(check()).toEqual({
      status: 1,
      output: expect.stringContaining(JSON.stringify(path)),
    });
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
    expect(result.output).toContain(
      'Prettier formatting required: "example.ts"'
    );
    git("rm", "--force", "--", "renamed.txt");
    stage("example.ts", "const value = 2;\n");
    expect(check().status).toBe(0);
  });

  it("exempts generated lockfiles and Drizzle snapshots only from size checks", () => {
    const json = `{\n  "data": "${"x".repeat(20_001)}"\n}\n`;
    stage("package-lock.json", json);
    stage("drizzle/meta/0014_snapshot.json", json);
    stage("nested/pnpm-lock.yaml", `data: ${"x".repeat(20_001)}\n`);
    expect(check().status).toBe(0);
    stage("package-lock.json", '{"lockfileVersion":3}');
    expect(check()).toEqual({
      status: 1,
      output: expect.stringContaining(
        'Prettier formatting required: "package-lock.json"'
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
    stage("broken.ts", "const = ;\n");
    expect(check()).toEqual({
      status: 1,
      output: expect.stringContaining('Prettier could not check "broken.ts"'),
    });
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
    mkdirSync(join(repo, "scripts"));
    copyFileSync(runner, join(repo, "scripts/run-pre-commit.mjs"));
    symlinkSync(checker, join(repo, "scripts/check-staged-files.mjs"));
    stage("example.ts", "const value=1\n");
    const commit = () =>
      spawnSync("git", ["commit", "--quiet", "-m", "hook integration"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
    const rejected = commit();
    expect(rejected.status).toBe(1);
    expect(rejected.stdout + rejected.stderr).toContain(
      "Prettier formatting required"
    );
    stage("example.ts", "const value = 1;\n");
    expect(commit().status).toBe(0);
  });

  it("stops a stalled check at the time budget and blocks the commit", () => {
    write("scripts/check-staged-files.mjs", "while (true) {}\n");
    copyFileSync(runner, join(repo, "scripts/run-pre-commit.mjs"));
    const result = spawnSync(
      process.execPath,
      [join(repo, "scripts/run-pre-commit.mjs")],
      { cwd: repo, env, encoding: "utf8", timeout: 4_000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("three-second budget");
    expect(result.stderr).toContain("checks were not completed");
  });
});
