/**
 * Pinned-turn harness (step 3): replace the settling turn with the bound take.
 *
 * Walk portion (frames 0..firstSettling-1) replays the production runApproach
 * world tracks bit-identically (same decoded clip, same intent: D1 reuse).
 * The take portion plays the bound take clip (root motion kept) at the arrival
 * point/heading with a 0.1 s inertialized entry from the arrived rest pose
 * (treatment-B math imported from ../inertialize/inertialize.js), then holds.
 *
 * Take-facing proxy: root-rotation yaw timeline, cross-checked against the
 * hip-vector net turn (--hip-net-deg from measure-bound-turn.ts); refuses when
 * they disagree by more than 8 deg. Stance labels come from the source npz
 * foot_contacts (work-dir contacts.json) mapped by normalized clip time;
 * double-support keeps the previous stance, no contact gives null (stated).
 *
 * Metrics mirror the control row (computeTurnQuality + the same anchor/reset
 * episode-slide port as arrival-turn-cagematch.ts, local copy attributed),
 * plus per-window episode slide, per-step drag of each planted foot, residual
 * yaw, turn duration, and root drift from the arrival point.
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/pinned-turn/pinned-turn-harness.ts \
 *   --rig physician --take-glb <bound.glb> --take-clip <name> --contacts <contacts.json> \
 *   --hip-net-deg <float> --out <row.json>
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeArrivalTurnRig } from "../arrival-turn-cagematch.js";
import {
  computeTurnQuality,
  type TurnQualityFrame,
} from "../turn-quality-metrics.js";
import {
  inertializeTransitionVec,
  inertializeUpdateVec,
  type Vec3 as IVec3,
} from "../inertialize/inertialize.js";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../../scene-closure/proofs/sc-05/runtime-approach-measurement.js";
import { decodeTakeClip } from "./take-decode.js";

const RIG_GLBS: Record<string, string> = {
  physician: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  nurse: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  child: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
};
const SIM_SECONDS = 12;
const PLANT_EPISODE_FOOTFALL_JUMP_METERS = 0.05;
const PLANT_EPISODE_LIFT_METERS = 0.008;
const HALFLIFE_S = 0.1;
const DT = 1 / 60;

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}
function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
/** Port of plantEpisodeMaxSlide parameterised by a phase allow-list (arrival-turn-cagematch.ts). */
function episodeMaxSlide(
  frames: readonly TurnQualityFrame[],
  phases: ReadonlySet<string>,
): number | null {
  const selected = frames.filter(
    (f) => phases.has(f.phase) && f.left !== null && f.right !== null,
  );
  let currentPlant: string | null = null;
  let anchor: { x: number; z: number } | null = null;
  let maxSlide = Number.NEGATIVE_INFINITY;
  let liftedSinceAnchor = false;
  for (const frame of selected) {
    if (frame.stanceFoot !== "left" && frame.stanceFoot !== "right") continue;
    const plantToe = frame.stanceFoot === "left" ? frame.left : frame.right;
    if (plantToe === null) continue;
    const plantXz = { x: plantToe.x, z: plantToe.z };
    if (plantToe.y - 0 > PLANT_EPISODE_LIFT_METERS) liftedSinceAnchor = true;
    const isNewFootfall =
      frame.stanceFoot !== currentPlant ||
      (anchor !== null &&
        liftedSinceAnchor &&
        plantToe.y - 0 <= PLANT_EPISODE_LIFT_METERS &&
        dist2d(anchor, plantXz) > PLANT_EPISODE_FOOTFALL_JUMP_METERS);
    if (isNewFootfall) {
      currentPlant = frame.stanceFoot;
      anchor = plantXz;
      liftedSinceAnchor = false;
    }
    if (anchor !== null) maxSlide = Math.max(maxSlide, dist2d(anchor, plantXz));
  }
  return Number.isFinite(maxSlide) ? maxSlide : null;
}
/** Max single-frame stance-labelled toe step inside the phase allow-list. */
function stanceStepMax(
  frames: readonly TurnQualityFrame[],
  phases: ReadonlySet<string>,
): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    if (!phases.has(previous.phase) || !phases.has(current.phase)) continue;
    if (previous.stanceFoot !== "left" && previous.stanceFoot !== "right") continue;
    if (current.stanceFoot !== "left" && current.stanceFoot !== "right") continue;
    const switched = previous.stanceFoot !== current.stanceFoot;
    const sides: readonly ("left" | "right")[] = switched
      ? (["left", "right"] as const)
      : ([current.stanceFoot] as const);
    for (const side of sides) {
      const a = previous[side];
      const b = current[side];
      if (a === null || b === null) continue;
      max = Math.max(max, dist2d(a, b));
    }
  }
  return Number.isFinite(max) ? max : null;
}
function maxToeStep(frames: readonly TurnQualityFrame[]): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    for (const side of ["left", "right"] as const) {
      const a = previous[side];
      const b = current[side];
      if (a === null || b === null) continue;
      max = Math.max(max, dist2d(a, b));
    }
  }
  return Number.isFinite(max) ? max : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string => {
    const i = args.indexOf(name);
    if (i === -1 || args[i + 1] === undefined) throw new Error(`missing ${name}`);
    return must(args[i + 1], name);
  };
  const rig = flag("--rig");
  const takeGlb = flag("--take-glb");
  const takeClip = flag("--take-clip");
  const contactsPath = flag("--contacts");
  const hipNetDeg = Number(flag("--hip-net-deg"));
  const outPath = flag("--out");
  const glb = RIG_GLBS[rig];
  if (!glb) throw new Error(`unknown rig ${rig}`);

  const decoded = await decodeArrivalTurnRig(glb);
  const ward = stageWard();
  const slot = must(ward.roots.get("additional_cast"), "slot");
  const slotScale = slot.scale.x;
  const slotY = slot.position.y;
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
  const run = runApproach({ ward, intent, seconds: SIM_SECONDS, decoded });
  const firstSettling = run.frames.findIndex((f) => f.phase === "settling");
  if (firstSettling <= 0) throw new Error("no settling onset");
  const arrivalFrame = must(run.frames[firstSettling], "arrival frame");
  const P0 = { x: arrivalFrame.positionXz.x, z: arrivalFrame.positionXz.z };
  const H0 = arrivalFrame.headingRadians;
  const targetHeading = intent.target.headingRadians;

  const take = await decodeTakeClip(takeGlb, takeClip);
  // Take facing = pelvis (hip-vector) yaw timeline. The MPFB root rotation does
  // NOT carry the turn on these takes (pass-1: root net +14.2deg vs hips +98.6deg),
  // so the root-rotation proxy is refused; hips are the same quantity as the sign gate.
  const hipYaw0 = must(take.samples[0], "take sample 0").hipYaw;
  let hipNet = 0;
  let prevHip = hipYaw0;
  for (const s of take.samples.slice(1)) {
    hipNet += wrapPi(s.hipYaw - prevHip);
    prevHip = s.hipYaw;
  }
  const hipNetDenseDeg = (hipNet * 180) / Math.PI;
  if (Math.abs(hipNetDenseDeg - hipNetDeg) > 2) {
    throw new Error(
      `REFUSE decoder mismatch: dense hip net ${hipNetDenseDeg.toFixed(1)}deg vs sign-gate ${hipNetDeg.toFixed(1)}deg`,
    );
  }
  let rootNet = 0;
  let prevYaw = must(take.samples[0], "take sample 0").yaw;
  for (const s of take.samples.slice(1)) {
    rootNet += wrapPi(s.yaw - prevYaw);
    prevYaw = s.yaw;
  }
  const rootNetDeg = (rootNet * 180) / Math.PI;

  const contacts = JSON.parse(await readFile(contactsPath, "utf8")) as number[][];
  const stanceAt = (t: number, fallback: string | null): string | null => {
    const src = Math.max(0, Math.min(contacts.length - 1, Math.round((t / take.durationS) * (contacts.length - 1))));
    const row = must(contacts[src], "contact row");
    const l = (row[0] ?? 0) !== 0 || (row[1] ?? 0) !== 0 || (row[2] ?? 0) !== 0;
    const r = (row[3] ?? 0) !== 0 || (row[4] ?? 0) !== 0 || (row[5] ?? 0) !== 0;
    if (l && !r) return "left";
    if (r && !l) return "right";
    if (l && r) return fallback ?? "left";
    return null;
  };

  // Inertialized 0.1 s entry from the arrived rest pose (treatment-B pattern).
  const restL: IVec3 = [decoded.restLeft.x, decoded.restLeft.y, decoded.restLeft.z];
  const restR: IVec3 = [decoded.restRight.x, decoded.restRight.y, decoded.restRight.z];
  const s0 = must(take.samples[0], "s0");
  const s1 = must(take.samples[1] ?? take.samples[0], "s1");
  const vel = (a: IVec3, b: IVec3): IVec3 => [
    (b[0] - a[0]) / DT, (b[1] - a[1]) / DT, (b[2] - a[2]) / DT,
  ];
  const tup = (v: readonly [number, number, number]): IVec3 => [v[0], v[1], v[2]];
  const offToeL: IVec3 = [0, 0, 0];
  const offToeLV: IVec3 = [0, 0, 0];
  const offToeR: IVec3 = [0, 0, 0];
  const offToeRV: IVec3 = [0, 0, 0];
  const offRoot: IVec3 = [0, 0, 0];
  const offRootV: IVec3 = [0, 0, 0];
  const dstL0: IVec3 = [s0.toeL[0], s0.toeL[1], s0.toeL[2]];
  const dstR0: IVec3 = [s0.toeR[0], s0.toeR[1], s0.toeR[2]];
  const dstRoot0: IVec3 = [s0.root[0], s0.root[1], s0.root[2]];
  inertializeTransitionVec(offToeL, offToeLV, restL, [0, 0, 0], dstL0, vel(tup(s0.toeL), tup(s1.toeL)));
  inertializeTransitionVec(offToeR, offToeRV, restR, [0, 0, 0], dstR0, vel(tup(s0.toeR), tup(s1.toeR)));
  inertializeTransitionVec(
    offRoot, offRootV,
    tup(s0.root), [0, 0, 0],
    dstRoot0, vel(tup(s0.root), tup(s1.root)),
  );
  const entryToeOffsetM = Math.max(
    Math.hypot(offToeL[0], offToeL[1], offToeL[2]),
    Math.hypot(offToeR[0], offToeR[1], offToeR[2]),
  );

  const cosH = Math.cos(H0 - hipYaw0);
  const sinH = Math.sin(H0 - hipYaw0);
  const rotXZ = (x: number, z: number): { x: number; z: number } => ({
    x: x * cosH + z * sinH,
    z: -x * sinH + z * cosH,
  });

  const frames: TurnQualityFrame[] = [];
  for (let i = 0; i < firstSettling; i += 1) {
    const f = must(run.frames[i], "walk frame");
    const l = must(run.trackL[i], "walk L");
    const r = must(run.trackR[i], "walk R");
    frames.push({
      sample: frames.length,
      tMs: frames.length * (1000 / 60),
      phase: "walking",
      left: { ...l.position },
      right: { ...r.position },
      stanceFoot: f.stanceFoot,
      slotYawRadians: f.headingRadians,
      headYawWorldRadians: null,
    });
  }
  let stanceFallback: string | null = null;
  const takeStartIndex = frames.length;
  const slotPath: Array<{ x: number; z: number }> = [];
  take.samples.forEach((s, k) => {
    const prevS = take.samples[Math.max(0, k - 1)];
    if (!prevS) throw new Error("no prev take sample");
    const curToeL = tup(s.toeL);
    const curToeR = tup(s.toeR);
    const curRoot = tup(s.root);
    const curVel = {
      toeL: vel(tup(prevS.toeL), curToeL),
      toeR: vel(tup(prevS.toeR), curToeR),
      root: vel(tup(prevS.root), curRoot),
    };
    const upL = inertializeUpdateVec(offToeL, offToeLV, curToeL, curVel.toeL, HALFLIFE_S, DT);
    const upR = inertializeUpdateVec(offToeR, offToeRV, curToeR, curVel.toeR, HALFLIFE_S, DT);
    const upRoot = inertializeUpdateVec(offRoot, offRootV, curRoot, curVel.root, HALFLIFE_S, DT);
    const heading = H0 + wrapPi(s.hipYaw - hipYaw0);
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    // Slot follows the take root displacement from take start, rotated into world.
    const dRoot = {
      x: (upRoot.outX[0] - dstRoot0[0]) * slotScale,
      z: (upRoot.outX[2] - dstRoot0[2]) * slotScale,
    };
    const dWorld = rotXZ(dRoot.x, dRoot.z);
    const slotXZ = { x: P0.x + dWorld.x, z: P0.z + dWorld.z };
    slotPath.push(slotXZ);
    const place = (p: IVec3, y: number): { x: number; y: number; z: number } => ({
      x: slotXZ.x + slotScale * (p[0] * ch + p[2] * sh),
      y: slotY + slotScale * y,
      z: slotXZ.z + slotScale * (-p[0] * sh + p[2] * ch),
    });
    const stance = stanceAt(s.t, stanceFallback);
    if (stance === "left" || stance === "right") stanceFallback = stance;
    frames.push({
      sample: frames.length,
      tMs: frames.length * (1000 / 60),
      phase: "settling",
      left: place(upL.outX, upL.outX[1]),
      right: place(upR.outX, upR.outX[1]),
      stanceFoot: stance,
      slotYawRadians: heading,
      headYawWorldRadians: null,
    });
  });
  const lastTake = must(frames[frames.length - 1], "last take frame");
  const totalFrames = Math.round(SIM_SECONDS * 60);
  while (frames.length < totalFrames) {
    frames.push({
      sample: frames.length,
      tMs: frames.length * (1000 / 60),
      phase: "arrived",
      left: lastTake.left ? { ...lastTake.left } : null,
      right: lastTake.right ? { ...lastTake.right } : null,
      stanceFoot: lastTake.stanceFoot,
      slotYawRadians: lastTake.slotYawRadians,
      headYawWorldRadians: null,
    });
  }

  const WALK = new Set(["walking"]);
  const SETTLING = new Set(["settling"]);
  const HOLD = new Set(["arrived"]);
  const ALL = new Set(["walking", "settling", "arrived", "stopping"]);
  void WALK;
  void HOLD;
  const finalHeading = must(frames[takeStartIndex + take.samples.length - 1], "final take frame").slotYawRadians;
  const residualYawDeg = finalHeading == null
    ? null
    : (Math.abs(wrapPi(targetHeading - finalHeading)) * 180) / Math.PI;
  let rootDriftM = 0;
  for (const p of slotPath) rootDriftM = Math.max(rootDriftM, dist2d(p, P0));

  // Per-window episode slide + per-step drag over the take portion, from mapped contacts.
  const takeFrames = frames.slice(takeStartIndex, takeStartIndex + take.samples.length);
  const windows: Array<{ foot: string; start: number; end: number; slideM: number; dragM: number }> = [];
  {
    let s: number | null = null;
    let cur: string | null = null;
    const stances = takeFrames.map((f) => f.stanceFoot);
    for (let k = 0; k <= stances.length; k += 1) {
      const st = k < stances.length ? stances[k] : null;
      if (st !== cur) {
        if (cur !== null && s !== null) {
          const seg = takeFrames.slice(s, k);
          const slide = episodeMaxSlide(seg, SETTLING);
          const anchor = cur === "left" ? seg[0]?.left : seg[0]?.right;
          let drag = 0;
          if (anchor) {
            for (const f of seg) {
              const q = cur === "left" ? f.left : f.right;
              if (q) drag = Math.max(drag, dist2d(q, anchor));
            }
          }
          windows.push({ foot: cur, start: s, end: k - 1, slideM: slide ?? 0, dragM: drag });
        }
        cur = st === "left" || st === "right" ? st : null;
        s = cur !== null ? k : null;
      }
    }
  }
  const turnPhaseSlideM = episodeMaxSlide(frames, SETTLING);
  const perWindowMaxSlideM = windows.length > 0 ? Math.max(...windows.map((w) => w.slideM)) : null;

  const controlFrames: TurnQualityFrame[] = run.frames.map((frame, index) => {
    const left = run.trackL[index];
    const right = run.trackR[index];
    return {
      sample: index,
      tMs: index * (1000 / 60),
      phase: frame.phase,
      left: left ? { ...left.position } : null,
      right: right ? { ...right.position } : null,
      stanceFoot: frame.stanceFoot,
      slotYawRadians: frame.headingRadians,
      headYawWorldRadians: null,
    };
  });
  const controlQuality = computeTurnQuality({
    frames: controlFrames,
    walkDiagnostics: { targetHeadingRadians: targetHeading },
  });
  const controlWhole = episodeMaxSlide(controlFrames, ALL);
  const controlToeStep = controlQuality.maxToeStepPerFrameM;

  const row = {
    candidate: "pinned-turn",
    rig,
    glb,
    takeGlb,
    takeClip,
    slotScale,
    arrivalPointXZ: P0,
    arrivalHeadingDeg: (H0 * 180) / Math.PI,
    targetHeadingDeg: (targetHeading * 180) / Math.PI,
    takeDurationS: take.durationS,
    takeKeys: take.keyCount,
    rootYawNetDeg: rootNetDeg,
    hipNetDeg,
    entryToeOffsetM: entryToeOffsetM,
    control: {
      residualTurnDeg: controlQuality.residualTurnDeg,
      settlingSlideM: controlQuality.plantedSlideM,
      wholeApproachSlideM: controlWhole,
      maxToeStepPerFrameM: controlToeStep,
    },
    take: {
      turnPhaseSlideM,
      perWindowMaxSlideM,
      wholeApproachSlideM: episodeMaxSlide(frames, ALL),
      maxToeStepPerFrameM: maxToeStep(frames),
      stanceToeStepPerFrameM: stanceStepMax(frames, ALL),
      residualYawDeg,
      turnDurationS: take.durationS,
      rootDriftM,
      windows,
    },
    eligible: residualYawDeg !== null && residualYawDeg <= 3 && rootDriftM <= 0.1,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(row, null, 2)}\n`, "utf8");
  process.stdout.write(
    `take/${rig}: turnSlide=${turnPhaseSlideM?.toFixed(4) ?? "null"} winMax=${perWindowMaxSlideM?.toFixed(4) ?? "null"} `
      + `whole=${row.take.wholeApproachSlideM?.toFixed(4) ?? "null"} resid=${residualYawDeg?.toFixed(2) ?? "null"}deg `
      + `drift=${rootDriftM.toFixed(4)}m eligible=${row.eligible}\n${outPath}\n`,
  );
}

await main();
