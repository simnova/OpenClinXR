import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE,
  cameraViewProjectionMatrices,
  cameraWorldMatrix,
  evaluateGate,
  type GateActor,
  type GateCamera,
  type GateOccluder,
  measureActorVisibility,
  measureNearOcclusion,
  NEAR_OCCLUSION_MATRIX_BROWSER_FUNCTION_SOURCE,
  PROJECT_BOX_BROWSER_FUNCTION_SOURCE,
  projectBoxFromMatrices,
} from "./gate-geometry.js";

describe("shared staging gate geometry", () => {
  it("serializes the exact visibility implementation used offline", () => {
    expect(ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE).toContain(measureActorVisibility.toString());
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

  it.each(["ed_chest_pain_priority_v1", "peds_fever_v1", "ward_delirium_med_rec_v1"])(
    "reproduces browser visibility, near and containment for saved %s snapshot",
    (caseId) => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const saved = JSON.parse(readFileSync(path.join(here, "../../staging-solver/test-fixtures", `${caseId}.json`), "utf8")) as {
        camera: GateCamera; actors: GateActor[]; occluders: GateOccluder[];
      };
      const browserVisibility = Function(`return (${ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE})`)() as typeof measureActorVisibility;
      const browserNear = Function(`return (${NEAR_OCCLUSION_MATRIX_BROWSER_FUNCTION_SOURCE})`)() as (
        matrix: number[], fov: number, aspect: number, boxes: GateOccluder["box"][],
      ) => ReturnType<typeof measureNearOcclusion>;
      const browserProject = Function(`return (${PROJECT_BOX_BROWSER_FUNCTION_SOURCE})`)() as typeof projectBoxFromMatrices;
      const matrices = cameraViewProjectionMatrices(saved.camera);
      for (const actor of saved.actors) {
        expect(browserVisibility(saved.camera.eye, actor, saved.occluders)).toEqual(
          measureActorVisibility(saved.camera.eye, actor, saved.occluders),
        );
        expect(browserProject(matrices.view, matrices.projection, actor.box)).toEqual(
          projectBoxFromMatrices(matrices.view, matrices.projection, actor.box),
        );
      }
      const browserNearReading = browserNear(cameraWorldMatrix(saved.camera), saved.camera.fov,
        saved.camera.aspect ?? 16 / 9, saved.occluders.map((row) => row.box));
      const offline = evaluateGate(saved.camera, saved.actors, saved.occluders);
      expect(Math.abs(browserNearReading.fraction - offline.nearOcclusionFraction)).toBeLessThanOrEqual(1 / 144);
    },
  );
});
