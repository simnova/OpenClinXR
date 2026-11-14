/**
 * KD S1 headless placement check (card WKD stage 2, scratch one-shot instrument).
 *
 * No browser, no capture. Uses the production functions from the recon chain,
 * imported not reimplemented:
 * - createEdChestPainRuntimeSceneManifest (@openclinxr/asset-registry/runtime-bundles)
 * - resolveRuntimeActorPlacement (@openclinxr/xr-station-room; the function
 *   apps/ui-xr/src/main.ts:842-852 calls)
 * - resolveRuntimeActorPlacement internally runs supportedActorPlacementPosition
 *   (@openclinxr/xr-runtime-state) -> composeSupportedActorWorldPosition
 *   (@openclinxr/asset-registry/actor-posture) for the standing+floor-frame branch
 * - bedsideClearanceViolations + ED_STRETCHER_DECK_BOUNDS (@openclinxr/asset-registry)
 * - parametricWallInnerPlane + PATIENT_CHAIR_SEAT_HEIGHT_METERS (@openclinxr/xr-station)
 * - ENVIRONMENT_SHELL_DESCRIPTORS (@openclinxr/asset-registry)
 * - STANDING_FOOTPRINT_RADIUS_METERS
 *   (packages/openclinxr/asset-registry/src/bedside-clearance.ts:58-59, the single
 *   source: 0.3681/2 + 0.05 rig-derived shoulder separation + stated clearance)
 *
 * B is an in-memory copy of the bank scenario with the ONE approved value changed
 * (spouse plantOffsetMeters.x -1.6 -> -2.1). The fixture on disk is never touched.
 *
 * Exit 0 + verdict PASS, else exit 1 (STOP the round).
 */
import { writeFileSync } from "node:fs";
import { composeSupportedActorWorldPosition } from "../../../../../packages/openclinxr/asset-registry/dist/actor-posture.js";
import { STANDING_FOOTPRINT_RADIUS_METERS } from "../../../../../packages/openclinxr/asset-registry/dist/bedside-clearance.js";
import type { CaseScenarioSource } from "../../../../../packages/openclinxr/asset-registry/dist/case-actor-placements-mod.js";
import {
  bedsideClearanceViolations,
  ED_STRETCHER_DECK_BOUNDS,
  ENVIRONMENT_SHELL_DESCRIPTORS,
} from "../../../../../packages/openclinxr/asset-registry/dist/index.js";
// Relative dist imports: tools/ has no workspace package links for these
// packages (root node_modules/@openclinxr/ lacks them), so bare specifiers do
// not resolve here. Dist is built (setup install=0 build=0); their own bare
// imports resolve via per-package node_modules.
import { createEdChestPainRuntimeSceneManifest } from "../../../../../packages/openclinxr/asset-registry/dist/runtime-bundles-entry.js";
import { edChestPainScenario } from "../../../../../packages/openclinxr/scenario-fixtures/dist/index.js";
import { supportedActorPlacementPosition } from "../../../../../packages/openclinxr/xr-runtime-state/dist/index.js";
import {
  PATIENT_CHAIR_SEAT_HEIGHT_METERS,
  parametricWallInnerPlane,
} from "../../../../../packages/openclinxr/xr-station/dist/index.js";
import { resolveRuntimeActorPlacement } from "../../../../../packages/openclinxr/xr-station-room/dist/index.js";

const SCENARIO_ID = "ed_chest_pain_priority_v1";
const ENVIRONMENT_ID = "ed_exam_bay_v1";
const SPOUSE_ID = "spouse_anna_hayes_v1";
const NURSE_ID = "nurse_maria_alvarez_v1";
const PATIENT_ID = "patient_robert_hayes_v1";
const TOL_M = 1e-6;

function fail(report: Record<string, unknown>, reason: string): never {
  report["verdict"] = "FAIL";
  report["stopReason"] = reason;
  writeOut(report);
  console.error(`KD-S1 FAIL: ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

let outPath = "";
function writeOut(report: Record<string, unknown>): void {
  if (outPath !== "") writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function runPlacementCheck(): void {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  if (outIdx === -1 || typeof argv[outIdx + 1] !== "string" || argv[outIdx + 1] === "") {
    console.error("usage: kd-placement-check.ts --out <placement-check.json>");
    process.exitCode = 1;
    return;
  }
  outPath = argv[outIdx + 1] as string;
  const report: Record<string, unknown> = {
    tool: "tools/openclinxr/evidence/site/capture/kd-placement-check.ts",
    scenarioId: SCENARIO_ID,
    actorId: SPOUSE_ID,
    approvedField: "placement.plantOffsetMeters.x",
    oldValue: -1.6,
    newValue: -2.1,
  };

  // B scenario: structural case source built from the bank scenario with the ONE
  // approved value changed. The bank and the on-disk fixture are never written.
  const bankSpouse = edChestPainScenario.actors.find((actor) => actor.actorId === SPOUSE_ID);
  const bankOffset = bankSpouse?.placement?.plantOffsetMeters;
  report["offsetA"] = bankOffset ?? null;
  if (!bankOffset || bankOffset.x !== -1.6 || bankOffset.y !== 0 || bankOffset.z !== -1.4) {
    fail(report, `bank spouse offset is not the approved A {-1.6,0,-1.4}: ${JSON.stringify(bankOffset)}`);
  }
  const scenarioB: CaseScenarioSource = {
    scenarioId: SCENARIO_ID,
    actors: edChestPainScenario.actors.map((actor) => actor.actorId === SPOUSE_ID
      ? {
        actorId: actor.actorId,
        role: actor.role,
        placement: { ...actor.placement, plantOffsetMeters: { x: -2.1, y: 0, z: -1.4 } },
      }
      : { actorId: actor.actorId, role: actor.role, placement: actor.placement }),
  };

  const manifestA = createEdChestPainRuntimeSceneManifest({ scenarioId: SCENARIO_ID });
  const manifestB = createEdChestPainRuntimeSceneManifest({ scenarioId: SCENARIO_ID, scenario: scenarioB });
  const fallbackA = manifestA.actorPlacements[SPOUSE_ID];
  const fallbackB = manifestB.actorPlacements[SPOUSE_ID];
  if (!fallbackA || !fallbackB) fail(report, "spouse placement missing from a scene manifest");

  const base = {
    scenarioId: SCENARIO_ID,
    environmentId: ENVIRONMENT_ID,
    patientChairSeatHeightMeters: PATIENT_CHAIR_SEAT_HEIGHT_METERS,
  };
  const posA = resolveRuntimeActorPlacement({ bundle: { sceneManifest: manifestA }, actorId: SPOUSE_ID, fallback: fallbackA, ...base });
  const posB = resolveRuntimeActorPlacement({ bundle: { sceneManifest: manifestB }, actorId: SPOUSE_ID, fallback: fallbackB, ...base });
  report["composedA"] = posA.position;
  report["composedB"] = posB.position;
  report["provenanceA"] = posA.placementProvenance;
  report["provenanceB"] = posB.placementProvenance;
  report["refusalA"] = posA.supportAcceptance?.refusalReason ?? null;
  report["refusalB"] = posB.supportAcceptance?.refusalReason ?? null;
  if (posA.placementProvenance !== "authored_intent" || posB.placementProvenance !== "authored_intent") {
    fail(report, `expected authored_intent provenance, got A=${posA.placementProvenance} B=${posB.placementProvenance}`);
  }
  if (posA.supportAcceptance?.refusalReason || posB.supportAcceptance?.refusalReason) {
    fail(report, `placement refused: A=${posA.supportAcceptance?.refusalReason} B=${posB.supportAcceptance?.refusalReason}`);
  }

  // (a) The claimed delta, exactly: B minus A == (-0.5, 0, 0) within 1e-6 m.
  const delta = {
    x: posB.position.x - posA.position.x,
    y: posB.position.y - posA.position.y,
    z: posB.position.z - posA.position.z,
  };
  report["delta"] = delta;
  const deltaOk =
    Math.abs(delta.x - -0.5) <= TOL_M && Math.abs(delta.y - 0) <= TOL_M && Math.abs(delta.z - 0) <= TOL_M;
  report["deltaCheck"] = { expected: { x: -0.5, y: 0, z: 0 }, toleranceM: TOL_M, pass: deltaOk };
  if (!deltaOk) fail(report, `delta != (-0.5,0,0) within 1e-6 m: ${JSON.stringify(delta)}`);

  // Direct compose cross-check on the standing+floor-frame branch (same production
  // function resolveRuntimeActorPlacement already ran through supportedActorPlacementPosition).
  const direct = composeSupportedActorWorldPosition({
    posture: "standing",
    fixtureAnchor: posA.position,
    authoredOffsetMeters: { x: -0.5, y: 0, z: 0 },
    resolvedPosition: posA.position,
    floorFrame: { frameId: `${ENVIRONMENT_ID}:floor`, originY: 0, originXz: { x: 0, z: 0 } },
  });
  report["directComposeCrossCheck"] = direct;

  // (b) Walls: production inner planes for ed_exam_bay_v1 (7 x 3.45 m).
  const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[ENVIRONMENT_ID];
  if (!descriptor) fail(report, `no shell descriptor for ${ENVIRONMENT_ID}`);
  const planes = {
    "+x": parametricWallInnerPlane("+x", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "-x": parametricWallInnerPlane("-x", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "-z": parametricWallInnerPlane("-z", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "+z-open": parametricWallInnerPlane("+z", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
  };
  const r = STANDING_FOOTPRINT_RADIUS_METERS;
  report["bodyRadiusMeters"] = {
    value: r,
    source: "packages/openclinxr/asset-registry/src/bedside-clearance.ts:58-59 (WALKER_SHOULDER_JOINT_SEPARATION_METERS 0.3681 / 2 + WALKER_BODY_CLEARANCE_METERS 0.05)",
  };
  report["roomDescriptor"] = {
    source: "packages/openclinxr/asset-registry/src/environment-descriptors.ts:149-178",
    roomWidthMeters: descriptor.roomWidthMeters,
    roomDepthMeters: descriptor.roomDepthMeters,
  };
  report["wallPlanes"] = { ...planes, source: "packages/openclinxr/xr-station/src/station-environment.ts:106-118" };
  const wallClear = {
    east: planes["+x"] - (posB.position.x + r),
    west: posB.position.x - r - planes["-x"],
    back: posB.position.z - r - planes["-z"],
    front: planes["+z-open"] - (posB.position.z + r),
  };
  report["wallClearanceMeters"] = wallClear;
  if (Object.values(wallClear).some((clear) => !(clear > 0))) {
    fail(report, `body radius crosses a wall plane: ${JSON.stringify(wallClear)}`);
  }

  // Furniture: production bounds. Stretcher deck measured off the shipped station
  // (bedside-target.ts:67-70 from xr-station-room/src/index.ts:325 BoxGeometry).
  // ECG cart at the shipped manifest position, ~0.6 x 0.5 m plan
  // (the-bedside-clearance-has-controls.test.ts:20-24; produced position
  // case-runtime-equipment-mod.ts:44).
  const obstacles = [
    { id: "stretcher_deck", bounds: ED_STRETCHER_DECK_BOUNDS },
    {
      id: "ecg_cart_equipment",
      bounds: { min: { x: -2.15, y: 0, z: 0.25 }, max: { x: -1.55, y: 1.2, z: 0.85 } },
    },
  ];
  const violations = bedsideClearanceViolations({ standingPosition: posB.position, obstacles });
  report["obstacles"] = obstacles.map((obstacle) => ({ id: obstacle.id, bounds: obstacle.bounds }));
  report["clearanceViolations"] = violations;
  const blocking = violations.filter((violation) => violation.kind === "body_clearance");
  if (blocking.length > 0) fail(report, `B intersects furniture: ${JSON.stringify(blocking)}`);

  // Cast separation at B (same production path for nurse + patient; informational).
  const nurseFallback = manifestB.actorPlacements[NURSE_ID];
  const patientFallback = manifestB.actorPlacements[PATIENT_ID];
  if (!nurseFallback || !patientFallback) fail(report, "nurse/patient placement missing from B manifest");
  const nurseB = resolveRuntimeActorPlacement({
    bundle: { sceneManifest: manifestB },
    actorId: NURSE_ID,
    fallback: nurseFallback,
    ...base,
  });
  const patientB = resolveRuntimeActorPlacement({
    bundle: { sceneManifest: manifestB },
    actorId: PATIENT_ID,
    fallback: patientFallback,
    ...base,
  });
  const separation = {
    spouseToNurseM: Math.hypot(posB.position.x - nurseB.position.x, posB.position.z - nurseB.position.z),
    spouseToPatientM: Math.hypot(posB.position.x - patientB.position.x, posB.position.z - patientB.position.z),
    minStandingCenterSeparationM: 0.45,
    source: "packages/openclinxr/asset-registry/src/the-failing-stations-have-nonoverlapping-authored-placements.test.ts:22-24",
  };
  report["separationAtB"] = separation;
  if (separation.spouseToNurseM < separation.minStandingCenterSeparationM) {
    fail(report, `spouse/nurse closer than 0.45 m at B: ${separation.spouseToNurseM}`);
  }

  // Cross-check through supportedActorPlacementPosition directly (the same production
  // function resolveRuntimeActorPlacement ran; inputs mirror runtime-actor-placement.ts:66-68).
  const direct2 = supportedActorPlacementPosition({
    posture: "standing",
    actorId: SPOUSE_ID,
    scenarioId: SCENARIO_ID,
    environmentId: ENVIRONMENT_ID,
    resolvedPosition: fallbackB.position,
    slotKind: fallbackB.slotKind,
    mountedSupportInstanceIds: [],
    authoredOffsetMeters: { x: -2.1, y: 0, z: -1.4 },
    floorFrame: { frameId: `${ENVIRONMENT_ID}:floor`, originY: 0, originXz: { x: 0, z: 0 } },
  });
  report["directSupportedCrossCheck"] = direct2.position;
  const crossOk = Math.abs(direct2.position.x - posB.position.x) <= TOL_M
    && Math.abs(direct2.position.y - posB.position.y) <= TOL_M
    && Math.abs(direct2.position.z - posB.position.z) <= TOL_M;
  if (!crossOk) fail(report, `supportedActorPlacementPosition disagrees with resolve: ${JSON.stringify(direct2.position)} vs ${JSON.stringify(posB.position)}`);
  report["verdict"] = "PASS";
  report["stopReason"] = null;
  writeOut(report);
  console.log(`KD-S1 PASS delta=${JSON.stringify(delta)} walls=${JSON.stringify(wallClear)} violations=${violations.length}`);
}

runPlacementCheck();
