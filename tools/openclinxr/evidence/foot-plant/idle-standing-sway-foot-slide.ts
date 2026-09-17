/**
 * Isolated idle-standing sway foot-slide harness.
 *
 * Per D3 ("use a special harness to test things in an isolated environment... testing in a full
 * room environment gets lots of noise") and D4 ("shrink what is under test to minimum necessary").
 * This drives the REAL `updateGeneratedHumanoidAnimations` (the production frame loop function,
 * unchanged, imported — not reimplemented) against the smallest possible scene: one humanoid group
 * with two toe markers at the shipped physician's own decoded rest-frame offsets (SC-05's
 * `runtime-approach-measurement.ts`: 0.096, 0.016, 0.035 relative to `slot.root`, mirrored for the
 * right foot) and a floor at y = 0. No GLB, no mesh, no skin, no browser, no dev server, no case
 * data, no room — every other actor/room/network dependency `isolated-foot-grounder.ts` still
 * carries is absent here.
 *
 * "A visible floor": since this harness has no renderer, the floor is represented the way the rest
 * of this measurement is — a stated Y = 0 plane, plus an SVG plot (see `writeSvgPlot`) of each toe's
 * XZ path against a drawn floor-plane boundary, which IS a rendered, visible artifact.
 *
 * claimScope: `slot.root` position/rotation composition for a standing, non-speaking actor over a
 * deterministic simulated clock, and the resulting toe world XZ displacement, driven through the
 * real production `updateGeneratedHumanoidAnimations`.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, speaking actors, seated or
 * supine postures, camera-framed screenshots, or any browser-observed capture.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import {
  updateGeneratedHumanoidAnimations,
  type GeneratedHumanoidAnimationSlot,
  type HumanoidAnimationRuntimeContext,
} from "../../../../packages/openclinxr/xr-humanoid-animation/src/index.js";

export const IDLE_SWAY_EVIDENCE_DIR = ".openclinxr/evidence/foot-plant/idle-standing-sway";

// measurement-rubric.ts:65, duplicated across the tools/packages boundary — see that file for the
// derivation (a viewer cannot resolve a displacement below this at ordinary capture framing).
const PERCEPTUAL_FLOOR_METERS = 0.005;

type Vec3 = { x: number; y: number; z: number };

export type IdleSwaySeriesPoint = {
  atMs: number;
  leftToe: Vec3;
  rightToe: Vec3;
  leftDisplacementFromRestMeters: number;
  rightDisplacementFromRestMeters: number;
};

export type IdleSwayReport = {
  schemaVersion: "openclinxr.idle-standing-sway-foot-slide.v1";
  generatedAt: string;
  durationSeconds: number;
  sampleHz: number;
  floorOriginY: 0;
  toeRestOffsetFromRoot: { left: Vec3; right: Vec3 };
  worstSingleFrameStepMeters: number;
  worstDisplacementFromRestMeters: { left: number; right: number };
  perceptualFloorMeters: number;
  satisfiesPerceptualFloor: boolean;
  series: IdleSwaySeriesPoint[];
  claimScope: string;
  notEvidenceFor: string[];
};

function minimalContext(): { ctx: HumanoidAnimationRuntimeContext; slot: GeneratedHumanoidAnimationSlot; toeL: THREE.Object3D; toeR: THREE.Object3D } {
  const ctx = {
    slots: [] as GeneratedHumanoidAnimationSlot[],
    activeVirtualDeviceSpeechByActorId: [],
    runtimeActorRole: () => undefined,
    isPediatricAsthmaRuntimeScenario: () => false,
    runtimePatientActorId: () => "patient-1",
    runtimeFamilyActorId: () => "family-1",
    runtimeClinicalTeamActorId: () => "clinical-1",
    applyIdlePosture: () => {},
    applyRolePosture: () => {},
    seatedClipPerforming: () => false,
    recordActingCueEvidence: () => {},
    scenarioIdForEvidence: () => "generic",
    bundleTurnsForScenario: () => [],
    runtimeTurnForTraceTag: () => undefined,
    liveTurnForCue: () => undefined,
    normalizeLiveEmotion: (emotion: string) => emotion,
    currentSpeechEvidence: () => undefined,
    assetPathForSlot: () => "/isolated-harness.glb",
    isMouthGazePoseReviewCaptureMode: () => false,
    selectedHumanoidSourceComparator: () => "generic",
    writeComparatorEvidenceRecord: () => {},
    shouldUseCleanHumanoidSourceComparatorCapture: () => false,
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    triggerDialogue: () => {},
    schedulePedsPlaybackIfReady: () => {},
    recordBootPhase: () => {},
    animationSlots: () => [],
    pushAnimationSlot: () => {},
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: () => {},
    createEmotionState: () => ({
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetEmotion: "neutral",
      currentEmotion: "neutral",
      transitionStartedAtMs: 0,
    }),
    translationBoneNames: () => [],
    seatedClipPlayable: () => false,
    seatedChairHeight: () => 0.45,
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: { x: 0, y: 0, z: 0 } }),
    findStretcherInScene: () => null,
    stretcherDeckTopWorldY: () => 0.8,
    applyAndPlantSupineDeck: () => {},
    applyPosture: () => {},
  } as unknown as HumanoidAnimationRuntimeContext;

  const root = new THREE.Group();
  root.position.set(0, 0, 0); // baseX = 0: the loader zeroes the humanoid child (generated-loaders.ts:112)
  root.userData.openClinXrActorPosture = "standing";

  // SC-05's decoded rest-frame toe offset relative to slot.root (runtime-approach-measurement.ts),
  // mirrored in X for the right foot.
  const toeL = new THREE.Object3D();
  toeL.name = "toe1-1.L";
  toeL.position.set(0.096, 0.016, 0.035);
  const toeR = new THREE.Object3D();
  toeR.name = "toe1-1.R";
  toeR.position.set(-0.096, 0.016, 0.035);
  root.add(toeL);
  root.add(toeR);
  root.updateMatrixWorld(true);

  const slot: GeneratedHumanoidAnimationSlot = {
    assetId: "isolated-harness",
    actorId: "patient-1",
    root,
    actorSlot: new THREE.Group(),
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    phaseOffsetMs: 0,
    mouthCue: { visible: false, scale: { set: () => {} }, userData: {} } as unknown as THREE.Mesh,
    gazeCue: { visible: false } as unknown as THREE.Line,
    eyeFocusCue: { visible: false } as unknown as THREE.Group,
    expressionCue: { visible: false, scale: { set: () => {} }, position: { set: () => {} } } as unknown as THREE.Group,
    sourceComparatorFreezeEnabled: false,
    responseClips: [],
    emotionExpression: {
      weights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      targetEmotion: "neutral",
      currentEmotion: "neutral",
      transitionStartedAtMs: 0,
      targetWeights: { mouthOpen: 0, browConcern: 0, cheekTension: 0 },
      transitionDurationMs: 0,
    },
  };
  ctx.slots = [slot];
  return { ctx, slot, toeL, toeR };
}

/** Drive the real production frame loop over a deterministic clock and measure toe world XZ. */
export function measureIdleStandingSwayFootSlide(input?: { durationSeconds?: number; sampleHz?: number }): IdleSwayReport {
  const durationSeconds = input?.durationSeconds ?? 40;
  const sampleHz = input?.sampleHz ?? 30;
  const { ctx, slot, toeL, toeR } = minimalContext();
  const camera = { position: { x: 0, y: 1.6, z: 3 } } as unknown as THREE.PerspectiveCamera;

  slot.root.updateMatrixWorld(true);
  const restL = new THREE.Vector3().setFromMatrixPosition(toeL.matrixWorld);
  const restR = new THREE.Vector3().setFromMatrixPosition(toeR.matrixWorld);

  const deltaSeconds = 1 / sampleHz;
  const frameCount = Math.round(durationSeconds * sampleHz);
  const series: IdleSwaySeriesPoint[] = [];
  let worstStep = 0;
  let worstDispL = 0;
  let worstDispR = 0;
  let previousL = restL.clone();
  let previousR = restR.clone();

  for (let frame = 0; frame < frameCount; frame += 1) {
    const nowMs = frame * deltaSeconds * 1000;
    updateGeneratedHumanoidAnimations(ctx, deltaSeconds, nowMs, camera);
    slot.root.updateMatrixWorld(true);
    const worldL = new THREE.Vector3().setFromMatrixPosition(toeL.matrixWorld);
    const worldR = new THREE.Vector3().setFromMatrixPosition(toeR.matrixWorld);
    const step = Math.max(
      Math.hypot(worldL.x - previousL.x, worldL.z - previousL.z),
      Math.hypot(worldR.x - previousR.x, worldR.z - previousR.z),
    );
    if (step > worstStep) worstStep = step;
    const dispL = Math.hypot(worldL.x - restL.x, worldL.z - restL.z);
    const dispR = Math.hypot(worldR.x - restR.x, worldR.z - restR.z);
    if (dispL > worstDispL) worstDispL = dispL;
    if (dispR > worstDispR) worstDispR = dispR;
    if (frame % Math.round(sampleHz) === 0) {
      series.push({
        atMs: nowMs,
        leftToe: { x: worldL.x, y: worldL.y, z: worldL.z },
        rightToe: { x: worldR.x, y: worldR.y, z: worldR.z },
        leftDisplacementFromRestMeters: dispL,
        rightDisplacementFromRestMeters: dispR,
      });
    }
    previousL = worldL;
    previousR = worldR;
  }

  const worstDisplacement = Math.max(worstDispL, worstDispR);
  return {
    schemaVersion: "openclinxr.idle-standing-sway-foot-slide.v1",
    generatedAt: new Date().toISOString(),
    durationSeconds,
    sampleHz,
    floorOriginY: 0,
    toeRestOffsetFromRoot: {
      left: { x: restL.x, y: restL.y, z: restL.z },
      right: { x: restR.x, y: restR.y, z: restR.z },
    },
    worstSingleFrameStepMeters: worstStep,
    worstDisplacementFromRestMeters: { left: worstDispL, right: worstDispR },
    perceptualFloorMeters: PERCEPTUAL_FLOOR_METERS,
    satisfiesPerceptualFloor: worstDisplacement <= PERCEPTUAL_FLOOR_METERS,
    series,
    claimScope:
      "slot.root position/rotation composition for a standing, non-speaking actor over a deterministic simulated clock, driven through the real production updateGeneratedHumanoidAnimations, and the resulting toe world XZ displacement",
    notEvidenceFor: [
      "gait_realism",
      "clinical_plausibility",
      "quest_performance",
      "speaking_actors",
      "seated_or_supine_postures",
      "camera_framed_screenshots",
      "browser_observed_capture",
    ],
  };
}

/** A minimal SVG: the floor plane as a boundary circle at the perceptual floor, and each toe's XZ
 * path relative to its own rest position, in millimetres. This is the "visible floor" this harness
 * has no renderer to draw as a 3D scene. */
export function writeSvgPlot(report: IdleSwayReport): string {
  const scale = 4000; // px per metre-ish for a readable plot at millimetre displacements
  const size = 400;
  const center = size / 2;
  const floorRadiusPx = report.perceptualFloorMeters * scale;
  const toPoints = (side: "left" | "right"): string =>
    report.series
      .map((point) => {
        const rest = side === "left" ? report.toeRestOffsetFromRoot.left : report.toeRestOffsetFromRoot.right;
        const p = side === "left" ? point.leftToe : point.rightToe;
        const x = center + (p.x - rest.x) * scale;
        const y = center + (p.z - rest.z) * scale;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0b0f14"/>
  <circle cx="${center}" cy="${center}" r="${floorRadiusPx.toFixed(2)}" fill="none" stroke="#3a7" stroke-width="1.5" stroke-dasharray="4,3"/>
  <text x="8" y="16" fill="#9fb" font-size="11" font-family="monospace">perceptual floor = ${(report.perceptualFloorMeters * 1000).toFixed(1)} mm radius (dashed)</text>
  <text x="8" y="${size - 10}" fill="#9fb" font-size="11" font-family="monospace">worst displacement L=${(report.worstDisplacementFromRestMeters.left * 1000).toFixed(2)} mm R=${(report.worstDisplacementFromRestMeters.right * 1000).toFixed(2)} mm over ${report.durationSeconds}s</text>
  <circle cx="${center}" cy="${center}" r="2" fill="#fff"/>
  <polyline points="${toPoints("left")}" fill="none" stroke="#f55" stroke-width="1.5"/>
  <polyline points="${toPoints("right")}" fill="none" stroke="#59f" stroke-width="1.5"/>
</svg>
`;
}

async function main(): Promise<void> {
  const report = measureIdleStandingSwayFootSlide();
  await mkdir(IDLE_SWAY_EVIDENCE_DIR, { recursive: true });
  const reportPath = path.join(IDLE_SWAY_EVIDENCE_DIR, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const svgPath = path.join(IDLE_SWAY_EVIDENCE_DIR, "toe-path.svg");
  await writeFile(svgPath, writeSvgPlot(report), "utf8");
  process.stdout.write(`${reportPath}\n${svgPath}\n`);
  process.stdout.write(
    `worst single-frame step: ${report.worstSingleFrameStepMeters.toFixed(6)} m\n`
    + `worst displacement from rest: left ${report.worstDisplacementFromRestMeters.left.toFixed(6)} m, `
    + `right ${report.worstDisplacementFromRestMeters.right.toFixed(6)} m (perceptual floor `
    + `${report.perceptualFloorMeters} m) — ${report.satisfiesPerceptualFloor ? "SATISFIED" : "VIOLATED"}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
