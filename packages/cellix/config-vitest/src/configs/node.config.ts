import { defaultExclude, defineConfig, mergeConfig } from "vitest/config";
import { worktreeExcludePatterns } from "../worktree-excludes.ts";
import { baseConfig, createDefaultTypecheckConfig, defaultTestIncludePatterns } from "./base.config.ts";

export { worktreeExcludePatterns };

// A job runner that shares the machine with other jobs sets CELLIX_VITEST_MAX_WORKERS;
// unset or invalid leaves vitest's own default.
const envMaxWorkers = Number(process.env["CELLIX_VITEST_MAX_WORKERS"]);
const maxWorkersFromEnv = Number.isSafeInteger(envMaxWorkers) && envMaxWorkers >= 1 ? { maxWorkers: envMaxWorkers } : {};

export const nodeConfig = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // CellixJS enables this. This workspace typechecks via `tsgo -p tsconfig.vitest.json`
      // (package typecheck scripts). Opt in per package with typecheck.enabled = true.
      typecheck: { ...createDefaultTypecheckConfig(), enabled: false },
      include: [...defaultTestIncludePatterns],
      exclude: [
        ...defaultExclude,
        "src/archunit-tests/**",
        ...worktreeExcludePatterns,
      ],
      environment: "node",
      testTimeout: 5000,
      ...maxWorkersFromEnv,
      coverage: {
        excludeAfterRemap: true,
        exclude: [
          "**/*.test.*",
          "**/*.spec.*",
          "**/*.stories.*",
          "**/*.generated.ts",
          "**/*.generated.tsx",
          "**/*.d.ts",
          "**/*.config.*",
          "**/vitest.config.*",
          "**/vite.config.*",
          "**/coverage/**",
          "**/.storybook/**",
          "**/tsconfig*.json",
          "**/dist/**",
          "**/deploy/**",
          "node_modules/**",
          "src/archunit-tests/**",
        ],
      },
    },
  }),
);
