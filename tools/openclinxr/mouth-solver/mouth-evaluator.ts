/**
 * Headless mouth-geometry evaluator for the parent humanoid (MADR 0060 evaluator half).
 *
 * Drives the committed GLB through the runtime's own prepared-audio playback
 * (createActorAudioRuntime + diagnostics.installRuntime/start/sync, the same
 * calls mouth-dynamics-capture.ts makes in the browser) with a fixed 30 fps
 * clock, then measures lower-teeth vs lower-lip geometry per frame. The spring
 * integrators and the viseme mapping are never reimplemented: weights and jaw
 * rotation are whatever the runtime writes into the scene.
 *
 * Imports cross only public package entries (@openclinxr/xr-dialogue ".",
 * "./actor-audio-runtime", @openclinxr/xr-scene ".") plus the exported
 * landmark/shell definitions from the teeth-coupling tool (tools-to-tools).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
import { Matrix4, Vector3 } from "three";
import {
  frontShellIndices,
  frontShellMeanGap,
  LOWER_LIP_MIN_VERTS,
  lowerLipLandmark,
} from "../asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.js";
import { type HeadlessMesh, headFocusCamera, loadHeadlessScene } from "./headless-scene.js";
import type {
  CueTrackCue,
  EvaluateParams,
  EvaluatorOutput,
  EvaluatorSummary,
  FrameRecord,
  ToothSample,
} from "./solver-types.js";

/** Capture crop (mouth-dynamics-capture.ts:118) inside the 1280x960 frame. */
const FULL_W = 1280;
const FULL_H = 960;
const CROP_X = 500;
const _CROP_W = 240;
const CROP_H = 180;
const CROP_Y_FROM_BOTTOM = FULL_H - 710;
/** Crop top row in full-frame top-origin pixels: 960 - (250 + 180) = 530. */
const CROP_TOP = FULL_H - (CROP_Y_FROM_BOTTOM + CROP_H);

/** Last-vowel-cue membership: OVR vowel set (viseme-jaw-dynamics.ts VOWELS). */
const VOWEL_VISEMES = new Set(["aa", "e", "i", "o", "u"]);

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Standard linear-blend skinning over bone matrices (three.js SkinnedMesh math on CPU). */
function skinPositions(
  mesh: HeadlessMesh,
  morphed: Float32Array,
  skinMatrices: ArrayLike<number>,
): Float32Array {
  const count = morphed.length / 3;
  const out = new Float32Array(morphed.length);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = morphed[vertex * 3] ?? 0;
    const y = morphed[vertex * 3 + 1] ?? 0;
    const z = morphed[vertex * 3 + 2] ?? 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = mesh.weights[vertex * 4 + slot] ?? 0;
      if (weight === 0) continue;
      matrix.fromArray(skinMatrices, (mesh.joints[vertex * 4 + slot] ?? 0) * 16);
      point.set(x, y, z).applyMatrix4(matrix);
      ox += weight * point.x;
      oy += weight * point.y;
      oz += weight * point.z;
    }
    out[vertex * 3] = ox;
    out[vertex * 3 + 1] = oy;
    out[vertex * 3 + 2] = oz;
  }
  return out;
}

function morphedPositions(mesh: HeadlessMesh, influences: ArrayLike<number>): Float32Array {
  const out = new Float32Array(mesh.base);
  for (let target = 0; target < mesh.targetDeltas.length; target += 1) {
    const weight = influences[target] ?? 0;
    if (weight === 0) continue;
    const delta = mesh.targetDeltas[target];
    if (!delta) continue;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + weight * (delta[i] ?? 0);
  }
  return out;
}

function boneMatrices(mesh: HeadlessMesh): Float32Array {
  mesh.skeleton.update();
  const matrices = mesh.skeleton.boneMatrices;
  if (!matrices) throw new Error("skeleton has no bone matrices");
  return matrices.slice();
}

/** Mean of packed xyz triples. */
function centroidPacked(packed: Float32Array): [number, number, number] {
  const count = packed.length / 3 || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < packed.length; i += 3) {
    x += packed[i] ?? 0;
    y += packed[i + 1] ?? 0;
    z += packed[i + 2] ?? 0;
  }
  return [x / count, y / count, z / count];
}

export type EvaluatorTrack = {
  line: string;
  frameRate: number;
  frameCount: number;
  canonicalTrack: CueTrackCue[];
  toothSamples: ToothSample[];
};

export function readEvaluatorTrack(trackPath: string): EvaluatorTrack {
  const raw = JSON.parse(readFileSync(trackPath, "utf8")) as {
    line?: unknown;
    frameRate?: unknown;
    frameCount?: unknown;
    canonicalTrack?: unknown;
    toothSamples?: unknown;
  };
  if (typeof raw.line !== "string" || !Array.isArray(raw.canonicalTrack) || !Array.isArray(raw.toothSamples)) {
    throw new Error(`track file missing line/canonicalTrack/toothSamples: ${trackPath}`);
  }
  if (raw.frameRate !== 30) throw new Error(`evaluator runs at a fixed 30 fps clock, track says ${String(raw.frameRate)}`);
  if (typeof raw.frameCount !== "number") throw new Error(`track file missing frameCount: ${trackPath}`);
  return {
    line: raw.line,
    frameRate: raw.frameRate,
    frameCount: raw.frameCount,
    canonicalTrack: raw.canonicalTrack as CueTrackCue[],
    toothSamples: raw.toothSamples as ToothSample[],
  };
}

/** Trailing "now" word of the line: the last two vowel cues. */
function lastTwoVowelCues(track: CueTrackCue[]): [CueTrackCue, CueTrackCue] {
  const vowels = track.filter((cue) => VOWEL_VISEMES.has(cue.viseme.toLowerCase()));
  const second = vowels[vowels.length - 1];
  const first = vowels[vowels.length - 2];
  if (!first || !second) throw new Error("track has fewer than two vowel cues");
  return [first, second];
}

/**
 * Drive the loaded scene through the runtime's prepared-audio path and measure
 * per-frame teeth/lip geometry. Returns per-frame records with the ground-truth
 * pixel comparison for frames whose capture sample has n >= 20.
 */
export async function evaluate(
  glbPath: string,
  track: EvaluatorTrack,
  params: EvaluateParams = {},
): Promise<{
  output: EvaluatorOutput;
  dyMedianPx: number;
  dyMaxPx: number;
  dxMedianPx: number;
  dxMaxPx: number;
}> {
  const wallStart = Date.now();
  const scene = await loadHeadlessScene(glbPath);
  const focus = headFocusCamera(scene);
  const camera = focus.camera;
  if (params.cameraPitchPerturbDegrees) {
    const target = new Vector3();
    camera.getWorldDirection(target).add(camera.position);
    const offset = camera.position.clone().sub(target);
    const radians = (params.cameraPitchPerturbDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    camera.position.set(
      camera.position.x,
      target.y + offset.y * cos - offset.z * sin,
      target.z + offset.y * sin + offset.z * cos,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }
  // Legacy framing looks at the head-box centre raised 5% of its height
  // (camera-fit-to-bounds.ts:110); record the same target the camera uses.
  const boxTarget: [number, number, number] = [
    (focus.headBoxMin[0] + focus.headBoxMax[0]) / 2,
    (focus.headBoxMin[1] + focus.headBoxMax[1]) / 2 +
      (focus.headBoxMax[1] - focus.headBoxMin[1]) * 0.05,
    (focus.headBoxMin[2] + focus.headBoxMax[2]) / 2,
  ];

  const teethShells = frontShellIndices(scene.teeth.base);
  if (teethShells.upper.length === 0 || teethShells.lower.length === 0) throw new Error("front shell is empty");
  const aaIndex = scene.body.targetNames.indexOf("viseme_aa");
  if (aaIndex < 0) throw new Error("body has no viseme_aa target");
  // Fixed landmark set from the canonical open shape so per-frame lip
  // positions stay comparable (lowerLipLandmark definition is imported).
  const lipLandmark = lowerLipLandmark(
    scene.body.base,
    scene.body.targetDeltas[aaIndex] ?? new Float32Array(scene.body.base.length),
    scene.body.joints,
    scene.body.weights,
    scene.body.jointNodes,
  );
  if (lipLandmark.length < LOWER_LIP_MIN_VERTS) {
    throw new Error(`lower-lip landmark has ${lipLandmark.length} verts, need ${LOWER_LIP_MIN_VERTS}`);
  }

  const runtime = createActorAudioRuntime({
    developmentFixture: true,
    fixtureSearch: "?openclinxrSpeakFixture=1",
  });
  const slot: {
    root: typeof scene.root;
    activeSpeech?: { text: string; phonemeSequence: string[]; startedAtMs: number; durationMs: number };
    mediaPositionSeconds?: () => number | null;
  } = { root: scene.root, activeSpeech: undefined };
  const fakeContext = {
    currentTime: 0,
    state: "running",
    sampleRate: 22050,
    createBufferSource() {
      return {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        start() {},
        stop() {},
        disconnect() {},
        onended: null,
      };
    },
  };
  const lastCue = track.canonicalTrack[track.canonicalTrack.length - 1];
  if (!lastCue) throw new Error("track has no cues");
  const durationS = lastCue.endS;
  const decodedSampleCount = Math.ceil(durationS * 22050);
  // Buffer body is never read by the headless drive (media position comes
  // from the fake clock); the shape satisfies the prepared-entry type.
  const silentBuffer = {
    duration: durationS,
    sampleRate: 22050,
    length: decodedSampleCount,
    numberOfChannels: 1,
    getChannelData(_channel: number): Float32Array<ArrayBuffer> {
      return new Float32Array(new ArrayBuffer(decodedSampleCount * 4));
    },
    copyFromChannel(_destination: Float32Array, _channelNumber: number, _offset?: number): void {},
    copyToChannel(_source: Float32Array, _channelNumber: number, _offset?: number): void {},
  };
  runtime.diagnostics.installRuntime({
    context: fakeContext,
    destination: {},
    entry: {
      scenarioId: "mouth-solver",
      actorId: "mouth-solver",
      responseText: track.line,
      runnerConversationTurn: 1,
      waveformSha256: "evaluator",
      cueSha256: "evaluator",
      decodedSampleRate: 22050,
      decodedSampleCount,
      buffer: silentBuffer,
      cues: track.canonicalTrack.map((cue) => ({
        phoneme: cue.viseme,
        atSecond: cue.startS,
        durationSeconds: cue.endS - cue.startS,
        intensity: cue.intensity,
      })),
    },
    getSlot() {
      return slot;
    },
    triggerDialogue() {
      slot.activeSpeech = {
        text: track.line,
        phonemeSequence: ["sil"],
        startedAtMs: 0,
        durationMs: durationS * 1000,
      };
    },
  });
  if (!runtime.diagnostics.start({ actorId: "mouth-solver", spokenText: track.line })) {
    throw new Error("prepared-runtime-start-refused");
  }

  const headInverse = (world: Float32Array, indices: readonly number[]): Float32Array => {
    const inverse = new Matrix4().copy(scene.headBone.matrixWorld).invert();
    const point = new Vector3();
    const out = new Float32Array(indices.length * 3);
    indices.forEach((vertex, i) => {
      point.set(world[vertex * 3] ?? 0, world[vertex * 3 + 1] ?? 0, world[vertex * 3 + 2] ?? 0).applyMatrix4(inverse);
      out[i * 3] = point.x;
      out[i * 3 + 1] = point.y;
      out[i * 3 + 2] = point.z;
    });
    return out;
  };

  // Rest upper centroid for the displacement check (drive idle: all weights 0).
  scene.root.updateMatrixWorld(true);
  const restUpperHead = headInverse(
    skinPositions(
      scene.teeth,
      morphedPositions(scene.teeth, scene.teeth.skinned.morphTargetInfluences ?? []),
      boneMatrices(scene.teeth),
    ),
    teethShells.upper,
  );
  const restUpperCentroid = centroidPacked(restUpperHead);

  const [nowFirst, nowSecond] = lastTwoVowelCues(track.canonicalTrack);
  const teethInfluences = (): ArrayLike<number> => {
    const live = scene.teeth.skinned.morphTargetInfluences ?? [];
    if (!params.zeroTeethMorphs) return live;
    return live.map(() => 0);
  };
  const records: FrameRecord[] = [];
  const scratch = new Vector3();
  for (let frame = 0; frame < track.frameCount; frame += 1) {
    const timeS = frame / track.frameRate;
    fakeContext.currentTime = timeS;
    runtime.syncPreparedActorAudio(timeS * 1000);
    const drive = scene.root.userData.openClinXrNamedVisemeDrive as
      | { activeTargetName?: unknown; jawOpenRadians?: unknown; appliedMeshCount?: unknown }
      | undefined;
    if (drive?.appliedMeshCount === 0) {
      throw new Error(`frame ${frame} drove no viseme mesh`);
    }
    scene.root.updateMatrixWorld(true);
    const teethWorld = skinPositions(
      scene.teeth,
      morphedPositions(scene.teeth, teethInfluences()),
      boneMatrices(scene.teeth),
    );
    const bodyWorld = skinPositions(
      scene.body,
      morphedPositions(scene.body, scene.body.skinned.morphTargetInfluences ?? []),
      boneMatrices(scene.body),
    );
    const teethHead = headInverse(teethWorld, teethShells.lower);
    const lipHead = headInverse(bodyWorld, lipLandmark);
    const teethCentroid = centroidPacked(teethHead);
    const lipCentroid = centroidPacked(lipHead);
    // Forward gap reuses the factory surface metric the teeth were solved
    // against (frontShellMeanGap): mean lower-shell distance to the nearest
    // body vertex, signed by whether the lip sits in front (+Z).
    const surfaceGap = frontShellMeanGap(teethWorld, teethShells.lower, bodyWorld);
    const forwardGapMm = (surfaceGap.dirM[2] > 0 ? 1 : -1) * surfaceGap.meanM * 1000;
    let lipMaxZ = -Infinity;
    for (let i = 2; i < lipHead.length; i += 3) lipMaxZ = Math.max(lipMaxZ, lipHead[i] ?? 0);
    let penetrating = 0;
    for (let i = 2; i < teethHead.length; i += 3) {
      if ((teethHead[i] ?? 0) >= lipMaxZ) penetrating += 1;
    }
    const upperCentroid = centroidPacked(headInverse(teethWorld, teethShells.upper));
    const upperDisplacementMm =
      Math.hypot(
        upperCentroid[0] - restUpperCentroid[0],
        upperCentroid[1] - restUpperCentroid[1],
        upperCentroid[2] - restUpperCentroid[2],
      ) * 1000;

    // Ground-truth projection: the capture pale-pixel centroid aggregates
    // the visible crowns, so the evaluator projects the full front shell
    // (upper + lower). The lower shell alone sits half a strip-height low.
    const shellAll = [...teethShells.upper, ...teethShells.lower];
    const lowerWorld = centroidPacked(teethWorldSlice(teethWorld, shellAll));
    scratch.set(lowerWorld[0], lowerWorld[1], lowerWorld[2]).project(camera);
    const projCx = (scratch.x * 0.5 + 0.5) * FULL_W - CROP_X;
    const projCy = (-scratch.y * 0.5 + 0.5) * FULL_H - CROP_TOP;
    const sample = track.toothSamples[frame];
    const compared = sample !== undefined && sample.n >= 20;
    const projDx = compared ? projCx - (sample?.cx ?? 0) : null;
    const projDy = compared ? projCy - (sample?.cy ?? 0) : null;

    records.push({
      frame,
      timeS: round6(timeS),
      viseme: typeof drive?.activeTargetName === "string" ? drive.activeTargetName : null,
      jawOpenRadians: round6(typeof drive?.jawOpenRadians === "number" ? drive.jawOpenRadians : 0),
      forwardGapHeadLocalMm: round6(forwardGapMm),
      verticalGapHeadLocalMm: round6((lipCentroid[1] - teethCentroid[1]) * 1000),
      penetratingVerts: penetrating,
      upperTeethDisplacementHeadLocalMm: round6(upperDisplacementMm),
      projCxCropPx: round6(projCx),
      projCyCropPx: round6(projCy),
      projDxCropPx: projDx === null ? null : round6(projDx),
      projDyCropPx: projDy === null ? null : round6(projDy),
    });
  }

  const gaps = records.map((record) => record.forwardGapHeadLocalMm);
  const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const std = Math.sqrt(gaps.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gaps.length);
  const medianOf = (values: number[]): number =>
    values.length === 0 ? NaN : (values.sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? NaN);
  const dxAbs = records
    .map((record) => record.projDxCropPx)
    .filter((value): value is number => value !== null)
    .map(Math.abs);
  const dyAbs = records
    .map((record) => record.projDyCropPx)
    .filter((value): value is number => value !== null)
    .map(Math.abs);
  const dxMedianPx = medianOf(dxAbs);
  const dxMaxPx = dxAbs.length === 0 ? NaN : Math.max(...dxAbs);
  const dyMedianPx = medianOf(dyAbs);
  const dyMaxPx = dyAbs.length === 0 ? NaN : Math.max(...dyAbs);
  const nowGapSeries = records
    .filter((record) => record.timeS >= nowFirst.startS && record.timeS < nowSecond.endS)
    .map((record) => ({
      frame: record.frame,
      timeS: record.timeS,
      viseme: record.viseme,
      forwardGapHeadLocalMm: record.forwardGapHeadLocalMm,
    }));
  const nowMean =
    nowGapSeries.length === 0
      ? NaN
      : nowGapSeries.reduce((sum, point) => sum + point.forwardGapHeadLocalMm, 0) / nowGapSeries.length;
  const upperByViseme: Record<string, number> = {};
  for (const record of records) {
    const key = record.viseme ?? "none";
    upperByViseme[key] = Math.max(upperByViseme[key] ?? 0, record.upperTeethDisplacementHeadLocalMm);
  }
  const summary: EvaluatorSummary = {
    frames: records.length,
    forwardGapHeadLocalMinMm: round6(Math.min(...gaps)),
    forwardGapHeadLocalMaxMm: round6(Math.max(...gaps)),
    forwardGapHeadLocalMeanMm: round6(mean),
    forwardGapHeadLocalStdMm: round6(std),
    nowVisemes: [nowFirst.viseme, nowSecond.viseme],
    nowFrames: nowGapSeries.map((point) => point.frame),
    nowGapSeries,
    nowForwardGapMeanMm: round6(nowMean),
    penetrationFrames: records.filter((record) => record.penetratingVerts > 0).length,
    groundTruthDyMedianCropPx: round6(dyMedianPx),
    groundTruthDyMaxCropPx: round6(dyMaxPx),
    groundTruthDxMedianCropPx: round6(dxMedianPx),
    groundTruthDxMaxCropPx: round6(dxMaxPx),
    groundTruthCxKnownLimitation:
      "cx is recorded, not gated: the capture pale-pixel centroid swings +-8px in cx on a " +
      "geometrically x-static arch as lip opening changes which crowns are visible and lit. " +
      "cy tracks jaw-driven geometry to ~1px and carries the gate.",
    groundTruthFrames: dyAbs.length,
    upperDisplacementByVisemeMaxHeadLocalMm: Object.fromEntries(
      Object.entries(upperByViseme).map(([key, value]) => [key, round6(value)]),
    ),
    wallClockMs: Date.now() - wallStart,
  };
  const glbBytes = readFileSync(glbPath);
  const output: EvaluatorOutput = {
    schemaVersion: "openclinxr.mouth-solver.evaluator.v2",
    glbPath,
    glbSha256: createHash("sha256").update(glbBytes).digest("hex"),
    trackPath: "",
    frameRate: track.frameRate,
    camera: {
      positionWorldM: [round6(camera.position.x), round6(camera.position.y), round6(camera.position.z)],
      lookAtWorldM: [round6(boxTarget[0]), round6(boxTarget[1]), round6(boxTarget[2])],
      fovDegrees: camera.fov,
      widthPx: FULL_W,
      heightPx: FULL_H,
    },
    records,
    summary,
  };
  return { output, dyMedianPx, dyMaxPx, dxMedianPx, dxMaxPx };
}

function teethWorldSlice(world: Float32Array, indices: readonly number[]): Float32Array {
  const out = new Float32Array(indices.length * 3);
  indices.forEach((vertex, i) => {
    out[i * 3] = world[vertex * 3] ?? 0;
    out[i * 3 + 1] = world[vertex * 3 + 1] ?? 0;
    out[i * 3 + 2] = world[vertex * 3 + 2] ?? 0;
  });
  return out;
}
