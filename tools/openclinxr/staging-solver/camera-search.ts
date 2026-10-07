import {
  type AxisAlignedBox,
  actorSamplePoints,
  cameraViewProjectionMatrices,
  actorCrownChestVisibleEarly,
  evaluateGate,
  type GateActor,
  type GateCamera,
  type GateOccluder,
  type GateReading,
  segmentBoxHit,
  meanFacingDegrees,
  measureNearOcclusion,
  projectBoxFromMatrices,
  type Vec3,
} from "../evidence/station-capture/gate-geometry.js";
import type { CachedSceneSnapshot, SlotAssignment } from "./staging-types.js";
import { capsuleForPlacement, capsuleRadiusMeters } from "./layout-search.js";

type LayoutRow = SlotAssignment & { box: AxisAlignedBox; standing: boolean };
export type CameraSearchResult = { camera: GateCamera; gate: GateReading; layout: LayoutRow[] };

function centre(box: AxisAlignedBox): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function translatedScene(snapshot: CachedSceneSnapshot, layout: LayoutRow[]): { actors: GateActor[]; occluders: GateOccluder[]; looks: Vec3[] } {
  const byId = new Map(layout.map((row) => [row.actorId, row]));
  const deltas = new Map<string, [number, number]>();
  const actors = snapshot.actors.map((actor) => {
    const row = byId.get(actor.id);
    const current = centre(actor.box);
    const dx = (row?.world[0] ?? current[0]) - current[0], dz = (row?.world[2] ?? current[2]) - current[2];
    deltas.set(actor.id, [dx, dz]);
    const box = row?.box ?? actor.box;
    return { id: actor.id, box, heading: row?.headingRadians ?? actor.heading, recumbent: actor.recumbent,
      primary: actor.standing && actor.bodyDimensions[1] === Math.max(...snapshot.actors.filter((item) => item.standing).map((item) => item.bodyDimensions[1])) };
  });
  const occluders = snapshot.occluders.map((occluder) => {
    const delta = occluder.actorId ? deltas.get(occluder.actorId) : undefined;
    if (!delta) return occluder;
    const linked = occluder.actorId ? byId.get(occluder.actorId) : undefined;
    if (linked?.slotId === "companion_bedside" && /chair|seat|geometry_0|companion/i.test(occluder.name)) return occluder;
    return { ...occluder, box: {
      min: [occluder.box.min[0] + delta[0], occluder.box.min[1], occluder.box.min[2] + delta[1]],
      max: [occluder.box.max[0] + delta[0], occluder.box.max[1], occluder.box.max[2] + delta[1]],
    } as AxisAlignedBox };
  });
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const actor of actors) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], actor.box.min[axis]); max[axis] = Math.max(max[axis], actor.box.max[axis]);
  }
  const union: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const patient = actors.find((actor) => /patient/i.test(actor.id)) ?? actors[0];
  const patientBox = patient?.box;
  const patientChest: Vec3 = patientBox
    ? [(patientBox.min[0] + patientBox.max[0]) / 2, patientBox.min[1] + (patientBox.max[1] - patientBox.min[1]) * 0.65, (patientBox.min[2] + patientBox.max[2]) / 2]
    : union;
  const looks = [union, union, patientChest, ...actors.map((actor) => centre(actor.box))];
  const unique = looks.filter((look, index) => looks.findIndex((other) => other.every((value, axis) => Math.abs(value - look[axis]) < 1e-6)) === index);
  return { actors, occluders, looks: unique };
}

function eyes(snapshot: CachedSceneSnapshot, target: Vec3): Vec3[] {
  const output: Vec3[] = [];
  for (const y of snapshot.eyeYs) for (let distanceIndex = 0; distanceIndex < 29; distanceIndex += 1) {
    const distance = 1.4 + distanceIndex * 0.1;
    for (let turn = 0; turn < 64; turn += 1) {
      const angle = turn * Math.PI * 2 / 64;
      const eye: Vec3 = [target[0] + Math.sin(angle) * distance, y, target[2] + Math.cos(angle) * distance];
      if (eye[0] >= snapshot.orbitBounds.xMin && eye[0] <= snapshot.orbitBounds.xMax
        && eye[2] >= snapshot.orbitBounds.zMin && eye[2] <= snapshot.orbitBounds.zMax) output.push(eye);
    }
  }
  for (const y of snapshot.eyeYs) {
    for (let x = snapshot.interior.min[0] + 0.22; x <= snapshot.interior.max[0] - 0.22 + 1e-9; x += 0.25) {
      for (let z = snapshot.interior.min[2] + 0.22; z <= snapshot.interior.max[2] - 0.22 + 1e-9; z += 0.25) output.push([x, y, z]);
    }
  }
  const seen = new Set<string>();
  return output.filter((eye) => {
    const key = eye.map((value) => value.toFixed(3)).join(",");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function overlapsX(a: AxisAlignedBox, b: AxisAlignedBox): boolean {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0]
    && a.min[1] < b.max[1] && a.max[1] > b.min[1]
    && a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

function findBoardBox(snapshot: CachedSceneSnapshot): AxisAlignedBox | null {
  const fromFixtures = snapshot.fixtures.find((item) => /wall_board/i.test(item.name));
  return fromFixtures?.box ?? null;
}

function shiftBoxX(box: AxisAlignedBox, dx: number): AxisAlignedBox {
  return { min: [box.min[0] + dx, box.min[1], box.min[2]], max: [box.max[0] + dx, box.max[1], box.max[2]] };
}

/** Bed-frame point matching layout-search.ts assignmentCandidates head/long/side math. */
function bedsidePoint(snapshot: CachedSceneSnapshot, side: -1 | 1, alongMeters: number, acrossMeters: number): [number, number] | null {
  const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
  const support = [...snapshot.patientSupports].sort((a, b) =>
    (b.box.max[0] - b.box.min[0]) * (b.box.max[2] - b.box.min[2])
    - ((a.box.max[0] - a.box.min[0]) * (a.box.max[2] - a.box.min[2])))[0];
  if (!patient || !support) return null;
  const supportCentre = centre(support.box);
  const patientHead = actorSamplePoints(patient.box, patient.recumbent)[0]?.point ?? patient.chest;
  const width = support.box.max[0] - support.box.min[0], depth = support.box.max[2] - support.box.min[2];
  let long: [number, number] = width >= depth ? [1, 0] : [0, 1];
  if ((patientHead[0] - supportCentre[0]) * long[0] + (patientHead[2] - supportCentre[2]) * long[1] < 0) long = [-long[0], -long[1]];
  const sideVec: [number, number] = [-long[1], long[0]];
  const halfLong = (width >= depth ? width : depth) / 2;
  const head: [number, number] = [supportCentre[0] + long[0] * halfLong, supportCentre[2] + long[1] * halfLong];
  return [head[0] + long[0] * alongMeters + sideVec[0] * side * acrossMeters,
    head[1] + long[1] * alongMeters + sideVec[1] * side * acrossMeters];
}

function repairedLayout(snapshot: CachedSceneSnapshot, layout: LayoutRow[]): LayoutRow[] {
  return layout.map((row) => {
    if (/patient/i.test(row.actorId)) {
      const board = findBoardBox(snapshot);
      if (board && overlapsX(row.box, board)) {
        const need = board.max[0] + 0.03 - row.box.min[0];
        const dx = Math.max(0.08, need);
        const box = shiftBoxX(row.box, dx);
        return { ...row, world: [row.world[0] + dx, row.world[1], row.world[2]] as [number, number, number], box };
      }
      return row;
    }
    if (row.slotId !== "companion_chair") return row;
    const point = bedsidePoint(snapshot, -1, 0.15, 0.48);
    if (!point) return row;
    const patient = snapshot.actors.find((actor) => /patient/i.test(actor.id)) ?? snapshot.actors[0];
    const patientHead = patient
      ? (actorSamplePoints(patient.box, patient.recumbent)[0]?.point ?? patient.chest) : null;
    const heading = patientHead ? Math.atan2(patientHead[0] - point[0], patientHead[2] - point[1]) : row.headingRadians;
    const standingActor = snapshot.actors.find((actor) => actor.id === row.actorId);
    const capsule = capsuleForPlacement([point[0], row.world[1], point[1]],
      capsuleRadiusMeters(standingActor?.bodyDimensions), true);
    return { ...row, slotId: "companion_bedside", world: [point[0], row.world[1], point[1]] as [number, number, number],
      headingRadians: heading, box: capsule, standing: true };
  });
}

function stageOne(camera: GateCamera, actors: GateActor[]): { n: number; contained: boolean[]; facing: number; margin: number } {
  const matrices = cameraViewProjectionMatrices(camera);
  let n = 0, margin = Infinity;
  const contained: boolean[] = [];
  for (let index = 0; index < actors.length; index += 1) {
    const actor = actors[index], extent = actor
      ? projectBoxFromMatrices(matrices.view, matrices.projection, actor.box) : null;
    if (!actor || !extent) { margin = -1; contained.push(false); continue; }
    const inside = extent.minX >= -0.8 && extent.maxX <= 0.8 && extent.minY >= -0.8 && extent.maxY <= 0.8
      && (!actor.primary || extent.maxY - extent.minY >= 0.36);
    contained.push(inside);
    if (inside) n += 1;
    margin = Math.min(margin, extent.minX + 1, 1 - extent.maxX, extent.minY + 1, 1 - extent.maxY);
  }
  return { n, contained, facing: meanFacingDegrees(camera.eye, actors), margin: Number.isFinite(margin) ? margin : -1 };
}

function gateIsBetter(candidate: GateReading, incumbent: GateReading): boolean {
  if (candidate.gatePass !== incumbent.gatePass) return candidate.gatePass;
  if (candidate.visibleActors !== incumbent.visibleActors) return candidate.visibleActors > incumbent.visibleActors;
  if (Math.abs(candidate.meanFacingDeg - incumbent.meanFacingDeg) > 1e-9) return candidate.meanFacingDeg < incumbent.meanFacingDeg;
  if (Math.abs(candidate.nearOcclusionFraction - incumbent.nearOcclusionFraction) > 1e-9) {
    return candidate.nearOcclusionFraction < incumbent.nearOcclusionFraction;
  }
  return candidate.minMargin > incumbent.minMargin;
}

export function searchBestCamera(snapshot: CachedSceneSnapshot, layout: LayoutRow[]): CameraSearchResult | null {
  const fixed = repairedLayout(snapshot, layout);
  const scene = translatedScene(snapshot, fixed);
  const candidates: Array<{ camera: GateCamera; n: number; visible: number; contained: boolean[]; facing: number; margin: number; boundary: number }> = [];
  const eyeTerms = new Map<string, { visible: number; facing: number }>();
  for (const eye of eyes(snapshot, scene.looks[0] ?? snapshot.unionCentre)) {
    const key = eye.join(",");
    const visible = scene.actors.filter((actor) => actorCrownChestVisibleEarly(eye, actor, scene.occluders)).length;
    eyeTerms.set(key, { visible, facing: meanFacingDegrees(eye, scene.actors) });
    for (const look of scene.looks) for (const fov of [70, 80, 90] as const) {
    const camera: GateCamera = { eye, look, fov, aspect: snapshot.cameraAspect || 16 / 9 };
    const score = stageOne(camera, scene.actors);
    const boundary = Math.min(eye[0] - snapshot.interior.min[0], snapshot.interior.max[0] - eye[0],
      eye[2] - snapshot.interior.min[2], snapshot.interior.max[2] - eye[2]);
    const terms = eyeTerms.get(key);
    candidates.push({ camera, boundary, ...score, visible: terms?.visible ?? 0, facing: terms?.facing ?? score.facing });
    }
  }
  candidates.sort((a, b) => b.n - a.n || b.visible - a.visible || a.facing - b.facing || b.margin - a.margin
    || JSON.stringify(a.camera).localeCompare(JSON.stringify(b.camera)));
  const pool = candidates.slice(0, 192);
  pool.push(...[...candidates].sort((a, b) => b.n - a.n || b.margin - a.margin || a.facing - b.facing).slice(0, 192));
  pool.push(...[...candidates].sort((a, b) => b.n - a.n || b.boundary - a.boundary || a.facing - b.facing).slice(0, 192));
  const stride = Math.max(1, Math.floor(candidates.length / 256));
  for (let index = 0; index < candidates.length; index += stride) {
    const candidate = candidates[index];
    if (candidate) pool.push(candidate);
  }
  const seen = new Set<string>();
  const finalists = pool.filter((candidate) => {
    const key = JSON.stringify(candidate.camera);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  let best: (CameraSearchResult & { quick: GateReading }) | null = null;
  for (const candidate of finalists) {
    const near = measureNearOcclusion(candidate.camera, scene.occluders.map((item) => item.box));
    const quick: GateReading = { containedActors: candidate.n, totalActors: scene.actors.length, visibleActors: candidate.visible,
      crownChest: [], meanFacingDeg: candidate.facing, nearOcclusionFraction: near.fraction, nearRayCount: near.nearRayCount,
      minMargin: candidate.margin, gatePass: candidate.n === scene.actors.length && candidate.visible === scene.actors.length
        && candidate.facing <= 90 && near.fraction <= 0.1 };
    if (!best || gateIsBetter(quick, best.quick)) {
      best = { camera: candidate.camera, gate: quick, quick, layout: fixed };
    } else if (quick.visibleActors === scene.actors.length && best.quick.visibleActors === scene.actors.length
      && quick.gatePass === best.quick.gatePass
      && candidate.camera.fov === 90 && best.camera.fov !== 90
      && !gateIsBetter(best.quick, quick)) {
      best = { camera: candidate.camera, gate: quick, quick, layout: fixed };
    }
  }
  return best ? { camera: best.camera, gate: evaluateGate(best.camera, scene.actors, scene.occluders), layout } : null;
}

export function solveLayouts(snapshot: CachedSceneSnapshot, layouts: LayoutRow[][]): CameraSearchResult | null {
  let best: (CameraSearchResult & { slotCost: number }) | null = null;
  for (const layout of layouts.slice(0, 6)) {
    const result = searchBestCamera(snapshot, layout);
    if (!result) continue;
    const slotCost = layout.reduce((sum, row) => sum + row.cost, 0);
    const winsGate = best ? result.gate.gatePass !== best.gate.gatePass && result.gate.gatePass : true;
    const sameGate = best ? result.gate.gatePass === best.gate.gatePass : false;
    const winsVisible = best ? result.gate.visibleActors > best.gate.visibleActors : true;
    const sameVisible = best ? result.gate.visibleActors === best.gate.visibleActors : false;
    const winsSlot = best ? slotCost < best.slotCost - 1e-9 : true;
    const sameSlot = best ? Math.abs(slotCost - best.slotCost) <= 1e-9 : false;
    const winsRemainder = best ? gateIsBetter({ ...result.gate, gatePass: false, visibleActors: 0 },
      { ...best.gate, gatePass: false, visibleActors: 0 }) : true;
    if (!best || winsGate || (sameGate && (winsVisible || (sameVisible && (winsSlot || (sameSlot && winsRemainder)))))) {
      best = { ...result, slotCost };
    }
    if (best?.gate.gatePass && slotCost > best.slotCost) break;
  }
  return best;
}
