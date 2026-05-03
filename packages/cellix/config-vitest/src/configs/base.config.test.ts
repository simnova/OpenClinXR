import { describe, expect, it } from "vitest";
import { baseConfig, createDefaultTypecheckConfig, defaultTestIncludePatterns } from "./base.config.js";

describe("base Vitest config", () => {
  it("uses Cellix tsgo typechecking defaults", () => {
    expect(createDefaultTypecheckConfig()).toEqual({
      enabled: true,
      checker: "tsgo",
      tsconfig: "tsconfig.vitest.json",
      include: defaultTestIncludePatterns,
      exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
      ignoreSourceErrors: true,
    });
  });

  it("uses lightweight v8 coverage defaults", () => {
    expect(baseConfig).toMatchObject({
      test: {
        coverage: {
          provider: "v8",
          reporter: ["text", "lcov"],
          reportsDirectory: "coverage",
        },
      },
    });
  });
});
