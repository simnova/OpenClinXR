import { describe, expect, it } from "vitest";
import { worktreeExcludePatterns } from "../worktree-excludes.js";
import { defaultTestIncludePatterns } from "./base.config.js";
import { nodeConfig } from "./node.config.js";

describe("node Vitest config", () => {
  it("merges base coverage with Node-oriented test defaults", () => {
    expect(nodeConfig["test"]?.exclude).toEqual(
      expect.arrayContaining([...worktreeExcludePatterns, "src/archunit-tests/**"]),
    );
    expect(nodeConfig).toMatchObject({
      test: {
        environment: "node",
        include: defaultTestIncludePatterns,
        testTimeout: 5000,
        typecheck: {
          enabled: false,
          checker: "tsgo",
          tsconfig: "tsconfig.vitest.json",
        },
        coverage: {
          provider: "v8",
          excludeAfterRemap: true,
        },
      },
    });
  });
});
