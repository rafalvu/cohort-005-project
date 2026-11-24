import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Leave startup headroom within the hook's three-second budget. A separate
// process lets us interrupt even a synchronous parser that takes too long.
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./check-staged-files.mjs", import.meta.url))],
  { stdio: "inherit", timeout: 2_800, killSignal: "SIGKILL" }
);

if (result.error?.code === "ETIMEDOUT") {
  console.error(
    "Pre-commit reached its three-second budget. Stage a smaller batch and retry; checks were not completed."
  );
} else if (result.error) {
  console.error(`Unable to start pre-commit checks: ${result.error.message}`);
}
process.exitCode = result.status ?? 1;
