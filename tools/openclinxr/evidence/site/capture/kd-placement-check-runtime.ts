/**
 * KD S1-bis runtime-path placement check (card WKD stage 3, F3 scratch instrument).
 *
 * Stage-1 fed an in-memory fixture copy, which the runtime does not read: the
 * runtime reads the generated bundle files
 * (apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v{1,2}/
 * scene-manifest.v1.json). This re-runs the same check with the spouse placement
 * READ FROM those files — A values from website-wkd, B values from website-wkd-b
 * (read-only; this script never writes to either tree).
 *
 * Same imported production functions, wall/furniture sources, body radius and
 * source line as stage 1. Exit 0 + verdict PASS, else exit 1 (STOP the round).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { STANDING_FOOTPRINT_RADIUS_METERS } from "../../../../../packages/openclinxr/asset-registry/dist/bedside-clearance.js";
import {
  bedsideClearanceViolations,
  ED_STRETCHER_DECK_BOUNDS,
  ENVIRONMENT_SHELL_DESCRIPTORS,
} from "../../../../../packages/openclinxr/asset-registry/dist/index.js";
import {
  PATIENT_CHAIR_SEAT_HEIGHT_METERS,
  parametricWallInnerPlane,
} from "../../../../../packages/openclinxr/xr-station/dist/index.js";
import { resolveRuntimeActorPlacement } from "../../../../../packages/openclinxr/xr-station-room/dist/index.js";

const SPOUSE_ID = "spouse_anna_hayes_v1";
const ENVIRONMENT_ID = "ed_exam_bay_v1";
const TOL_M = 1e-6;
const A_ROOT = "/Volumes/files/src/openclinxr-wt/website-wkd";
const B_ROOT = "/Volumes/files/src/openclinxr-wt/website-wkd-b";

function fail(report: Record<string, unknown>, reason: string): never {
  report["verdict"] = "FAIL";
  report["stopReason"] = reason;
  writeOut(report);
  console.error(`KD-S1R FAIL: ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

let outPath = "";
function writeOut(report: Record<string, unknown>): void {
  if (outPath !== "") writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function readManifest(treeRoot: string, scenarioId: string): Record<string, unknown> {
  const file = `${treeRoot}/apps/ui-xr/public/xr-assets/generated/${scenarioId}/scene-manifest.v1.json`;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function runPlacementCheckRuntime(): void {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  if (outIdx === -1 || typeof argv[outIdx + 1] !== "string" || argv[outIdx + 1] === "") {
    console.error("usage: kd-placement-check-runtime.ts --out <placement-check-runtime.json>");
    process.exitCode = 1;
    return;
  }
  outPath = argv[outIdx + 1] as string;
  const report: Record<string, unknown> = {
    tool: "tools/openclinxr/evidence/site/capture/kd-placement-check-runtime.ts",
    actorId: SPOUSE_ID,
    note: "spouse placement read from the generated bundle files the runtime reads (read-only)",
    aRoot: A_ROOT,
    bRoot: B_ROOT,
    scenarios: {},
  };

  const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[ENVIRONMENT_ID];
  if (!descriptor) fail(report, `no shell descriptor for ${ENVIRONMENT_ID}`);
  const planes = {
    "+x": parametricWallInnerPlane("+x", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "-x": parametricWallInnerPlane("-x", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "-z": parametricWallInnerPlane("-z", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
    "+z-open": parametricWallInnerPlane("+z", descriptor.roomWidthMeters, descriptor.roomDepthMeters),
  };
  const r = STANDING_FOOTPRINT_RADIUS_METERS;
  const obstacles = [
    { id: "stretcher_deck", bounds: ED_STRETCHER_DECK_BOUNDS },
    {
      id: "ecg_cart_equipment",
      bounds: { min: { x: -2.15, y: 0, z: 0.25 }, max: { x: -1.55, y: 1.2, z: 0.85 } },
    },
  ];

  for (const scenarioId of ["ed_chest_pain_priority_v1", "ed_chest_pain_priority_v2"]) {
    const manifestA = readManifest(A_ROOT, scenarioId);
    const manifestB = readManifest(B_ROOT, scenarioId);
    const placementsA = (manifestA["actorPlacements"] ?? {}) as Record<string, Record<string, unknown>>;
    const placementsB = (manifestB["actorPlacements"] ?? {}) as Record<string, Record<string, unknown>>;
    const recA = placementsA[SPOUSE_ID];
    const recB = placementsB[SPOUSE_ID];
    if (!recA || !recB) fail(report, `${scenarioId}: spouse record missing from a bundle file`);
    const offA = recA["plantOffsetMeters"] as { x: number; y: number; z: number };
    const offB = recB["plantOffsetMeters"] as { x: number; y: number; z: number };
    if (!offA || offA.x !== -1.6 || offA.y !== 0 || offA.z !== -1.4) {
      fail(report, `${scenarioId}: A bundle offset is not {-1.6,0,-1.4}: ${JSON.stringify(offA)}`);
    }
    if (!offB || offB.x !== -2.1 || offB.y !== 0 || offB.z !== -1.4) {
      fail(report, `${scenarioId}: B bundle offset is not {-2.1,0,-1.4}: ${JSON.stringify(offB)}`);
    }
    const base = {
      scenarioId,
      environmentId: (manifestB["environmentId"] as string | undefined) ?? ENVIRONMENT_ID,
      patientChairSeatHeightMeters: PATIENT_CHAIR_SEAT_HEIGHT_METERS,
    };
    const posA = resolveRuntimeActorPlacement({ bundle: { sceneManifest: manifestA }, actorId: SPOUSE_ID, fallback: recA, ...base } as Parameters<typeof resolveRuntimeActorPlacement>[0]);
    const posB = resolveRuntimeActorPlacement({ bundle: { sceneManifest: manifestB }, actorId: SPOUSE_ID, fallback: recB, ...base } as Parameters<typeof resolveRuntimeActorPlacement>[0]);
    if (posA.placementProvenance !== "authored_intent" || posB.placementProvenance !== "authored_intent") {
      fail(report, `${scenarioId}: provenance A=${posA.placementProvenance} B=${posB.placementProvenance}`);
    }
    if (posA.supportAcceptance?.refusalReason || posB.supportAcceptance?.refusalReason) {
      fail(report, `${scenarioId}: refused A=${posA.supportAcceptance?.refusalReason} B=${posB.supportAcceptance?.refusalReason}`);
    }
    const delta = {
      x: posB.position.x - posA.position.x,
      y: posB.position.y - posA.position.y,
      z: posB.position.z - posA.position.z,
    };
    const deltaOk = Math.abs(delta.x - -0.5) <= TOL_M && Math.abs(delta.y) <= TOL_M && Math.abs(delta.z) <= TOL_M;
    const manifestPosB = recB["position"] as { x: number; y: number; z: number };
    const clampSnap = posB.position.x !== offB.x || posB.position.y !== manifestPosB.y || posB.position.z !== offB.z;
    const wallClear = {
      east: planes["+x"] - (posB.position.x + r),
      west: posB.position.x - r - planes["-x"],
      back: posB.position.z - r - planes["-z"],
      front: planes["+z-open"] - (posB.position.z + r),
    };
    const violations = bedsideClearanceViolations({ standingPosition: posB.position, obstacles });
    const blocking = violations.filter((violation) => violation.kind === "body_clearance");
    (report["scenarios"] as Record<string, unknown>)[scenarioId] = {
      offsetA: offA,
      offsetB: offB,
      manifestPositionA: recA["position"],
      manifestPositionB: manifestPosB,
      provenanceA: posA.placementProvenance,
      provenanceB: posB.placementProvenance,
      composedA: posA.position,
      composedB: posB.position,
      delta,
      deltaCheck: { expected: { x: -0.5, y: 0, z: 0 }, toleranceM: TOL_M, pass: deltaOk },
      clampSnap,
      wallClearanceMeters: wallClear,
      clearanceViolations: violations,
    };
    if (!deltaOk) fail(report, `${scenarioId}: delta != (-0.5,0,0) within 1e-6 m: ${JSON.stringify(delta)}`);
    if (clampSnap) fail(report, `${scenarioId}: B clamped/snapped: composed ${JSON.stringify(posB.position)} != authored ${JSON.stringify(offB)}`);
    if (Object.values(wallClear).some((clear) => !(clear > 0))) {
      fail(report, `${scenarioId}: B body radius crosses a wall plane: ${JSON.stringify(wallClear)}`);
    }
    if (blocking.length > 0) fail(report, `${scenarioId}: B intersects furniture: ${JSON.stringify(blocking)}`);
  }

  report["bodyRadiusMeters"] = {
    value: STANDING_FOOTPRINT_RADIUS_METERS,
    source: "packages/openclinxr/asset-registry/src/bedside-clearance.ts:58-59 (WALKER_SHOULDER_JOINT_SEPARATION_METERS 0.3681 / 2 + WALKER_BODY_CLEARANCE_METERS 0.05)",
  };
  report["roomDescriptor"] = {
    source: "packages/openclinxr/asset-registry/src/environment-descriptors.ts:149-178",
    roomWidthMeters: descriptor.roomWidthMeters,
    roomDepthMeters: descriptor.roomDepthMeters,
  };
  report["wallPlanes"] = { ...planes, source: "packages/openclinxr/xr-station/src/station-environment.ts:106-118" };
  report["verdict"] = "PASS";
  report["stopReason"] = null;
  writeOut(report);
  console.log(`KD-S1R PASS scenarios=${Object.keys(report["scenarios"] as object).join(",")}`);
}

runPlacementCheckRuntime();
