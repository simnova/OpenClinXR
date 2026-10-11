import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import {
  buildMirrorAtClipTime,
  readMirrorSource,
} from "./ik-noop-probe.js";
import {
  findSteppingLegChain,
  heelTargetForToeTargetStable,
  planSteppingTurn,
  solveSteppingLegHinge,
  steppingTurnAt,
  steppingTurnLegScale,
  worldXyz,
} from "@openclinxr/xr-humanoid-animation/stepping-turn";
import { decodeArrivalTurnRig } from "../arrival-turn-cagematch.js";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../../scene-closure/proofs/sc-05/runtime-approach-measurement.js";

/**
 * STEP 4 bake (2026-10-11): bake the physician's stepping turn into a self-contained GLB
 * for the side-view strip render.
 *
 * Contents: the SHIPPED physician bytes plus one new `stepping_turn_arrival` action —
 * per-frame leg-bone rotations (idle upper body, CCD-posed legs) and skeleton-root
 * translation+rotation carrying the PRODUCTION slot path (authoritative assay recording,
 * not a re-simulation). The plan is rebuilt from the run's own settling-entry pose;
 * per-frame targets come from the production evaluator; leg poses come from the
 * production CCD on a live mirror of the shipped hierarchy (STEP-1 proven: 0.0000 m
 * no-op miss). Feet keep the idle orientation (CCD rotates leg joints only).
 *
 * claimScope: a renderable bake of the assayed turn for visual grading.
 * notEvidenceFor: runtime slide (STEP 3), gait realism, or clinical plausibility.
 */

const RIGS = [
  { rig: "physician", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb" },
  { rig: "nurse", glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb" },
  { rig: "child", glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb" },
] as const;
const IDLE_CLIP = "ClinicalIdleConversation";
const BAKED_CLIP = "stepping_turn_arrival";
const SIM_SECONDS = 12;
const DT = 1 / 60;

function numAt(arr: ArrayLike<number>, i: number, what: string): number {
  const v = arr[i];
  if (typeof v !== "number") throw new Error(`missing ${what}[${i}]`);
  return v;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    const v = args[i + 1];
    return i >= 0 ? (v ?? fallback) : fallback;
  };
  const rigFilter = flagValue("--rig", "");
  const outGlbFlag = flagValue("--out", "");
  const outMetaFlag = flagValue("--meta", "");

  for (const { rig, glb } of RIGS) {
    if (rigFilter && rig !== rigFilter) continue;
    const outGlb = outGlbFlag !== "" ? outGlbFlag : `.openclinxr/evidence/stepping-turn/stepping-turn-bake-${rig}.glb`;
    const outMeta = outMetaFlag !== "" ? outMetaFlag : `.openclinxr/evidence/stepping-turn/bake-meta-${rig}.json`;
    await bakeRig(rig, glb, outGlb, outMeta);
  }
}

async function bakeRig(rig: string, glbPath: string, outGlb: string, outMeta: string): Promise<void> {
  // Authoritative production run: slot path + yaw + tracks.
  const decoded = await decodeArrivalTurnRig(glbPath);
  const ward = stageWard();
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
  const slotXzByFrame = new Map<number, { x: number; z: number }>();
  const run = runApproach({
    ward,
    intent,
    seconds: SIM_SECONDS,
    decoded,
    steppingTurnEnabled: true,
    recordLock: (frameIndex, _correction, slotXz) => {
      slotXzByFrame.set(frameIndex, { ...slotXz });
    },
  });
  const slotStaged = ward.roots.get("additional_cast");
  if (!slotStaged) throw new Error("additional_cast slot missing");
  const assayScale = slotStaged.scale.x;
  const assaySlotY = slotStaged.position.y;

  const settlingIndices: number[] = [];
  run.frames.forEach((f, i) => {
    if (f.phase === "settling") settlingIndices.push(i);
  });
  if (settlingIndices.length === 0) throw new Error("no settling frames");
  const entryIdx = settlingIndices[0];
  if (entryIdx === undefined) throw new Error("no settling entry");
  const entryL = run.trackL[entryIdx];
  const entryR = run.trackR[entryIdx];
  const entryFrame = run.frames[entryIdx];
  if (!entryL || !entryR || !entryFrame) throw new Error("no entry track");
  const targetHeading = intent.target.headingRadians;

  // Mirror: idle body, assay scale. Legs are CCD-posed per frame below.
  const { doc, source } = await readMirrorSource(glbPath, IDLE_CLIP);
  const tIdle = source.tMin + 0.25 * (source.tMax - source.tMin);
  const { slot, objs } = buildMirrorAtClipTime(source, IDLE_CLIP, tIdle, assayScale);
  const objByName = (name: string): Object3D => {
    const o = objs.get(name);
    if (!o) throw new Error(`missing mirror object ${name}`);
    return o;
  };
  // Skeleton root: the scene child whose subtree holds the leg chain.
  const legProbe = objByName("upperleg01.L");
  let skeletonRoot: Object3D = legProbe;
  while (skeletonRoot.parent !== null && skeletonRoot.parent !== slot) {
    const parent = skeletonRoot.parent;
    if (!parent) break;
    skeletonRoot = parent;
  }
  if (skeletonRoot.parent !== slot) throw new Error("skeleton root is not a scene child");
  const skeletonNames = new Set<string>();
  const collectNames = (node: Object3D): void => {
    skeletonNames.add(node.name);
    for (const child of node.children) collectNames(child);
  };
  collectNames(skeletonRoot);
  const rootNode = source.byName.get(skeletonRoot.name);
  if (!rootNode) throw new Error(`no GLB node ${skeletonRoot.name}`);
  const bindT = rootNode.getTranslation() ?? [0, 0, 0];
  const bindR = rootNode.getRotation() ?? [0, 0, 0, 1];
  const bindS = rootNode.getScale() ?? [1, 1, 1];
  const bindM = new Matrix4().compose(
    new Vector3(numAt(bindT, 0, "bindT"), numAt(bindT, 1, "bindT"), numAt(bindT, 2, "bindT")),
    new Quaternion(numAt(bindR, 0, "bindR"), numAt(bindR, 1, "bindR"), numAt(bindR, 2, "bindR"), numAt(bindR, 3, "bindR")),
    new Vector3(numAt(bindS, 0, "bindS"), numAt(bindS, 1, "bindS"), numAt(bindS, 2, "bindS")),
  );

  // Per settling frame: authoritative slot motion + production targets + production CCD.
  const times: number[] = [];
  const rootT: number[][] = [];
  const rootR: number[][] = [];
  const boneQuats = new Map<string, number[][]>();
  const scratchT = new Vector3();
  const scratchR = new Quaternion();
  const scratchS = new Vector3();
  const slotM = new Matrix4();
  const yawQ = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  // Idle reference (source 1): the actor's own standing hip height. The mirror starts in
  // the idle pose, so record it before the per-frame CCD reshapes the legs.
  slot.updateMatrixWorld(true);
  const idleHipY = (worldXyz(objByName("upperleg01.L")).y + worldXyz(objByName("upperleg01.R")).y) / 2;
  // Idle rest orientations for the hinge's frozen joints (explicit: previous frames'
  // solves must not leak into the taut-regime knee placement).
  const idleQuat = (name: string): { x: number; y: number; z: number; w: number } => {
    const q = objByName(name).quaternion;
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  };
  const idleRest = (suffix: "L" | "R"): {
    upper: { x: number; y: number; z: number; w: number };
    lower: { x: number; y: number; z: number; w: number };
  } => ({
    upper: idleQuat(`upperleg02.${suffix}`),
    lower: idleQuat(`lowerleg02.${suffix}`),
  });
  const idleRestL = idleRest("L");
  const idleRestR = idleRest("R");
  // Yaw-stable heel mapping (production contract): capture each side's toe-minus-heel
  // offset once at idle, then rotate with slot yaw only. Re-reading the live offset
  // every frame feeds solved orientations back into the next target (measured 120 deg
  // of offset swing and 11 cm of heel overshoot).
  slot.updateMatrixWorld(true);
  const captureOffset = (suffix: "L" | "R"): { offset: { x: number; y: number; z: number }; yaw: number } => {
    const heel = worldXyz(objByName(`foot.${suffix}`));
    const toe = worldXyz(objByName(`toe1-1.${suffix}`));
    return { offset: { x: toe.x - heel.x, y: toe.y - heel.y, z: toe.z - heel.z }, yaw: 0 };
  };
  const offsetL = captureOffset("L");
  const offsetR = captureOffset("R");
  // Baseline source: the idle mirror's own toe heights — the rig's natural standing toe
  // height in this world, the bake-side equivalent of the production rest snapshot
  // (rotation about Y preserves Y, so the assay slot yaw at capture is irrelevant).
  const idleToeBaselineY = Math.min(worldXyz(objByName("toe1-1.L")).y, worldXyz(objByName("toe1-1.R")).y);
  // Same plan construction as production (even split; a yaw-split optimizer was
  // tried and removed after measuring the hold offset invariant across shares).
  const entrySlot = slotXzByFrame.get(entryIdx);
  if (!entrySlot) throw new Error("no entry slot path");
  const bakePlanInput = {
    residualYawRadians: Math.atan2(
      Math.sin(targetHeading - entryFrame.headingRadians),
      Math.cos(targetHeading - entryFrame.headingRadians),
    ),
    entryYawRadians: entryFrame.headingRadians,
    targetHeadingRadians: targetHeading,
    leftToeXz: { x: entryL.position.x, z: entryL.position.z },
    rightToeXz: { x: entryR.position.x, z: entryR.position.z },
    leftToeY: entryL.position.y,
    rightToeY: entryR.position.y,
    stanceBaselineY: idleToeBaselineY,
    entrySlotXz: { x: entrySlot.x, z: entrySlot.z },
    legScale: steppingTurnLegScale(run.restSepXzM),
  };
  const plan = planSteppingTurn(bakePlanInput);
  // Per-frame pose metrics: knee flexion (0 = straight), hip-midpoint height, and knee
  // back-bow (signed meters along the facing pole; negative = behind the hip-ankle line).
  const measureLeg = (suffix: "L" | "R", pole: Vector3): { flexDeg: number; bowM: number } => {
    const hip = worldXyz(objByName(`upperleg01.${suffix}`));
    const knee = worldXyz(objByName(`lowerleg01.${suffix}`));
    const heel = worldXyz(objByName(`foot.${suffix}`));
    const thigh = new Vector3(knee.x - hip.x, knee.y - hip.y, knee.z - hip.z);
    const shin = new Vector3(heel.x - knee.x, heel.y - knee.y, heel.z - knee.z);
    const tl = thigh.length();
    const sl = shin.length();
    const cos = tl > 1e-9 && sl > 1e-9
      ? Math.min(1, Math.max(-1, thigh.dot(shin) / (tl * sl)))
      : 1;
    // Closest point on the hip->heel line to the knee, signed along the pole.
    const hipV = new Vector3(hip.x, hip.y, hip.z);
    const heelV = new Vector3(heel.x, heel.y, heel.z);
    const kneeV = new Vector3(knee.x, knee.y, knee.z);
    const axis = heelV.clone().sub(hipV);
    const axisLenSq = axis.lengthSq();
    const u = axisLenSq > 1e-12 ? Math.min(1, Math.max(0, kneeV.clone().sub(hipV).dot(axis) / axisLenSq)) : 0;
    const closest = hipV.add(axis.multiplyScalar(u));
    const bowM = kneeV.sub(closest).dot(pole);
    return { flexDeg: (Math.acos(cos) * 180) / Math.PI, bowM };
  };
  const flexL: number[] = [];
  const flexR: number[] = [];
  const hipY: number[] = [];
  const bowMin: number[] = [];
  const swingSide: string[] = [];
  const missWorst: number[] = [];
  settlingIndices.forEach((frameIndex, k) => {
    const frame = run.frames[frameIndex];
    if (!frame) throw new Error(`no frame ${frameIndex}`);
    const slotXz = slotXzByFrame.get(frameIndex);
    if (!slotXz) throw new Error(`no slot path at ${frameIndex}`);
    const targets = steppingTurnAt(plan, k * DT);
    slot.rotation.y = frame.headingRadians;
    slot.position.set(slotXz.x, assaySlotY - targets.pelvisDipM, slotXz.z);
    slot.updateMatrixWorld(true);
    // Production hinge path (frozen mids already idle in this mirror; pole = facing).
    const bakePole = {
      x: Math.sin(frame.headingRadians),
      y: 0,
      z: Math.cos(frame.headingRadians),
    };
    for (const side of ["left", "right"] as const) {
      const chain = findSteppingLegChain(slot, side);
      if (chain === null) throw new Error(`no mirror chain for ${side}`);
      const toeTarget = side === targets.stanceFoot ? targets.stanceToe : targets.swingToe;
      const captured = side === "left" ? offsetL : offsetR;
      const solved = solveSteppingLegHinge({
        chain,
        heelTargetWorld: heelTargetForToeTargetStable({
          toeTargetWorld: toeTarget,
          slotYawRadians: frame.headingRadians,
          offsetEntry: captured.offset,
          offsetYawRadians: captured.yaw,
        }),
        poleWorld: bakePole,
        midRestQuats: side === "left" ? idleRestL : idleRestR,
      });
      missWorst.push(solved.missM);
    }
    slot.updateMatrixWorld(true);
    // Pose metrics off the solved legs, before the quats are recorded below.
    const pole = new Vector3(Math.sin(frame.headingRadians), 0, Math.cos(frame.headingRadians));
    const mL = measureLeg("L", pole);
    const mR = measureLeg("R", pole);
    flexL.push(mL.flexDeg);
    flexR.push(mR.flexDeg);
    bowMin.push(Math.min(mL.bowM, mR.bowM));
    hipY.push((worldXyz(objByName("upperleg01.L")).y + worldXyz(objByName("upperleg01.R")).y) / 2);
    swingSide.push(targets.swingFoot);
    // Root motion = authoritative slot composed over the root bind.
    yawQ.setFromAxisAngle(yAxis, frame.headingRadians);
    slotM.compose(
      new Vector3(slotXz.x, assaySlotY - targets.pelvisDipM, slotXz.z),
      yawQ,
      new Vector3(assayScale, assayScale, assayScale),
    );
    const composed = slotM.multiply(bindM);
    composed.decompose(scratchT, scratchR, scratchS);
    times.push(k * DT);
    rootT.push([scratchT.x, scratchT.y, scratchT.z]);
    rootR.push([scratchR.x, scratchR.y, scratchR.z, scratchR.w]);
    for (const name of skeletonNames) {
      if (name === skeletonRoot.name) continue;
      const o = objByName(name);
      const row = boneQuats.get(name) ?? [];
      row.push([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
      boneQuats.set(name, row);
    }
  });

  // Pose summary: hold = mean over the last 5 settling frames; swing max per leg over
  // frames it swung; dip = deepest hip drop below idle across the turn.
  const meanLast5 = (a: number[]): number => {
    const tail = a.slice(-5);
    return tail.reduce((s, v) => s + v, 0) / Math.max(1, tail.length);
  };
  let maxSwingFlex = 0;
  flexL.forEach((v, i) => {
    if (swingSide[i] === "left") maxSwingFlex = Math.max(maxSwingFlex, v);
  });
  flexR.forEach((v, i) => {
    if (swingSide[i] === "right") maxSwingFlex = Math.max(maxSwingFlex, v);
  });
  const backBowFrames = bowMin.filter((v) => v < -0.005).length;
  const poseMetrics = {
    idleHipYM: idleHipY,
    holdKneeFlexDeg: { left: meanLast5(flexL), right: meanLast5(flexR) },
    holdHipDeltaM: meanLast5(hipY) - idleHipY,
    maxDipM: idleHipY - Math.min(...hipY),
    maxSwingKneeFlexDeg: maxSwingFlex,
    backBowFrames,
    worstBowM: Math.min(...bowMin),
    worstHeelMissM: Math.max(...missWorst),
  };

  // Author the baked action into the shipped doc.
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const anim = doc.createAnimation(BAKED_CLIP);
  const addTrack = (nodeName: string, targetPath: "translation" | "rotation", values: number[][], stride: number): void => {
    const node = source.byName.get(nodeName);
    if (!node) throw new Error(`no GLB node ${nodeName}`);
    const input = doc.createAccessor()
      .setType("SCALAR")
      .setArray(new Float32Array(times))
      .setBuffer(buffer);
    const flat = new Float32Array(values.length * stride);
    values.forEach((row, i) => {
      for (let c = 0; c < stride; c += 1) flat[i * stride + c] = numAt(row, c, "baked");
    });
    const output = doc.createAccessor()
      .setType(stride === 4 ? "VEC4" : "VEC3")
      .setArray(flat)
      .setBuffer(buffer);
    const sampler = doc.createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    const channel = doc.createAnimationChannel()
      .setTargetNode(node)
      .setTargetPath(targetPath);
    channel.setSampler(sampler);
    anim.addChannel(channel);
    anim.addSampler(sampler);
  };
  addTrack(skeletonRoot.name, "translation", rootT, 3);
  addTrack(skeletonRoot.name, "rotation", rootR, 4);
  for (const [name, rows] of boneQuats) addTrack(name, "rotation", rows, 4);

  await mkdir(path.dirname(outGlb), { recursive: true });
  const io = new NodeIO();
  await io.write(outGlb, doc);
  const meta = {
    rig,
    clip: BAKED_CLIP,
    legScale: steppingTurnLegScale(run.restSepXzM),
    restSepXzM: run.restSepXzM,
    frames: times.length,
    durationS: times.length > 0 ? numAt(times, times.length - 1, "times") : 0,
    facingDeg: (targetHeading * 180) / Math.PI,
    settlingFrames: settlingIndices.length,
    planSteps: plan.steps.length,
    planTotalS: plan.totalS,
    poseMetrics,
  };
  await mkdir(path.dirname(outMeta), { recursive: true });
  await writeFile(outMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  process.stdout.write(`baked ${outGlb} (${times.length} frames) + ${outMeta}\n`);
}

const invoked = typeof process.argv[1] === "string" && process.argv[1].endsWith("bake-stepping-turn.ts");
if (invoked) await main();
