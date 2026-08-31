import { defineConfig } from "vitest/config";
import { worktreeExcludePatterns } from "../worktree-excludes.ts";

/** CellixJS split: ArchUnit suites are a separate Vitest project from unit tests. */
export const archConfig = defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    include: ["src/archunit-tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...worktreeExcludePatterns],
  },
});
