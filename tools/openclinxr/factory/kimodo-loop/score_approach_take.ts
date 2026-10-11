/**
 * Score a bound whole-approach take for seed selection, source-side (Kimodo export frame).
 *
 * Reads the station work dir (joints.json, contacts.json, profile.json, constraints.json)
 * and reports, in the take frame (Kimodo Y-up ground XZ):
 * - chordYawDeg: Hips travel direction over the translating span [stand0End, decelEnd]
 * - facingErrorDeg: mean |wrapped pelvis-forward vs chord| over the same span, where
 *   pelvis forward = up x lateral from the (RightLeg - LeftLeg) hip vector -- the same
 *   basis the bind stage builds it from (motion_bind_from_positions_stage.py `_basis_from_hips`).
 *   A rigid bind preserves relative angles, so source-side facing equals bound-side facing.
 * - lateralDriftM: max distance of Hips XZ from the CONSTRAINT path polyline over the whole
 *   take -- drift from the planned path, the selection gate, not from the take's own chord.
 * - endFacingErrorDeg: mean |wrapped pelvis-forward vs arrivalDelta| over the hold portion
 *   (diagnostic: did Kimodo honor the final-frames arrival heading).
 * - turnRootDisplacementM: Hips XZ travel inside [decelEnd, turnEnd] (~0 when the end turn
 *   pivots in place rather than veering).
 *
 * Stance slide median comes from measure_stop_oneshot.ts on the bound GLB (same instrument
 * as the stop-take sweep); runtime usability comes from the take-enabled assay row.
 *
 * Usage:
 *   mise exec -- tsx tools/openclinxr/factory/kimodo-loop/score_approach_take.ts \
 *     --work-dir .openclinxr/evidence/approach-take/work-physician-seed1 --out <row.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE_FPS = 30;

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function distToPolyline(px: number, pz: number, path: Array<[number, number]>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1]![0];
    const az = path[i - 1]![1];
    const bx = path[i]![0];
    const bz = path[i]![1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < best) best = d;
  }
  return best;
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i]!.replace(/^--/, "")] = argv[i + 1] ?? "";
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const workDir = args["work-dir"] ?? "";
  const outPath = args["out"] ?? "";
  if (!workDir || !outPath) throw new Error("required: --work-dir --out");

  const joints = JSON.parse(readFileSync(`${workDir}/joints.json`, "utf-8")) as Record<string, number[][]>;
  const profile = JSON.parse(readFileSync(`${workDir}/profile.json`, "utf-8")) as {
    boundaries: Record<string, number>;
    takeFrame: { arrivalDeltaRadians: number };
  };
  const constraints = JSON.parse(readFileSync(`${workDir}/constraints.json`, "utf-8")) as Array<{
    smooth_root_2d: Array<[number, number]>;
  }>;
  const path = (constraints[0]?.smooth_root_2d ?? []).map(([x, z]) => [x, z] as [number, number]);

  // Blender Z-up export -> Kimodo Y-up ground XZ: kx = bx, kz = -by.
  const hips = (joints["Hips"] ?? []).map((p) => ({ x: p[0]!, z: -p[1]! }));
  const legL = joints["LeftLeg"] ?? [];
  const legR = joints["RightLeg"] ?? [];
  if (hips.length < 2 || legL.length !== hips.length || legR.length !== hips.length) {
    throw new Error("Hips/LeftLeg/RightLeg tracks missing or mismatched in joints.json");
  }
  const frameAt = (t: number): number => Math.max(0, Math.min(hips.length - 1, Math.round(t * SOURCE_FPS)));
  const b = profile.boundaries;
  const walkStart = frameAt(b["stand0End"] ?? 0);
  const walkEnd = Math.max(walkStart + 1, frameAt(b["decelEnd"] ?? 0));
  const turnEnd = frameAt(b["turnEnd"] ?? walkEnd / SOURCE_FPS);

  // Chord over the translating span; glTF/Kimodo yaw atan2(dx, dz) on ground XZ.
  const c0 = hips[walkStart]!;
  const c1 = hips[walkEnd]!;
  const chordYaw = Math.atan2(c1.x - c0.x, c1.z - c0.z);
  const chordLen = Math.hypot(c1.x - c0.x, c1.z - c0.z);

  // Per-frame pelvis-forward yaw from the hip vector; forward = up x lateral.
  const forwardYawAt = (i: number): number => {
    // Lateral in Kimodo ground XZ: (kx, kz) = (bx, -by).
    const latX = legR[i]![0]! - legL[i]![0]!;
    const latZ = -(legR[i]![1]! - legL[i]![1]!);
    // forward = up(0,1,0) x lateral: (fz? ) (1*lz - 0, 0 - 0, 0 - 1*lx) -> (latZ, -latX) in (x, z).
    return Math.atan2(latZ, -latX);
  };

  let facingSum = 0;
  let facingCount = 0;
  for (let i = walkStart; i <= walkEnd; i += 1) {
    facingSum += Math.abs(wrapPi(forwardYawAt(i) - chordYaw));
    facingCount += 1;
  }
  const facingErrorDeg = ((facingSum / Math.max(1, facingCount)) * 180) / Math.PI;

  let lateralDriftM = 0;
  for (const h of hips) {
    const d = distToPolyline(h.x, h.z, path);
    if (d > lateralDriftM) lateralDriftM = d;
  }

  const arrivalDelta = profile.takeFrame.arrivalDeltaRadians;
  let endSum = 0;
  let endCount = 0;
  for (let i = turnEnd; i < hips.length; i += 1) {
    endSum += Math.abs(wrapPi(forwardYawAt(i) - arrivalDelta));
    endCount += 1;
  }
  const endFacingErrorDeg = endCount > 0 ? ((endSum / endCount) * 180) / Math.PI : null;

  let turnRootDisplacementM = 0;
  {
    const t0 = hips[Math.min(walkEnd, hips.length - 1)]!;
    const t1 = hips[Math.min(turnEnd, hips.length - 1)]!;
    turnRootDisplacementM = Math.hypot(t1.x - t0.x, t1.z - t0.z);
  }

  const row = {
    chordYawDeg: (chordYaw * 180) / Math.PI,
    walkChordLenM: chordLen,
    facingErrorDeg,
    facingFrames: facingCount,
    lateralDriftM,
    endFacingErrorDeg,
    turnRootDisplacementM,
  };
  writeFileSync(outPath, `${JSON.stringify(row, null, 2)}\n`);
  console.log(JSON.stringify(row));
}

await main();
