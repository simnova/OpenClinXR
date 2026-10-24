import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

export const nativeCompilerPath = createRequire(import.meta.url).resolve("@cellix/config-typescript/compiler");

export const defaultTestIncludePatterns = [
  "**/*.{test,spec}.?(c|m)[jt]s?(x)",
  "tests/**/*.{test,spec}.?(c|m)[jt]s?(x)",
];

export function createDefaultTypecheckConfig() {
  return {
    enabled: true,
    checker: nativeCompilerPath,
    tsconfig: "tsconfig.vitest.json",
    include: [...defaultTestIncludePatterns],
    exclude: ["**/node_modules/**", "src/archunit-tests/**", "**/dist/**", "**/coverage/**"],
    ignoreSourceErrors: true,
  };
}

export const baseConfig = defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
