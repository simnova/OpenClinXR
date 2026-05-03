import { describe, expect, it } from "vitest";
import { defaultTestIncludePatterns } from "./base.config.js";
import { nodeConfig } from "./node.config.js";

describe("node Vitest config", () => {
  it("merges base coverage with Node-oriented test defaults", () => {
    expect(nodeConfig).toMatchObject({
      test: {
        environment: "node",
        include: defaultTestIncludePatterns,
        testTimeout: 5000,
        typecheck: {
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
