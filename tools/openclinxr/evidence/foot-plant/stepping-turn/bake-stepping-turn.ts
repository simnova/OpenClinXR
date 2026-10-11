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
  heelTargetForToeTarget,
  solveSteppingLegCcd,
} from "../../../../../packages/openclinxr/xr-humanoid-animation/src/stepping-turn-leg-ik-mod.js";
import {
  planSteppingTurn,
  steppingTurnAt,
} from "../../../../../packages/openclinxr/xr-humanoid-animation/src/stepping-turn-plan-mod.js";
import { worldXyz } from "../../../../../packages/openclinxr/xr-humanoid-animation/src/stance-lock-ik.js";
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

const PHYSICIAN_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
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
  const outGlb = flagValue("--out", ".openclinxr/evidence/stepping-turn/stepping-turn-bake.glb");
  const outMeta = flagValue("--meta", ".openclinxr/evidence/stepping-turn/bake-meta.json");

  // Authoritative production run: slot path + yaw + tracks.
  const decoded = await decodeArrivalTurnRig(PHYSICIAN_GLB);
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
  const plan = planSteppingTurn({
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
    stanceBaselineY: Math.min(entryL.position.y, entryR.position.y),
  });

  // Mirror: idle body, assay scale. Legs are CCD-posed per frame below.
  const { doc, source } = await readMirrorSource(PHYSICIAN_GLB, IDLE_CLIP);
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
  settlingIndices.forEach((frameIndex, k) => {
    const frame = run.frames[frameIndex];
    if (!frame) throw new Error(`no frame ${frameIndex}`);
    const slotXz = slotXzByFrame.get(frameIndex);
    if (!slotXz) throw new Error(`no slot path at ${frameIndex}`);
    const targets = steppingTurnAt(plan, k * DT);
    slot.rotation.y = frame.headingRadians;
    slot.position.set(slotXz.x, assaySlotY, slotXz.z);
    slot.updateMatrixWorld(true);
    for (const side of ["left", "right"] as const) {
      const chain = findSteppingLegChain(slot, side);
      if (chain === null) throw new Error(`no mirror chain for ${side}`);
      const toeTarget = side === targets.stanceFoot ? targets.stanceToe : targets.swingToe;
      solveSteppingLegCcd({ chain, heelTargetWorld: heelTargetForToeTarget({ chain, toeTargetWorld: toeTarget }) });
    }
    slot.updateMatrixWorld(true);
    // Root motion = authoritative slot composed over the root bind.
    yawQ.setFromAxisAngle(yAxis, frame.headingRadians);
    slotM.compose(
      new Vector3(slotXz.x, assaySlotY, slotXz.z),
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
    void worldXyz;
  });

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
    clip: BAKED_CLIP,
    frames: times.length,
    durationS: times.length > 0 ? numAt(times, times.length - 1, "times") : 0,
    facingDeg: (targetHeading * 180) / Math.PI,
    settlingFrames: settlingIndices.length,
    planSteps: plan.steps.length,
    planTotalS: plan.totalS,
  };
  await mkdir(path.dirname(outMeta), { recursive: true });
  await writeFile(outMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  process.stdout.write(`baked ${outGlb} (${times.length} frames) + ${outMeta}\n`);
}

const invoked = typeof process.argv[1] === "string" && process.argv[1].endsWith("bake-stepping-turn.ts");
if (invoked) await main();
