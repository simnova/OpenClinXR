import { describe, expect, it } from "vitest";
import { worktreeExcludePatterns } from "../worktree-excludes.js";
import { archConfig } from "./arch.config.js";

describe("arch Vitest config", () => {
  it("runs architecture suites in node with a 30s timeout", () => {
    expect(archConfig["test"]?.exclude).toEqual(expect.arrayContaining([...worktreeExcludePatterns]));
    expect(archConfig["test"]?.include).toEqual(["src/archunit-tests/**/*.test.ts"]);
    expect(archConfig).toMatchObject({
      test: {
        globals: true,
        environment: "node",
        testTimeout: 30_000,
      },
    });
  });
});
