import { describe, expect, it } from "vitest";
import { createRouteManifest } from "./index.js";

describe("createRouteManifest", () => {
  it("freezes ordered route definitions for portal navigation", () => {
    const manifest = createRouteManifest([
      {
        id: "scenario-bank",
        path: "/scenarios",
        label: "Scenario Bank",
        description: "Review scenario bank readiness.",
        capabilityTags: ["GraphQL Codegen"],
      },
    ]);

    expect(manifest).toEqual([
      {
        id: "scenario-bank",
        path: "/scenarios",
        label: "Scenario Bank",
        description: "Review scenario bank readiness.",
        capabilityTags: ["GraphQL Codegen"],
      },
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest[0])).toBe(true);
  });

  it("rejects duplicate route paths before a portal renders ambiguous links", () => {
    expect(() =>
      createRouteManifest([
        {
          id: "scenario-bank",
          path: "/scenarios",
          label: "Scenario Bank",
          description: "First route.",
          capabilityTags: [],
        },
        {
          id: "scenario-bank-copy",
          path: "/scenarios",
          label: "Scenario Bank Copy",
          description: "Second route.",
          capabilityTags: [],
        },
      ]),
    ).toThrow("Duplicate route path: /scenarios");
  });
});
