import { describe, expect, it } from "vitest";
import {
  ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE,
  evaluateGate,
  measureActorVisibility,
  measureNearOcclusion,
} from "./gate-geometry.js";

describe("shared staging gate geometry", () => {
  it("serializes the exact visibility implementation used offline", () => {
    expect(ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE).toBe(measureActorVisibility.toString());
    const browserMeasure = Function(`return (${ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE})`)() as typeof measureActorVisibility;
    const actor = { id: "patient", box: { min: [-0.3, 0, -0.2], max: [0.3, 1.8, 0.2] } } as const;
    expect(browserMeasure([0, 1.6, 3], actor, [])).toEqual(measureActorVisibility([0, 1.6, 3], actor, []));
  });

  it("uses the fixed 16x9 near grid", () => {
    const camera = { eye: [0, 1.6, 3], look: [0, 1, 0], fov: 70 } as const;
    expect(measureNearOcclusion(camera, [])).toEqual({ fraction: 0, nearRayCount: 0, rayCount: 144 });
  });

  it("evaluates a readable contained actor deterministically", () => {
    const camera = { eye: [0, 1.6, 3], look: [0, 0.9, 0], fov: 70 } as const;
    const actors = [{ id: "patient", box: { min: [-0.3, 0, -0.2], max: [0.3, 1.8, 0.2] }, heading: 0, primary: true }] as const;
    expect(evaluateGate(camera, actors, [])).toMatchObject({ containedActors: 1, visibleActors: 1, totalActors: 1, gatePass: true });
    expect(JSON.stringify(evaluateGate(camera, actors, []))).toBe(JSON.stringify(evaluateGate(camera, actors, [])));
  });
});
