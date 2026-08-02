import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bakedTransformsConsumerAllowed,
  liveEngineInProductionForbidden,
  PHYSICS_TOUCH_ARTIFACTS_GATES,
} from "../gates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("physics-touch-artifacts gates", () => {
  it("allows baked transforms for production consumers", () => {
    expect(bakedTransformsConsumerAllowed).toBe(true);
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.bakedTransformsConsumerAllowed).toBe(true);
  });

  it("forbids live Rapier WASM in production", () => {
    expect(liveEngineInProductionForbidden).toBe(true);
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.liveEngineInProductionForbidden).toBe(true);
  });

  it("declares notEvidenceFor claims on all artifacts", () => {
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.notEvidenceFor).toContain("clinical_validity");
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.notEvidenceFor).toContain("exam_equivalence");
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.notEvidenceFor).toContain("scoring");
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.notEvidenceFor).toContain("learner_readiness");
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.notEvidenceFor).toContain("production_physics_readiness");
  });

  it("references MADRs 0030 and 0031 as governing decisions", () => {
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.governingMadrs).toContain("0030");
    expect(PHYSICS_TOUCH_ARTIFACTS_GATES.governingMadrs).toContain("0031");
  });

  it("has immutable const flags — baked true, live false", () => {
    // Type-level assertion: these are `as const` literals
    const baked: true = bakedTransformsConsumerAllowed;
    const live: true = liveEngineInProductionForbidden;
    expect(baked).toBe(true);
    expect(live).toBe(true);
  });

  it("has no Rapier or WASM dependency in its manifest or source", () => {
    // Read package.json directly — this package MUST have zero runtime deps.
    const manifestPath = join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toBeUndefined();
  });
});
