import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";

// Source archives have no Git metadata; worktrees have a .git file.
if (existsSync(".git")) {
  chmodSync(".githooks/pre-commit", 0o755);
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
    stdio: "inherit",
  });
  console.log("Installed pre-commit checks from .githooks.");
}
