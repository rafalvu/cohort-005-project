import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeStagedFormatting } from "./write-staged-formatting.mjs";

// Leave startup headroom within the hook's three-second budget. A separate
// process lets us interrupt even a synchronous parser that takes too long.
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./check-staged-files.mjs", import.meta.url))],
  {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 2_500,
    killSignal: "SIGKILL",
  }
);

if (result.error?.code === "ETIMEDOUT") {
  console.error(
    "Pre-commit reached its three-second budget. Stage a smaller batch and retry; checks were not completed."
  );
} else if (result.error) {
  console.error(`Unable to start pre-commit checks: ${result.error.message}`);
}
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  try {
    const prepared = JSON.parse(result.stdout);
    // Apply only after the timed worker succeeds. Never kill Git mid-update.
    writeStagedFormatting(prepared);
    console.log(
      prepared.staged
        ? "Staged files pass Prettier and the 5,000-token limit."
        : "No staged files to check."
    );
  } catch (error) {
    console.error(`Unable to apply Prettier formatting: ${error.message}`);
    process.exitCode = 1;
  }
}
