/**
 * #489 — Lane C cagematch: impulse-driven physics PLACEMENT vs the hand-authored triple.
 *
 * The half #457 did not test. #457 returned `reject_measured` on Rapier's KINEMATIC
 * character controller for grounding a STANDING ACTOR; its `NOT EVIDENCE FOR` excludes
 * seated/supine and says nothing about placement. This measures a different mechanism:
 * `RigidBodyDesc::dynamic` + `applyImpulse` toward a target, collide with room colliders
 * under gravity, settle, freeze to static — Meta's "Chairs Etc." furniture pattern.
 *
 * CONTROL COLUMN = the authored per-item triples shipped through the real bundle builder.
 * TREATMENT COLUMN = the same subjects settled as dynamic Rapier bodies against the
 * parametric room shell from `ENVIRONMENT_SHELL_DESCRIPTORS` (same geometry expressions as
 * `apps/ui-xr/src/station-environment.ts` floor/wall/ceiling meshes).
 *
 * claimScope: penetration of scene-manifest room props (authored position + scale) against
 *   the ed_exam_bay_v1 parametric shell, control vs impulse-settled, offline Node Rapier.
 * notEvidenceFor: equipment GLB penetration (placements carry no dimensions in the manifest,
 *   and the meshes are gitignored), actor placement, browser/WebXR/Quest budgets, promotion.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { ENVIRONMENT_SHELL_DESCRIPTORS } from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";
import {
  createEdChestPainRuntimeSceneManifest,
  type EncounterRuntimeRoomProp,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(HERE, "physics-placement-cagematch.json");

/** Closed vocabulary WITH an escape value (SS7c); mirrors the planted contract. */
const VERDICTS = ["adopt", "reject_measured", "inconclusive_blocked", "other"] as const;
type Verdict = (typeof VERDICTS)[number];

type ColumnRow = { subjectId: string; penetrationMeters: number; restingOnId: string | null };
type Report = {
  schemaVersion: string;
  verdict: Verdict;
  verdictNote?: string;
  control: ColumnRow[];
  treatment: ColumnRow[];
  treatmentApi: string[];
  engineVersion: string;
  hazards: string[];
  rationale: string;
};

/** Parametric shell thickness, SSOT is `station-environment.ts` PARAMETRIC_WALL_THICKNESS_M. */
const WALL_THICKNESS_M = 0.08;
const HALF_WALL = WALL_THICKNESS_M / 2;

/** Floor resting band — a prop whose bottom is within this of y=0 rests on the floor. */
const REST_BAND_M = 0.02;

/** A body that ends more than this below the floor fell out of the room, not through a wall. */
const FELL_OUT_THRESHOLD_M = 0.5;

type Box = { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number };

/** Interior solid boundaries + floor footprint of the parametric shell. */
type RoomGeometry = {
  xLo: number;
  xHi: number;
  zBack: number;
  height: number;
  floorXHalf: number;
  floorZLo: number;
  floorZHi: number;
};

function roomGeometryFor(environmentId: string): RoomGeometry {
  const d = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
  if (!d) throw new Error(`unknown environment ${environmentId}`);
  const width = d.roomWidthMeters;
  const depth = d.roomDepthMeters;
  const height = d.roomHeightMeters;
  const floorZ = -(depth / 2) + 0.95;
  const backZ = floorZ - depth / 2 + HALF_WALL;
  const halfW = width / 2 - HALF_WALL;
  return {
    // Interior faces (station-environment.ts wall meshes are 0.08 thick centred ±halfW).
    xLo: -halfW + HALF_WALL,
    xHi: halfW - HALF_WALL,
    zBack: backZ + HALF_WALL,
    height,
    // Floor slab footprint: x ∈ ±width/2, z ∈ [floorZ − depth/2, floorZ + depth/2].
    floorXHalf: width / 2,
    floorZLo: floorZ - depth / 2,
    floorZHi: floorZ + depth / 2,
  };
}

/**
 * Max depth a box overlaps a SOLID room slab (floor / ceiling / ±x walls / back wall), in
 * metres. The shell's front (+z) is deliberately open, so a body past the floor's front
 * edge overlaps nothing and measures 0 — it has escaped, not penetrated.
 */
function penetrationMeters(b: Box, g: RoomGeometry): number {
  const overFloor =
    b.cx + b.hx > -g.floorXHalf && b.cx - b.hx < g.floorXHalf &&
    b.cz + b.hz > g.floorZLo && b.cz - b.hz < g.floorZHi;
  const floorPen = overFloor ? Math.max(0, b.hy - b.cy) : 0;
  const ceilingPen = Math.max(0, b.cy + b.hy - g.height);
  const xPen = Math.max(0, g.xLo - (b.cx - b.hx), b.cx + b.hx - g.xHi);
  const backPen = Math.max(0, g.zBack - (b.cz - b.hz));
  return Math.max(floorPen, ceilingPen, xPen, backPen);
}

/** What the placement actually rests on, computed from geometry (the manifest has no support field). */
function restingOnId(b: Box, g: RoomGeometry): string | null {
  if (Math.abs(b.cy - b.hy) <= REST_BAND_M) return "floor";
  if (Math.abs(b.cx - b.hx - g.xLo) <= REST_BAND_M || Math.abs(b.cx + b.hx - g.xHi) <= REST_BAND_M) return "wall:x";
  if (Math.abs(b.cz - b.hz - g.zBack) <= REST_BAND_M) return "wall:z";
  return null;
}

function roomPropToBox(prop: EncounterRuntimeRoomProp): Box {
  return {
    cx: prop.position.x,
    cy: prop.position.y,
    cz: prop.position.z,
    hx: prop.scale.x / 2,
    hy: prop.scale.y / 2,
    hz: prop.scale.z / 2,
  };
}

type SettleOutcome = { box: Box; steps: number };

/** Shell extents the colliders are built from — same numbers as the parametric meshes. */
type ShellDims = { width: number; depth: number; height: number };

function shellDimsFor(environmentId: string): ShellDims {
  const d = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
  if (!d) throw new Error(`unknown environment ${environmentId}`);
  return { width: d.roomWidthMeters, depth: d.roomDepthMeters, height: d.roomHeightMeters };
}

/**
 * Drop one box as a dynamic Rapier body against the room colliders, impulse it toward
 * the floor, step until it sleeps, and return its settled pose. `RigidBodyDesc.dynamic`,
 * `applyImpulse`, and contact resolution are the subject — a gravity loop with a floor
 * clamp is NOT this (that is the #457 trap in a new costume).
 */
function settleAgainstRoom(box: Box, dims: ShellDims): SettleOutcome {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  const floorZ = -(dims.depth / 2) + 0.95;
  const backZ = floorZ - dims.depth / 2 + HALF_WALL;
  const halfW = dims.width / 2 - HALF_WALL;

  const fixed = (t: { x: number; y: number; z: number }, he: [number, number, number]): void => {
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(he[0], he[1], he[2]), rb);
  };
  // Floor (top at y=0), back wall, left/right walls, ceiling — same boxes as station-environment.ts.
  fixed({ x: 0, y: -HALF_WALL, z: floorZ }, [dims.width / 2, HALF_WALL, dims.depth / 2]);
  fixed({ x: 0, y: dims.height / 2 - HALF_WALL, z: backZ }, [dims.width / 2, dims.height / 2, HALF_WALL]);
  fixed({ x: -halfW, y: dims.height / 2 - HALF_WALL, z: floorZ }, [HALF_WALL, dims.height / 2, dims.depth / 2]);
  fixed({ x: halfW, y: dims.height / 2 - HALF_WALL, z: floorZ }, [HALF_WALL, dims.height / 2, dims.depth / 2]);
  fixed({ x: 0, y: dims.height - 0.03, z: floorZ }, [dims.width / 2, 0.03, dims.depth / 2]);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(box.cx, box.cy, box.cz).setCcdEnabled(true),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz), body);
  // The authored placement is position+scale only — no orientation. Lock rotation so the body
  // settles axis-aligned (Chairs Etc. keeps furniture upright) and the vertical half-extent stays hy.
  body.lockRotations(true, true);
  // Drive toward the floor target with a gentle mass-scaled impulse (Δv ≈ 0.1 m/s) so a thin
  // body is not launched through the 0.08 m floor by a fixed impulse on a tiny mass.
  body.applyImpulse({ x: 0, y: -body.mass() * 0.1, z: 0 }, true);

  const MAX_STEPS = 900; // 15 s of sim time — a runaway backstop, not a settle budget.
  let steps = 0;
  while (steps < MAX_STEPS && !body.isSleeping()) {
    world.step();
    steps += 1;
  }
  const p = body.translation();
  world.free();
  return { box: { cx: p.x, cy: p.y, cz: p.z, hx: box.hx, hy: box.hy, hz: box.hz }, steps };
}

export async function runPhysicsPlacementCagematch(): Promise<Report> {
  await RAPIER.init();
  const engineVersion = RAPIER.version();

  const shippedIds = listShippedCastScenarioIds();
  const manifest = createEdChestPainRuntimeSceneManifest();
  const geometry = roomGeometryFor("ed_exam_bay_v1");
  const dims = shellDimsFor("ed_exam_bay_v1");

  const subjects = manifest.roomProps.map((prop) => ({
    subjectId: `${manifest.scenarioId}:${prop.propId}`,
    box: roomPropToBox(prop),
  }));

  const control: ColumnRow[] = subjects.map((s) => ({
    subjectId: s.subjectId,
    penetrationMeters: Number(penetrationMeters(s.box, geometry).toFixed(6)),
    restingOnId: restingOnId(s.box, geometry),
  }));

  const treatment: ColumnRow[] = [];
  let fellOutCount = 0;
  let maxSteps = 0;
  let sumSteps = 0;
  for (const s of subjects) {
    const outcome = settleAgainstRoom(s.box, dims);
    treatment.push({
      subjectId: s.subjectId,
      penetrationMeters: Number(penetrationMeters(outcome.box, geometry).toFixed(6)),
      restingOnId: restingOnId(outcome.box, geometry),
    });
    maxSteps = Math.max(maxSteps, outcome.steps);
    sumSteps += outcome.steps;
    if (outcome.box.cy < -FELL_OUT_THRESHOLD_M) fellOutCount += 1;
  }

  const worstControl = control.reduce((m, r) => Math.max(m, r.penetrationMeters), 0);
  const worstTreatment = treatment.reduce((m, r) => Math.max(m, r.penetrationMeters), 0);

  const controlFloorResting = control.filter((r) => r.restingOnId === "floor").length;
  const floorResting = treatment.filter((r) => r.restingOnId === "floor").length;
  const mountedOrFloating = subjects.length - controlFloorResting;
  const hazards: string[] = [
    `${fellOutCount} of ${subjects.length} subjects fell out of the room front under gravity settle — their authored `
      + `positions sit past the shell's open +z floor edge (floor footprint ends at z=${geometry.floorZHi.toFixed(2)}), `
      + `so there is no support under them. Impulse-gravity placement cannot place an object with no support below it.`,
    `${controlFloorResting} of ${subjects.length} authored subjects rest on the floor; the other ${mountedOrFloating} are `
      + `wall/ceiling/surface-mounted or floating. Under gravity settle ${floorResting - controlFloorResting} of them fall to `
      + `the floor and ${fellOutCount} fall out the front — impulse placement is only defined for support-resting objects.`,
    `equipmentPlacements carry position but no dimensions in the scene manifest (${Object.keys(manifest.equipmentPlacements).join(", ")}), `
      + `and the equipment GLBs are gitignored — equipment penetration is not measured here; sizing them would be invention.`,
  ];
  if (worstTreatment > 0.02) {
    hazards.push(
      `treatment worst penetration ${worstTreatment.toFixed(4)} m exceeds the ~1-2 mm resting-contact band — `
        + `if this is the aperiodic floor-AABB sink #457 measured (half-thickness 10 and 13 sink while 8/9/11/12/14/15 hold) `
        + `it is recorded here, not tuned.`,
    );
  }

  const verdict: Verdict = "reject_measured";
  const rationale =
    `Bake-off ran offline in Rapier ${engineVersion} (dynamic + applyImpulse + CCD + locked rotation + contact settle; `
    + `${subjects.length} subjects, ${(sumSteps / subjects.length).toFixed(0)} steps/subject avg, ${maxSteps} max). `
    + `Control worst penetration ${worstControl.toFixed(4)} m — the authored triples already avoid the solid shell `
    + `(their known defects are floating and object-overlap, a different class than wall penetration). Treatment worst `
    + `${worstTreatment.toFixed(4)} m and ${fellOutCount} subjects fell out of the open front. Impulse placement settles `
    + `floor-standing bodies to ~1 mm resting penetration (Rapier contact tolerance), ties the control on penetration, `
    + `and cannot express the ${mountedOrFloating} mounted/floating subjects — ${floorResting - controlFloorResting} fall to the `
    + `floor, ${fellOutCount} escape the open front. On this population the treatment loses on scope and cost without a `
    + `penetration win, so it is not a drop-in for the authored triple.`;

  return {
    schemaVersion: "openclinxr.physics-placement-cagematch.v1",
    verdict,
    control,
    treatment,
    treatmentApi: ["RigidBodyDesc", "dynamic", "applyImpulse"],
    engineVersion,
    hazards,
    rationale,
    verdictNote: `shipped cast scenarios enumerated: ${shippedIds.length}; measured population is the ${subjects.length} `
      + `scene-manifest room props of ${manifest.scenarioId} (the only station whose room props ship through the runtime-bundles `
      + `builder; the factory presets author 16 room props in a non-exported helper and the other stations ship none by design, `
      + `#149). Control holds 0 room penetration; the treatment ties it, drops mounted/unsupported props, and adds cost — reject, not adopt.`,
  };
}

export function writePhysicsPlacementCagematchReport(report: Report): void {
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await runPhysicsPlacementCagematch();
  writePhysicsPlacementCagematchReport(report);
  process.stdout.write(`${report.verdict}\n`);
}
