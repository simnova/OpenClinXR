import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeSupportedActorWorldPosition,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry/actor-posture";
import { geometryRevisionDigest } from "@openclinxr/asset-registry/case-approach-intent";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import { admitFrozenScenePlanForObservedScene } from "@openclinxr/asset-registry/encounter-bundle-admission";
import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  createEdChestPainRuntimeSceneManifest,
} from "@openclinxr/asset-registry/runtime-bundles";
import { observeMountedApproachGeometry } from "@openclinxr/xr-humanoid-animation/mounted-approach-geometry";
import { buildStationEnvironment } from "@openclinxr/xr-station";
import { type Object3D, Scene } from "three";
import { describe, expect, it } from "vitest";
import {
  SCENE_CLOSURE_CASE_ID,
  SCENE_CLOSURE_ENVIRONMENT_ID,
  SCENE_CLOSURE_PINNED_CAST,
  SCENE_CLOSURE_STATION_ID,
  sceneClosureCaseDocument,
} from "../../../tools/openclinxr/factory/scene-closure-case-source.js";

/**
 * THE RUNTIME OBSERVES A DIFFERENT ROOM THAN THE FROZEN PLAN BINDS.
 *
 * Measured 2026-09-13 at f3fec290 in a headless-chromium run of
 * `scene_closure_supine_bedside_v1`:
 *
 *   freeze / node `buildStationEnvironment("inpatient_ward_room_v1")`
 *     geom-v1-c45e274d-7
 *   live runtime after Infinigen `reanchorWallFixturesToRoom`
 *     geom-v1-cdaa4a22-7
 *
 * Canonical parts: floor, stretcher, overbed_surface byte-identical. Only
 * `door_leaf` (+1.465 m on +x) and `wall_board` (−1.465 m on −x) differ. The
 * equal-and-opposite pair is `loadInfinigenEnvironmentIntoStation` sliding
 * wall_anchor fixtures onto the generated hull (9.000 × 8.000 m) after the
 * freeze captured the parametric 6.000 × 3.150 m shell.
 *
 * Already falsified (do not re-propose): a later compiled-room GLB, a
 * dimension override, duplicate fixture nodes.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip the
 * assertion and append a ## FIXED block. Do not rewrite the original numbers.
 *
 * ## FIXED
 * The freeze predates the hull. `parametricDigest === frozenDigest` because SC-06
 * froze `buildStationEnvironment` in node before Infinigen loaded. The live digest
 * `geom-v1-cdaa4a22-7` is the hull-reanchored room; admission refuses it and
 * `observedGeometryRevision` names that live value. Restoring wall anchors at
 * admission re-opens #342c and is not the fix. Re-freeze is a follow-on card.
 *
 * claimScope: geometryRevisionDigest of the inpatient ward fixtures the
 * admission observes, versus the committed freeze.
 * notEvidenceFor: clinical validity, worn-headset, scoring, exam equivalence.
 */

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../..");
const WARD = SCENE_CLOSURE_ENVIRONMENT_ID;
const SUPPORT = `${WARD}:stretcher`;
const CASE_ID = SCENE_CLOSURE_CASE_ID;
/** Live digest measured after Infinigen reanchor; not a target. */
const REANCHORED_DIGEST = "geom-v1-cdaa4a22-7";
/** Measured movedMeters from reanchorWallFixturesToRoom on infinigen-inpatient-ward.glb. */
const DOOR_REANCHOR_METERS = 1.4647948216987885;
const BOARD_REANCHOR_METERS = -1.4647949591247098;

function digestOf(scene: Scene): string {
  return geometryRevisionDigest(observeMountedApproachGeometry(scene, { supportInstanceId: SUPPORT }));
}

function fixtureRoot(scene: Scene, slotId: string): Object3D {
  let hit: Object3D | null = null;
  scene.traverse((node) => {
    if (hit === null && node.userData["fixtureSlotId"] === slotId) hit = node;
  });
  if (hit === null) throw new Error(`missing fixture ${slotId}`);
  return hit;
}

function applyMeasuredInfinigenReanchor(scene: Scene): void {
  const door = fixtureRoot(scene, "door_leaf");
  const board = fixtureRoot(scene, "wall_board");
  door.position.x += DOOR_REANCHOR_METERS;
  door.userData["openClinXrWallAnchorReanchored"] = {
    method: "hull_inset",
    movedMeters: DOOR_REANCHOR_METERS,
  };
  board.position.x += BOARD_REANCHOR_METERS;
  board.userData["openClinXrWallAnchorReanchored"] = {
    method: "hull_inset",
    movedMeters: BOARD_REANCHOR_METERS,
  };
  scene.updateMatrixWorld(true);
}

describe("the runtime reproduces the frozen room digest", () => {
  it("geometry-digest-required-behavior", () => {
    const frozen = CASE_FROZEN_SCENE_PLANS[CASE_ID];
    expect(frozen, "the scene-closure case has no committed freeze").toBeTruthy();
    const frozenDigest = frozen!.revisions.geometryRevision;

    const scene = new Scene();
    scene.add(buildStationEnvironment({ environmentId: WARD }) as never);
    const parametricDigest = digestOf(scene);
    expect(parametricDigest, "node parametric shell drifted from the freeze").toBe(frozenDigest);

    applyMeasuredInfinigenReanchor(scene);
    const reanchoredDigest = digestOf(scene);
    expect(reanchoredDigest, "the measured Infinigen slide no longer produces the live digest").toBe(
      REANCHORED_DIGEST,
    );
    expect(reanchoredDigest).not.toBe(frozenDigest);

    const caseDocument = sceneClosureCaseDocument();
    const placements = createEdChestPainRuntimeSceneManifest({
      scenarioId: caseDocument.scenarioId,
      stationId: SCENE_CLOSURE_STATION_ID,
      scenario: caseDocument as never,
      environmentId: WARD,
    }).actorPlacements;
    const patientPlacement = placements[SCENE_CLOSURE_PINNED_CAST.patient];
    const patientWorld = composeSupportedActorWorldPosition({
      posture: "supine",
      fixtureAnchor: supineActorWorldPosition({}),
      ...(patientPlacement?.plantOffsetMeters
        ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters }
        : {}),
      resolvedPosition: patientPlacement?.position ?? { x: 0, y: 0, z: 0 },
    });
    const physicianPlacement = placements[SCENE_CLOSURE_PINNED_CAST.physician];
    const geometry = observeMountedApproachGeometry(scene, { supportInstanceId: SUPPORT });
    const start = composeSupportedActorWorldPosition({
      posture: "standing",
      fixtureAnchor: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
      ...(physicianPlacement?.plantOffsetMeters
        ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters }
        : {}),
      resolvedPosition: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
      ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
    });
    if ("refused" in patientWorld || "refused" in start) {
      throw new Error("the ward staging refused to compose a patient or physician position");
    }
    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
      scenarioId: CASE_ID,
      stationId: frozen!.case.stationId,
    });
    const admission = admitFrozenScenePlanForObservedScene({
      admission: { status: "no_plan_carried" },
      bundle,
      scene,
      environmentId: WARD,
      observeGeometry: observeMountedApproachGeometry,
      patientWorldPosition: patientWorld,
      start,
    });
    expect(admission.status, "hull-loaded scene must refuse a pre-hull freeze").toBe("refused");
    if (admission.status !== "refused") return;
    expect(admission.observedGeometryRevision).toBe(REANCHORED_DIGEST);
    expect(digestOf(scene)).toBe(REANCHORED_DIGEST);
    const admissionSource = readFileSync(
      nodePath.join(REPO_ROOT, "packages/openclinxr/asset-registry/src/encounter-bundle-admission-mod.ts"),
      "utf8",
    );
    expect(admissionSource).not.toMatch(/prepareObservedSceneForAdmission/u);
    expect(admissionSource).not.toMatch(/restoreWallAnchorsMovedByGeneratedRoom/u);
    expect(admissionSource).toMatch(/publishFrozenScenePlanAdmission\(/u);
    const mainSource = readFileSync(nodePath.join(REPO_ROOT, "apps/ui-xr/src/main.ts"), "utf8");
    expect(mainSource).toMatch(/admitFrozenScenePlanForObservedScene\(\{/u);
  });

  it("admission does not restore wall anchors — that re-opens #342c", () => {
    const frozen = CASE_FROZEN_SCENE_PLANS[CASE_ID];
    expect(frozen).toBeTruthy();
    const scene = new Scene();
    scene.add(buildStationEnvironment({ environmentId: WARD }) as never);
    applyMeasuredInfinigenReanchor(scene);
    const doorX = fixtureRoot(scene, "door_leaf").position.x;
    const boardX = fixtureRoot(scene, "wall_board").position.x;
    const caseDocument = sceneClosureCaseDocument();
    const placements = createEdChestPainRuntimeSceneManifest({
      scenarioId: caseDocument.scenarioId,
      stationId: SCENE_CLOSURE_STATION_ID,
      scenario: caseDocument as never,
      environmentId: WARD,
    }).actorPlacements;
    const patientPlacement = placements[SCENE_CLOSURE_PINNED_CAST.patient];
    const patientWorld = composeSupportedActorWorldPosition({
      posture: "supine",
      fixtureAnchor: supineActorWorldPosition({}),
      ...(patientPlacement?.plantOffsetMeters
        ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters }
        : {}),
      resolvedPosition: patientPlacement?.position ?? { x: 0, y: 0, z: 0 },
    });
    const physicianPlacement = placements[SCENE_CLOSURE_PINNED_CAST.physician];
    const geometry = observeMountedApproachGeometry(scene, { supportInstanceId: SUPPORT });
    const start = composeSupportedActorWorldPosition({
      posture: "standing",
      fixtureAnchor: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
      ...(physicianPlacement?.plantOffsetMeters
        ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters }
        : {}),
      resolvedPosition: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
      ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
    });
    if ("refused" in patientWorld || "refused" in start) {
      throw new Error("the ward staging refused to compose a patient or physician position");
    }
    admitFrozenScenePlanForObservedScene({
      admission: { status: "no_plan_carried" },
      bundle: createEdChestPainLocalLearnerRuntimeAssetBundle({
        scenarioId: CASE_ID,
        stationId: frozen!.case.stationId,
      }),
      scene,
      environmentId: WARD,
      observeGeometry: observeMountedApproachGeometry,
      patientWorldPosition: patientWorld,
      start,
    });
    expect(
      fixtureRoot(scene, "door_leaf").position.x,
      "admission restored door_leaf — that re-opens #342c (board 0.745 m and door 0.394 m beyond the generated floor footprint)",
    ).toBe(doorX);
    expect(
      fixtureRoot(scene, "wall_board").position.x,
      "admission restored wall_board — that re-opens #342c (board 0.745 m and door 0.394 m beyond the generated floor footprint)",
    ).toBe(boardX);
  });
});
