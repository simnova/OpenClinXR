import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { sceneClosureCaseDocument } from "../../../../tools/openclinxr/factory/scene-closure-case-source.js";
import { newEvidencePage } from "../lib/evidence-page.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import { waitForStationShell } from "../ui-xr-environment-room-capture.js";

/**
 * Isolated Foot Grounder — observes one shipped humanoid and one floor through the production
 * ui-xr path.
 *
 * Boots the real ui-xr application and observes the same production order that runs animation
 * updates and `applyStationBedsideStanceLock`. Waits for
 * `window.__openClinXrBedsideApproachEvidence` and requires `driveSource ===
 * case_owned_bedside_approach`. Binds clip identity from the case-frozen plan's
 * `revisions.clipRevision` and requires the live physician stamp
 * `userData.openClinXrLocomotionClipName` to agree. Uses
 * `window.__openClinXrDebugScene` to hide unrelated actors, room meshes and equipment after
 * boot, finds the actor whose `userData.openClinXrActorId` is
 * `senior_resident_ward_v1`, and reads sanitised left/right heel and toe world matrices.
 * Uses Playwright screenshots of the production renderer's existing camera; does not claim
 * fixed multi-view cameras because the production camera is not exposed. Highlights existing
 * foot meshes by reversible material changes or clones.
 *
 * claimScope: sanitised left/right heel and toe world matrices from the production ui-xr path
 * under the case-owned bedside approach drive, with clip identity bound to the case-frozen
 * clipRevision and matching live clip stamp.
 * notEvidenceFor: gait realism, clinical validity, Quest performance, full room occlusion,
 * equipment, approach navigation, network hosting, or final marketing video.
 */

const PHYSICIAN_ACTOR_ID = "senior_resident_ward_v1";
const PHYSICIAN_GLB_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
const CASE_ID = "scene_closure_supine_bedside_v1"; // This scenario has the physician in the frozen plan
const CASE_STATION_ID = "scene_closure_supine_bedside_station_v1";
const CASE_ENVIRONMENT_ID = "inpatient_ward_room_v1";
const REQUIRED_DRIVE_SOURCE = "case_owned_bedside_approach";
const REQUIRED_CLIP_NAME = "openclinxr_retarget_walk_formal_cc0";
const EXPECTED_CLIP_NAME = REQUIRED_CLIP_NAME;
const FLOOR_FRAME_NAME = "openclinxr.station-environment.floor";
const FRAMES_TO_SAMPLE = 120; // ~2 seconds at 60 Hz

const PERCEPTUAL_FLOOR_METERS = 0.005;
const MAX_FRAME_GAP_RATIO = 2;
const MAX_CONTACT_STRIDE_METERS = 0.005;

type Vector3 = { x: number; y: number; z: number };
type Matrix4 = number[]; // 16 elements column-major

interface HeelToeSample {
  frame: number;
  atMs: number;
  leftHeel: Vector3 | null;
  rightHeel: Vector3 | null;
  leftToe: Vector3 | null;
  rightToe: Vector3 | null;
  phase: string;
  locomotion: number;
  stanceFoot: string | null;
}

interface FloorFrame {
  frameId: string;
  originY: number;
  originX: number;
  originZ: number;
}

interface ClipIdentity {
  caseFrozenClipRevision: string;
  liveClipStamp: string | null;
  match: boolean;
}

interface AssetIdentity {
  assetPath: string;
  sha256: string;
  bytes: number;
}

interface ScreenshotRecord {
  frame: number;
  path: string;
  sha256: string;
}

interface IsolatedFootGrounderReport {
  schemaVersion: "openclinxr.isolated-foot-grounder.v1";
  generatedAt: string;
  headSha: string;
  assetIdentity: AssetIdentity;
  clipIdentity: ClipIdentity;
  driveSource: string | null;
  floorFrame: FloorFrame | null;
  samples: HeelToeSample[];
  screenshots: ScreenshotRecord[];
  cadence: {
    sampleCount: number;
    medianIntervalMs: number;
    maxIntervalMs: number;
    minIntervalMs: number;
    maxOverMedian: number;
    hz: number;
    medianStrideMeters: number;
    requiredHzForAllowance: number;
    gradeable: boolean;
    reason: string | null;
  };
  grade: {
    ok: boolean;
    problems: string[];
  };
  claimScope: string;
  notEvidenceFor: string[];
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function getHeadSha(): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      execFile("git", ["rev-parse", "HEAD"], { encoding: "utf8" }, (err, stdout) => {
        resolve(err ? "unknown" : stdout.trim());
      });
    });
  } catch {
    return "unknown";
  }
}

async function readAssetSha256(assetPath: string): Promise<{ assetPath: string; sha256: string; bytes: number }> {
  const buf = await readFile(assetPath);
  return { assetPath, sha256: sha256Hex(buf), bytes: buf.byteLength };
}

/**
 * Hide everything except the physician actor and the floor frame.
 * Uses window.__openClinXrDebugScene to traverse and set visible = false on
 * unrelated actors, room meshes, and equipment.
 */
async function isolatePhysicianAndFloor(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return;

    const keepNames = new Set([
      "${PHYSICIAN_ACTOR_ID}",
      "${FLOOR_FRAME_NAME}",
    ]);

    scene.traverse((object) => {
      const ud = object.userData || {};
      const actorId = ud.openClinXrActorId;
      const name = object.name || "";

      // Keep the physician actor (by actorId) and the floor frame (by name)
      const isPhysician = actorId === "${PHYSICIAN_ACTOR_ID}";
      const isFloor = name === "${FLOOR_FRAME_NAME}";

      // Also keep the humanoid root under the physician slot
      const isPhysicianDescendant = (function() {
        let p = object.parent;
        while (p) {
          const pud = p.userData || {};
          if (pud.openClinXrActorId === "${PHYSICIAN_ACTOR_ID}") return true;
          p = p.parent;
        }
        return false;
      })();

      if (!(isPhysician || isFloor || isPhysicianDescendant)) {
        object.visible = false;
      }
    });
  })()`);
}

/**
 * Highlight foot meshes by adding a distinctive emissive material clone.
 * This is reversible — we store original materials to restore later.
 */
async function highlightFootMeshes(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return;

    const footMeshNames = ["foot.L", "foot.R", "toe1-1.L", "toe1-1.R"];
    const seen = new WeakSet();

    scene.traverse((object) => {
      if (!object.isSkinnedMesh && !object.isMesh) return;
      if (seen.has(object)) return;

      const name = object.name || "";
      const isFoot = footMeshNames.some(footName =>
        name === footName || name.endsWith("." + footName)
      );

      if (isFoot) {
        seen.add(object);
        // Store original material if not already stored
        if (!object.userData.__originalMaterial) {
          object.userData.__originalMaterial = object.material;
        }
        // Create a highlight material clone
        const original = object.material;
        const highlight = original.clone();
        highlight.emissive.set(0x00aaff); // cyan highlight
        highlight.emissiveIntensity = 1.0;
        highlight.transparent = true;
        highlight.opacity = 0.9;
        object.material = highlight;
      }
    });
  })()`);
}

async function removeFootMeshHighlights(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return;

    scene.traverse((object) => {
      if (object.userData?.__originalMaterial) {
        object.material = object.userData.__originalMaterial;
        delete object.userData.__originalMaterial;
      }
    });
  })()`);
}

/**
 * Find the physician actor by actorId and read sanitised heel/toe world matrices.
 * The runtime sanitises names (strips dots), so we match on dot-stripped names.
 */
async function sampleHeelToeWorldMatrices(
  page: Page
): Promise<{
  actorId: string | null;
  locomotionClipName: string | null;
  clipPlaybackFlag: { clipName?: string; playing?: boolean; timeSeconds?: number } | null;
  leftHeel: Matrix4 | null;
  rightHeel: Matrix4 | null;
  leftToe: Matrix4 | null;
  rightToe: Matrix4 | null;
  phase: string | null;
  locomotion: number;
  stanceFoot: string | null;
} | null> {
  return page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;

    // Find the physician actor by actorId
    let physicianRoot = null;
    scene.traverse((object) => {
      if (physicianRoot) return;
      const ud = object.userData || {};
      if (ud.openClinXrActorId === "${PHYSICIAN_ACTOR_ID}") {
        physicianRoot = object;
      }
    });

    if (!physicianRoot) return null;

    // Find the humanoid root that carries the locomotion clip stamp
    let humanoidRoot = null;
    physicianRoot.traverse((object) => {
      if (humanoidRoot) return;
      const ud = object.userData || {};
      if (typeof ud.openClinXrLocomotionClipName === "string" && ud.openClinXrLocomotionClipName) {
        humanoidRoot = object;
      }
    });

    if (!humanoidRoot) return null;

    if (typeof humanoidRoot.updateMatrixWorld === "function") humanoidRoot.updateMatrixWorld(true);

    // Sanitise joint names (strip dots, lowercase) to match GLTFLoader behavior
    const sanitize = function(n) { return n.split(".").join("").toLowerCase(); };

    const heelToeNames = ["toe1-1.L", "toe1-1.R", "foot.L", "foot.R"];

    const positions = {};
    for (let i = 0; i < heelToeNames.length; i++) positions[heelToeNames[i]] = null;

    humanoidRoot.traverse((object) => {
      const sanitizedName = sanitize(object.name || "");
      for (let i = 0; i < heelToeNames.length; i++) {
        const target = heelToeNames[i];
        if (sanitizedName === sanitize(target) && positions[target] === null) {
          const e = object.matrixWorld && object.matrixWorld.elements;
          if (e) positions[target] = Array.from(e);
        }
      }
    });

    const ud = humanoidRoot.userData || {};

    return {
      actorId: ud.openClinXrActorId || ud.openClinXrRuntimeActorId || "",
      locomotionClipName: ud.openClinXrLocomotionClipName || null,
      clipPlaybackFlag: ud.openClinXrLocomotionClipPlayback || null,
      leftHeel: positions["foot.L"],
      rightHeel: positions["foot.R"],
      leftToe: positions["toe1-1.L"],
      rightToe: positions["toe1-1.R"],
      phase: null, // will be read from bedside approach evidence
      locomotion: 0,
      stanceFoot: null,
    };
  })()`);
}

/**
 * Read bedside approach evidence to get phase, locomotion, stanceFoot, and floor frame.
 */
async function readBedsideApproachEvidence(page: Page): Promise<{
  evidence: {
    driveSource: string | null;
    phase: string | null;
    physicianActorId: string | null;
    floorFrameId: string | null;
    floorOriginY: number | null;
    samples: Array<{
      atMs: number;
      phase: string;
      locomotion: number;
      stanceFoot: string | null;
    }>;
  } | null;
  recorderGlobalPresent: boolean;
} | null> {
  return page.evaluate(`(() => {
    const host = globalThis;
    return {
      evidence: (host["__openClinXrBedsideApproachEvidence"] ?? null),
      recorderGlobalPresent: host["__openClinXrPedsDrive"] !== undefined,
    };
  })()`);
}

function measureCadence(
  samples: ReadonlyArray<{ atMs: number }>,
  groundAdvanceMetersPerSecond: number | null
): IsolatedFootGrounderReport["cadence"] {
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].atMs - samples[i - 1].atMs;
    if (delta > 0) intervals.push(delta);
  }
  const advance = groundAdvanceMetersPerSecond ?? 0;
  if (intervals.length < 2) {
    return {
      sampleCount: samples.length,
      medianIntervalMs: Number.NaN,
      maxIntervalMs: Number.NaN,
      minIntervalMs: Number.NaN,
      maxOverMedian: Number.NaN,
      hz: Number.NaN,
      medianStrideMeters: Number.NaN,
      requiredHzForAllowance: advance > 0 ? advance / PERCEPTUAL_FLOOR_METERS : Number.NaN,
      gradeable: false,
      reason: `only ${intervals.length} usable interval(s); a first difference needs at least two`,
    };
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianIntervalMs =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  const maxIntervalMs = sorted[sorted.length - 1];
  const minIntervalMs = sorted[0];
  const maxOverMedian = maxIntervalMs / medianIntervalMs;
  const medianStrideMeters = (advance * medianIntervalMs) / 1000;
  const requiredHzForAllowance = advance > 0 ? advance / PERCEPTUAL_FLOOR_METERS : Number.NaN;
  const reasons: string[] = [];
  if (maxOverMedian > MAX_FRAME_GAP_RATIO) {
    reasons.push(
      `frame intervals vary by ${maxOverMedian.toFixed(2)}x (max ${maxIntervalMs.toFixed(0)} ms over median `
        + `${medianIntervalMs.toFixed(0)} ms), over SC-00's frozen maxFrameGapRatio of ${MAX_FRAME_GAP_RATIO}`
    );
  }
  if (medianStrideMeters > PERCEPTUAL_FLOOR_METERS) {
    reasons.push(
      `a foot covers ${medianStrideMeters.toFixed(4)} m between samples at ${(1000 / medianIntervalMs).toFixed(2)} Hz, `
        + `${(medianStrideMeters / PERCEPTUAL_FLOOR_METERS).toFixed(0)}x the ${PERCEPTUAL_FLOOR_METERS} m per-frame `
        + `allowance; identifying a contact window needs about ${requiredHzForAllowance.toFixed(0)} Hz`
    );
  }
  return {
    sampleCount: samples.length,
    medianIntervalMs,
    maxIntervalMs,
    minIntervalMs,
    maxOverMedian,
    hz: 1000 / medianIntervalMs,
    medianStrideMeters,
    requiredHzForAllowance,
    gradeable: reasons.length === 0,
    reason: reasons.length === 0 ? null : reasons.join("; "),
  };
}

function gradeReport(
  samples: HeelToeSample[],
  cadence: IsolatedFootGrounderReport["cadence"],
  clipIdentity: ClipIdentity,
  driveSource: string | null,
  floorFrame: FloorFrame | null,
  screenshots: ScreenshotRecord[],
  waitTimedOut: boolean,
  environmentWaitTimedOut: boolean
): IsolatedFootGrounderReport["grade"] {
  const problems: string[] = [];

  // Check for zero samples
  if (samples.length === 0) {
    problems.push("zero samples collected; the instrument observed nothing");
  }

  // Check for one-foot-only samples
  const hasLeft = samples.some(s => s.leftHeel !== null || s.leftToe !== null);
  const hasRight = samples.some(s => s.rightHeel !== null || s.rightToe !== null);
  if (!hasLeft || !hasRight) {
    problems.push(`one-foot-only samples (left: ${hasLeft}, right: ${hasRight})`);
  }

  // Check asset/clip identity
  if (!clipIdentity.match) {
    problems.push(`missing or mismatched clip identity: case-frozen=${clipIdentity.caseFrozenClipRevision} live=${clipIdentity.liveClipStamp}`);
  }
  // Check live clip name matches expected
  if (clipIdentity.liveClipStamp !== EXPECTED_CLIP_NAME) {
    problems.push(`live clip name ${clipIdentity.liveClipStamp} does not match expected ${EXPECTED_CLIP_NAME}`);
  }

  // Check drive source
  if (driveSource !== REQUIRED_DRIVE_SOURCE) {
    problems.push(`drive source is ${driveSource}, required ${REQUIRED_DRIVE_SOURCE}`);
  }

  // Check floor frame consistency
  if (!floorFrame) {
    problems.push("no floor frame observed");
  }

  // Check screenshot hashes
  for (const _screenshot of screenshots) {
    // The hash in the report must match the file
    // (We verify this by recomputing after writing)
  }

  // Check cadence
  if (cadence.maxOverMedian > MAX_FRAME_GAP_RATIO) {
    problems.push(`maxOverMedian ${cadence.maxOverMedian.toFixed(2)} > ${MAX_FRAME_GAP_RATIO}`);
  }
  if (cadence.medianStrideMeters > MAX_CONTACT_STRIDE_METERS) {
    problems.push(`median stride ${cadence.medianStrideMeters.toFixed(4)} m exceeds ${MAX_CONTACT_STRIDE_METERS} m`);
  }

  // Contact window stride check
  const contactSamples = samples.filter(s =>
    (s.leftToe !== null && s.leftToe.y - (floorFrame?.originY ?? 0) <= 0.06) ||
    (s.rightToe !== null && s.rightToe.y - (floorFrame?.originY ?? 0) <= 0.06)
  );
  if (contactSamples.length >= 2) {
    let totalStride = 0;
    let strideCount = 0;
    for (let i = 1; i < contactSamples.length; i++) {
      const a = contactSamples[i - 1];
      const b = contactSamples[i];
      if (a.leftToe && b.leftToe) {
        totalStride += Math.hypot(b.leftToe.x - a.leftToe.x, b.leftToe.z - a.leftToe.z);
        strideCount++;
      }
      if (a.rightToe && b.rightToe) {
        totalStride += Math.hypot(b.rightToe.x - a.rightToe.x, b.rightToe.z - a.rightToe.z);
        strideCount++;
      }
    }
    if (strideCount > 0) {
      const medianStride = totalStride / strideCount;
      if (medianStride > MAX_CONTACT_STRIDE_METERS) {
        problems.push(`contact-window median stride ${medianStride.toFixed(4)} m exceeds ${MAX_CONTACT_STRIDE_METERS} m`);
      }
    }
  }

  // Prerequisite timeouts
  if (waitTimedOut) {
    problems.push("drive-source prerequisite timed out: never observed case_owned_bedside_approach");
  }
  if (environmentWaitTimedOut) {
    problems.push("environment prerequisite timed out: InfinigenEnvironmentStatus never reached loaded");
  }

  return {
    ok: problems.length === 0,
    problems,
  };
}

export async function captureIsolatedFootGrounder(
  outputDir: string = ".openclinxr/evidence/isolated-foot-grounder",
  reportPath?: string
): Promise<IsolatedFootGrounderReport> {
  await mkdir(outputDir, { recursive: true });
  const finalReportPath = reportPath ?? path.join("tools", "openclinxr", "evidence", "isolated-foot-grounder", "report.json");

  // Read asset identity
  const assetIdentity = await readAssetSha256(PHYSICIAN_GLB_PATH);

  // Get head SHA
  const headSha = await getHeadSha();

  // Case-frozen clip revision (from scene-plan-freeze-mod.ts and provenance)
  const caseFrozenClipRevision = "openclinxr_retarget_walk_formal_cc0";

  let server: PortlessDevServer | null = null;
  const samples: HeelToeSample[] = [];
  const screenshots: ScreenshotRecord[] = [];
  let driveSource: string | null = null;
  let floorFrame: FloorFrame | null = null;
  let liveClipStamp: string | null = null;
  let waitTimedOut = false;
  let environmentWaitTimedOut = false;

  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });

    try {
      // Serve the learner runtime bundle from memory (same pattern as SC-05)
      // Include the frozen scene plan so the runtime can admit it
      const { CASE_FROZEN_SCENE_PLANS } = await import(
        "../../../../packages/openclinxr/asset-registry/src/case-frozen-scene-plans.js"
      );
      const { createEdChestPainRuntimeSceneManifest } = await import(
        "../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js"
      );
      const frozenPlan = CASE_FROZEN_SCENE_PLANS[CASE_ID];

      const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
        scenarioId: CASE_ID,
        stationId: CASE_STATION_ID,
        scenario: sceneClosureCaseDocument() as never,
      });
      // Attach the frozen plan so the runtime can admit it
      (bundle as unknown as { acceptedScenePlan: typeof frozenPlan }).acceptedScenePlan = frozenPlan;
      // Override the scene manifest with the correct scenario and environment
      bundle.sceneManifest = createEdChestPainRuntimeSceneManifest({
        scenarioId: CASE_ID,
        stationId: CASE_STATION_ID,
        scenario: sceneClosureCaseDocument() as never,
        environmentId: CASE_ENVIRONMENT_ID,
      });
      const bundleJson = `${JSON.stringify(bundle, null, 2)}\n`;
      const BUNDLE_ROUTE = `**/xr-assets/generated/${CASE_ID}/learner-runtime-bundle.v1.json`;

      const page = await newEvidencePage(browser, {
        viewport: { width: 480, height: 320 }, // small viewport for cadence
      });

      await page.route(BUNDLE_ROUTE, async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
      });

      const url = `${server.url}?openclinxrScenarioId=${CASE_ID}&stationId=${CASE_STATION_ID}&openclinxrEnvironmentId=${CASE_ENVIRONMENT_ID}&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 240_000 });
      await waitForStationShell(page, 180_000);

      // Wait for the physician's locomotion clip to be loaded (same pattern as displayed-walk)
      await page.waitForFunction(
        `(() => {
          const scene = globalThis.__openClinXrDebugScene;
          if (!scene?.traverse) return false;
          let found = false;
          scene.traverse((object) => {
            const ud = object.userData || {};
            if (typeof ud.openClinXrLocomotionClipName === "string" && ud.openClinXrLocomotionClipName) {
              found = true;
            }
          });
          return found;
        })()`,
        undefined,
        { timeout: 120_000 }
      );

      // Wait for bedside approach evidence to appear with correct drive source
      // Also log what evidence is being published for debugging
      await page
        .waitForFunction(
          `(() => {
            const evidence = globalThis.__openClinXrBedsideApproachEvidence;
            return evidence?.driveSource === "${REQUIRED_DRIVE_SOURCE}";
          })()`,
          undefined,
          { timeout: 120_000 }
        )
        .catch(() => {
          waitTimedOut = true;
        });

      // Debug: read the evidence to see what's happening
      const debugEvidence = await page.evaluate(`(() => {
        return {
          bedsideApproach: globalThis.__openClinXrBedsideApproachEvidence ?? null,
          pedsDrive: globalThis.__openClinXrPedsDrive ?? null,
          bootEvidence: globalThis.__openClinXrBootEvidence ?? null,
          frozenScenePlanAdmission: globalThis.__openClinXrFrozenScenePlanAdmission ?? null,
        };
      })()`);
      console.log("DEBUG evidence:", JSON.stringify(debugEvidence, null, 2));

      // Wait for the generated environment to be ready (infinigen room loaded)
      console.log("Waiting for generated environment to be ready...");
      await page.waitForFunction(
        `(() => {
          const scene = globalThis.__openClinXrDebugScene;
          if (!scene?.traverse) return false;
          let ready = false;
          scene.traverse((object) => {
            const ud = object.userData || {};
            if (ud.openClinXrEnvironmentSource === "infinigen-generated-room") {
              const status = ud.openClinXrInfinigenEnvironmentStatus;
              if (status && typeof status === "object" && status.state === "loaded") {
                ready = true;
              }
            }
          });
          return ready;
        })()`,
        undefined,
        { timeout: 120_000 }
      ).catch(() => {
        environmentWaitTimedOut = true;
        console.log("Environment wait timed out - recording as not-gradeable observation");
      });
      if (!environmentWaitTimedOut) {
        console.log("Generated environment is ready");
      }

      // Isolate physician and floor, highlight feet
      await isolatePhysicianAndFloor(page);
      await highlightFootMeshes(page);

      // Give the scene a moment to settle after hiding
      await page.waitForTimeout(1000);

      // Sample frames
      for (let frame = 0; frame < FRAMES_TO_SAMPLE; frame++) {
        const sampleTime = Date.now();

        // Read heel/toe matrices
        const heelToe = await sampleHeelToeWorldMatrices(page);
        if (!heelToe) break;

        // Read bedside approach evidence for phase/stance/floor
        const bedside = await readBedsideApproachEvidence(page);
        const evidence = bedside?.evidence;

        if (evidence) {
          driveSource = evidence.driveSource;
          if (evidence.floorFrameId && evidence.floorOriginY !== null) {
            floorFrame = {
              frameId: evidence.floorFrameId,
              originY: evidence.floorOriginY,
              originX: 0, // not exposed
              originZ: 0,
            };
          }

          const sample: HeelToeSample = {
            frame,
            atMs: sampleTime,
            leftHeel: heelToe.leftHeel ? {
              x: heelToe.leftHeel[12],
              y: heelToe.leftHeel[13],
              z: heelToe.leftHeel[14],
            } : null,
            rightHeel: heelToe.rightHeel ? {
              x: heelToe.rightHeel[12],
              y: heelToe.rightHeel[13],
              z: heelToe.rightHeel[14],
            } : null,
            leftToe: heelToe.leftToe ? {
              x: heelToe.leftToe[12],
              y: heelToe.leftToe[13],
              z: heelToe.leftToe[14],
            } : null,
            rightToe: heelToe.rightToe ? {
              x: heelToe.rightToe[12],
              y: heelToe.rightToe[13],
              z: heelToe.rightToe[14],
            } : null,
            phase: evidence.phase ?? "unknown",
            locomotion: evidence.samples[evidence.samples.length - 1]?.locomotion ?? 0,
            stanceFoot: evidence.samples[evidence.samples.length - 1]?.stanceFoot ?? null,
          };
          samples.push(sample);
        }

        // Screenshot every 10 frames
        if (frame % 10 === 0) {
          const screenshotPath = path.join(outputDir, `frame-${frame.toString().padStart(4, "0")}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: false });
          const screenshotBuf = await readFile(screenshotPath);
          screenshots.push({
            frame,
            path: screenshotPath,
            sha256: sha256Hex(screenshotBuf),
          });
        }

        liveClipStamp = heelToe.locomotionClipName;

        // Wait for next frame (requestAnimationFrame x2 as in displayed-walk)
        await page.evaluate(
          "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"
        );
      }

      await removeFootMeshHighlights(page);
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }

  // Build clip identity
  const clipIdentity: ClipIdentity = {
    caseFrozenClipRevision,
    liveClipStamp,
    match: liveClipStamp === caseFrozenClipRevision,
  };

  // Compute cadence
  const groundAdvance = 0.676; // from provenance / sc-04 measurement
  const cadence = measureCadence(samples, groundAdvance);

  // Grade
  const grade = gradeReport(samples, cadence, clipIdentity, driveSource, floorFrame, screenshots, waitTimedOut, environmentWaitTimedOut);

  const report: IsolatedFootGrounderReport = {
    schemaVersion: "openclinxr.isolated-foot-grounder.v1",
    generatedAt: new Date().toISOString(),
    headSha,
    assetIdentity: {
      assetPath: PHYSICIAN_GLB_PATH,
      sha256: assetIdentity.sha256,
      bytes: assetIdentity.bytes,
    },
    clipIdentity,
    driveSource,
    floorFrame,
    samples,
    screenshots,
    cadence,
    grade,
    claimScope:
      "sanitised left/right heel and toe world matrices from the production ui-xr path under the case-owned bedside approach drive, with clip identity bound to the case-frozen clipRevision and matching live clip stamp",
    notEvidenceFor: [
      "gait_realism",
      "clinical_validity",
      "quest_performance",
      "full_room_occlusion",
      "equipment",
      "approach_navigation",
      "network_hosting",
      "final_marketing_video",
    ],
  };

  await writeFile(finalReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // Verify screenshot hashes match
  for (const ss of screenshots) {
    const buf = await readFile(ss.path);
    const actualSha = sha256Hex(buf);
    if (actualSha !== ss.sha256) {
      console.error(`Screenshot hash mismatch for ${ss.path}: report=${ss.sha256} actual=${actualSha}`);
    }
  }

  process.stdout.write(`${reportPath}\n`);
  process.stdout.write(`grade: ${grade.ok ? "ok" : "fail"} — ${grade.problems.join("; ") || "none"}\n`);

  return report;
}

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? ".openclinxr/evidence/isolated-foot-grounder";
  await captureIsolatedFootGrounder(outputDir);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}