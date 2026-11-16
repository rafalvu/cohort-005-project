import { realpathSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // The disposable worktree shares the original checkout’s installed packages.
  server: { fs: { allow: [process.cwd(), realpathSync("node_modules")] } },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
