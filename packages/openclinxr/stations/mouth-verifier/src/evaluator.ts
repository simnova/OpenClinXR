/**
 * Headless mouth-geometry evaluator for the parent humanoid (MADR 0061 verifier).
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
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/package-actor-turn";
import { Matrix4, Vector3 } from "three";
import {
  frontShellIndices,
  frontShellMeanGap,
  LOWER_LIP_MIN_VERTS,
  lowerLipInnerRim,
  lowerLipLandmark,
} from "./lip-shell.js";
import { headFocusCamera, loadHeadlessScene } from "./headless-scene.js";
import { boneMatrices, morphedPositions, round6, skinPositions, worldSlice } from "./scene-math.js";
import type { EvaluatorTrack } from "./track.js";
import {
  centroidPacked,
  countPenetratingVerts,
  meanRimGapMm,
  upperDisplacementMm,
} from "@openclinxr/station-mouth-objective";
import type {
  CueTrackCue,
  EvaluateParams,
  EvaluatorOutput,
  EvaluatorSummary,
  FrameRecord,
} from "./verifier-types.js";

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
  dyBiasPx: number;
  dyDetrendedMedianPx: number;
  dyDetrendedMaxPx: number;
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
    scene.body.targetDeltas[aaIndex] ?? new Float32Array(scene.body.base.length),
    scene.body.joints,
    scene.body.weights,
    scene.body.jointNodes,
  );
  if (lipLandmark.length < LOWER_LIP_MIN_VERTS) {
    throw new Error(`lower-lip landmark has ${lipLandmark.length} verts, need ${LOWER_LIP_MIN_VERTS}`);
  }
  if (scene.body.normals.length !== scene.body.base.length) {
    throw new Error("body mesh has no NORMAL accessor for the inner-rim rule");
  }
  // Inner rim: landmark verts whose bind normals face the front shell.
  const innerRim = lowerLipInnerRim(
    scene.body.base,
    scene.body.normals,
    scene.body.targetDeltas[aaIndex] ?? new Float32Array(scene.body.base.length),
    scene.body.joints,
    scene.body.weights,
    scene.body.jointNodes,
    scene.teeth.base,
  );
  if (innerRim.length === 0) throw new Error("inner rim is empty: facing rule matched no landmark vertex");

  const runtime = createActorAudioRuntime({
    developmentFixture: true,
    fixtureSearch: "?openclinxrSpeakFixture=1",
  });
  const slot: {
    root: typeof scene.root;
    activeSpeech?: { text: string; phonemeSequence: string[]; startedAtMs: number; durationMs: number } | undefined;
    mediaPositionSeconds?: (() => number | null) | undefined;
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
  const teethCentroidYs: number[] = [];
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
    const rimHead = headInverse(bodyWorld, innerRim);
    const teethCentroid = centroidPacked(teethHead);
    const lipCentroid = centroidPacked(lipHead);
    teethCentroidYs.push(teethCentroid[1]);
    // Rim gap: mean head-local 3D distance from each lower-shell vertex to
    // its nearest inner-rim vertex. Rim-only reference: no tongue or throat.
    const rimGapMm = meanRimGapMm(teethHead, rimHead);
    // Forward gap reuses the factory surface metric the teeth were solved
    // against (frontShellMeanGap): mean lower-shell distance to the nearest
    // body vertex, signed by whether the lip sits in front (+Z).
    const surfaceGap = frontShellMeanGap(teethWorld, teethShells.lower, bodyWorld);
    const forwardGapMm = (surfaceGap.dirM[2] > 0 ? 1 : -1) * surfaceGap.meanM * 1000;
    const penetrating = countPenetratingVerts(teethHead, lipHead);
    const upperCentroid = centroidPacked(headInverse(teethWorld, teethShells.upper));
    const upperDisplacement = upperDisplacementMm(upperCentroid, restUpperCentroid);

    // Ground-truth projection: the capture pale-pixel centroid aggregates
    // the visible crowns, so the evaluator projects the full front shell
    // (upper + lower). The lower shell alone sits half a strip-height low.
    const shellAll = [...teethShells.upper, ...teethShells.lower];
    const lowerWorld = centroidPacked(worldSlice(teethWorld, shellAll));
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
      upperTeethDisplacementHeadLocalMm: round6(upperDisplacement),
      projCxCropPx: round6(projCx),
      projCyCropPx: round6(projCy),
      projDxCropPx: projDx === null ? null : round6(projDx),
      projDyCropPx: projDy === null ? null : round6(projDy),
      rimGapHeadLocalMm: round6(rimGapMm),
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
  const dySigned = records
    .map((record) => record.projDyCropPx)
    .filter((value): value is number => value !== null);
  const dyAbs = dySigned.map(Math.abs);
  const dyBiasPx = medianOf([...dySigned].sort((a, b) => a - b));
  const dyDetrended = dySigned.map((value) => Math.abs(value - dyBiasPx)).sort((a, b) => a - b);
  const dyDetrendedMedianPx = medianOf(dyDetrended);
  const dyDetrendedMaxPx = dyDetrended.length === 0 ? NaN : Math.max(...dyDetrended);
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
  const rimGaps = records.map((record) => record.rimGapHeadLocalMm);
  const rimMean = rimGaps.reduce((sum, value) => sum + value, 0) / rimGaps.length;
  const rimNowGaps = records
    .filter((record) => record.timeS >= nowFirst.startS && record.timeS < nowSecond.endS)
    .map((record) => record.rimGapHeadLocalMm);
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
    groundTruthDyBiasCropPx: round6(dyBiasPx),
    groundTruthDyDetrendedMedianCropPx: round6(dyDetrendedMedianPx),
    groundTruthDyDetrendedMaxCropPx: round6(dyDetrendedMaxPx),
    groundTruthDxMedianCropPx: round6(dxMedianPx),
    groundTruthDxMaxCropPx: round6(dxMaxPx),
    groundTruthCxKnownLimitation:
      "cx is recorded, not gated: the capture pale-pixel centroid swings +-8px in cx on a " +
      "geometrically x-static arch as lip opening changes which crowns are visible and lit. " +
      "cy tracks jaw-driven geometry to ~1px and carries the gate.",
    groundTruthFrames: dyAbs.length,
    rimGapHeadLocalMinMm: round6(Math.min(...rimGaps)),
    rimGapHeadLocalMaxMm: round6(Math.max(...rimGaps)),
    rimGapHeadLocalMeanMm: round6(rimMean),
    rimGapNowMinMm: round6(rimNowGaps.length === 0 ? NaN : Math.min(...rimNowGaps)),
    rimVertCount: innerRim.length,
    lowerTeethTravelHeadLocalMm: round6(
      (Math.max(...teethCentroidYs) - Math.min(...teethCentroidYs)) * 1000,
    ),
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
  return { output, dyMedianPx, dyMaxPx, dyBiasPx, dyDetrendedMedianPx, dyDetrendedMaxPx, dxMedianPx, dxMaxPx };
}
