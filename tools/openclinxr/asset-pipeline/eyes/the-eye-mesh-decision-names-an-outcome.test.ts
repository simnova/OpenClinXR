import { describe, expect, it } from "vitest";
import decision from "./mesh-decision.json";

const OUTCOMES = [
  "highpoly_cornea",
  "highpoly_opaque",
  "lowpoly_subdivided",
  "other",
] as const;

describe("the eye mesh decision names an outcome", () => {
  it("outcome is inside the enum", () => {
    expect((OUTCOMES as readonly string[])).toContain(decision.outcome);
  });

  it("free text is non-empty", () => {
    expect(decision.freeText.trim().length).toBeGreaterThan(0);
  });

  it("no weightless eye verts", () => {
    expect(decision.census.zeroWeightEyeVerts).toBe(0);
  });

  it("cornea material is BLEND", () => {
    expect(decision.census.corneaMaterialAlphaMode).toBe("BLEND");
  });

  it("glb sha is 64 hex chars", () => {
    expect(decision.glbSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a known-bad outcome outside the enum is rejected", () => {
    const bad = { ...decision, outcome: "highpoly_translucent" };
    expect((OUTCOMES as readonly string[])).not.toContain(bad.outcome);
  });
});
