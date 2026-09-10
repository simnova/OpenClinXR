import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { sceneClosureCaseDocument } from "../../../../factory/scene-closure-case-source.js";
import { newEvidencePage } from "../../../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../../../lib/portless-server.js";

/**
 * The normal UI-XR workflow, in a real browser, measured on the frames it actually drew.
 *
 * WHY THIS EXISTS. SC-05's card asks for "normal-workflow browser measurements as well as extended
 * production-boundary tests", and names two things the browser evidence may NOT be: an
 * injected-drive toe-span video, and offline bound-clip percentages. The offline half is delivered
 * by `runtime-approach-measurement.ts`; this is the other one. Every number it reports is read off
 * the running page.
 *
 * WHAT IT DRIVES AND WHAT IT DOES NOT. It launches the shipped dev server, opens the shipped entry
 * with the case's own scenario id, and then does nothing but wait and read. It sets no recorder
 * global — `window.__openClinXrPedsDrive` is never assigned and clause (b) asserts it is absent —
 * writes no transform, calls no executor, marks no readiness and injects no plan. `main.ts` runs its
 * own frame loop, the case-owned producer writes `floor.userData.genDrive`, and the runtime
 * publishes the telemetry this script reads.
 *
 * THE ONE THING IT DOES SUPPLY IS THE TRANSPORT, and that is stated rather than buried. Without an
 * API base URL the entry loads its bundle from
 * `/xr-assets/generated/<scenarioId>/learner-runtime-bundle.v1.json`, and no such file ships for
 * `scene_closure_supine_bedside_v1` — that path is `apps/ui-xr/public/`, outside this card's frozen
 * write roots, and the API route that would serve it is SC-01/SC-01S's and is recorded in `sc-03.md`
 * and `sc-05.md` as unbuilt. So the request is fulfilled from memory with the bundle the SHIPPED
 * producer emits for the persisted case. The bundle is not hand-written and not edited: it is
 * `createEdChestPainLocalLearnerRuntimeAssetBundle` over `sceneClosureCaseDocument()`, byte-for-byte
 * what the static file would contain. Its sha256 is recorded in the inspection so a reader can check
 * that the page consumed what this script produced.
 *
 * claimScope: what one headless chromium drew and what the running runtime reported about it.
 * notEvidenceFor: clinical validity, worn-headset readiness, public deployment, or gait quality.
 */

const SCENARIO_ID = "scene_closure_supine_bedside_v1";
const STATION_ID = "scene_closure_supine_bedside_station_v1";
const ENVIRONMENT_ID = "inpatient_ward_room_v1";
const PHYSICIAN_ACTOR_ID = "senior_resident_ward_v1";
const BUNDLE_ROUTE = `**/xr-assets/generated/${SCENARIO_ID}/learner-runtime-bundle.v1.json`;

/** `acceptance-v2.md`'s engineering limits for the bounded demo, quoted rather than restated. */
const ARRIVAL_ERROR_MAX_METERS = 0.05;
const SETTLED_YAW_ERROR_MAX_DEGREES = 10;
const STOPPED_OBSERVATION_MIN_SECONDS = 2;
/**
 * SC-00's perceptual floor: `MANDATE_VISIBILITY.md` fixes "<3 px on 1920 px frame" at "~3.4 m viewer
 * distance" and `apps/ui-xr/src/main.ts` builds the capture camera as `PerspectiveCamera(52, 1, …)`,
 * so one pixel is 1.727 mm at that distance and three are 5.18 mm, rounded DOWN to 5 mm.
 */
const PERCEPTUAL_FLOOR_METERS = 0.005;
const FOOT_ROLL_ALLOWANCE_PER_WINDOW_METERS = 0.0157;
/** The runtime's own contact band. */
const FOOT_CONTACT_HEIGHT_METERS = 0.06;

type Vector3 = { x: number; y: number; z: number };

type RuntimeSample = {
  atMs: number;
  phase: string;
  locomotion: number;
  slot: { x: number; y: number; z: number; yaw: number };
  leftToe: Vector3 | null;
  rightToe: Vector3 | null;
  stanceFoot: string | null;
};

type RuntimeEvidence = {
  schemaVersion: string;
  driveSource: string | null;
  refusal: string | null;
  phase: string | null;
  physicianActorId: string | null;
  toeBonesResolved: boolean;
  skeletonSampleCount: number;
  samples: RuntimeSample[];
  startWorld: Vector3 | null;
  targetWorld: Vector3 | null;
  targetHeadingRadians: number | null;
  travelHeadingRadians: number | null;
  floorFrameId: string | null;
  floorOriginY: number | null;
  observedObstacleIds: string[];
  geometryRevision: string | null;
  clipStanceAdvanceMetersPerSecond: number | null;
  monitorVisible: boolean | null;
  approachSide: string | null;
  standoffMeters: number | null;
  stoppedSeconds: number;
};

export type FootSlideResult = {
  worstFrameMeters: number;
  totalMeters: number;
  windows: number;
  contactFrames: number;
};

/**
 * Slide of one toe's WORLD track while it is within the contact band of the named floor.
 *
 * Pure, and exported so the verifier suite can exercise it against a track whose answer is known
 * rather than only against whatever a run happened to produce.
 */
export function footSlideOfWorldTrack(
  samples: ReadonlyArray<{ toe: Vector3 | null }>,
  floorOriginY: number,
): FootSlideResult {
  const inContact = samples.map(
    (sample) => sample.toe !== null && sample.toe.y - floorOriginY <= FOOT_CONTACT_HEIGHT_METERS,
  );
  let windows = 0;
  let contactFrames = 0;
  let totalMeters = 0;
  let worstFrameMeters = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (inContact[index] !== true) continue;
    contactFrames += 1;
    if (inContact[index - 1] !== true) {
      windows += 1;
      continue;
    }
    const previous = samples[index - 1]?.toe;
    const current = samples[index]?.toe;
    if (!previous || !current) continue;
    const step = Math.hypot(current.x - previous.x, current.z - previous.z);
    totalMeters += step;
    if (step > worstFrameMeters) worstFrameMeters = step;
  }
  return { worstFrameMeters, totalMeters, windows, contactFrames };
}

/**
 * Slide measured ONLY on frames where this foot is the one carrying the body.
 *
 * A SECOND, NARROWER MEASUREMENT — never a replacement for the frozen one, and reported beside it.
 * SC-00's `foot-slide` treats any toe inside the 0.06 m contact band as planted, which is right for
 * a 24 fps clip whose toe crosses that band in one frame and wrong for the same clip resampled at
 * 60 Hz, where the SWING foot spends about ten frames inside it while deliberately moving forward.
 * The frozen metric still decides the grade; this one says whether the stance foot itself moved.
 */
export function stanceFootSlide(
  samples: ReadonlyArray<{ toe: Vector3 | null; stanceFoot: string | null }>,
  side: "left" | "right",
  floorOriginY: number,
): FootSlideResult {
  const carrying = samples.map(
    (sample) =>
      sample.stanceFoot === side
      && sample.toe !== null
      && sample.toe.y - floorOriginY <= FOOT_CONTACT_HEIGHT_METERS,
  );
  let windows = 0;
  let contactFrames = 0;
  let totalMeters = 0;
  let worstFrameMeters = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (carrying[index] !== true) continue;
    contactFrames += 1;
    if (carrying[index - 1] !== true) {
      windows += 1;
      continue;
    }
    const previous = samples[index - 1]?.toe;
    const current = samples[index]?.toe;
    if (!previous || !current) continue;
    const step = Math.hypot(current.x - previous.x, current.z - previous.z);
    totalMeters += step;
    if (step > worstFrameMeters) worstFrameMeters = step;
  }
  return { worstFrameMeters, totalMeters, windows, contactFrames };
}

/** Shortest absolute yaw difference in degrees. */
export function yawErrorDegrees(observed: number, intended: number): number {
  const twoPi = Math.PI * 2;
  const delta = Math.abs((((observed - intended + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI);
  return (delta * 180) / Math.PI;
}

export type BrowserApproachGrade = {
  ok: boolean;
  problems: string[];
  measured: {
    driveSource: string | null;
    recorderGlobalPresent: boolean;
    phase: string | null;
    physicianActorId: string | null;
    toeBonesResolved: boolean;
    skeletonSampleCount: number;
    frameCount: number;
    walkFrames: number;
    settleFrames: number;
    stoppedFrames: number;
    arrivalErrorMeters: number | null;
    settledYawErrorDegrees: number | null;
    authoredTargetHeadingRadians: number | null;
    observedFinalYawRadians: number | null;
    stoppedSeconds: number;
    stoppedRootTravelMeters: number | null;
    walkFootSlideLeft: FootSlideResult | null;
    walkFootSlideRight: FootSlideResult | null;
    settleTurnFootSlideLeft: FootSlideResult | null;
    settleTurnFootSlideRight: FootSlideResult | null;
    /** The diagnosis beside the frozen metric: did the CARRYING foot move? */
    stanceOnlySlideLeft: FootSlideResult | null;
    stanceOnlySlideRight: FootSlideResult | null;
    deepestFloorPenetrationMeters: number | null;
    observedObstacleIds: string[];
    monitorVisible: boolean | null;
    clipStanceAdvanceMetersPerSecond: number | null;
    limbTravelMeters: number | null;
  };
};

/**
 * Grade what the browser reported, against the same thresholds the offline half is graded against.
 *
 * Pure, so the verifier suite can hand it a run that must fail. Every refusal below is a shape the
 * card names: absent skeleton samples, a `clipPlayed`-style claim with no measured limb motion, an
 * injected recorder global, and a run that never arrived.
 */
export function gradeBrowserApproach(input: {
  evidence: RuntimeEvidence | null;
  recorderGlobalPresent: boolean;
}): BrowserApproachGrade {
  const problems: string[] = [];
  const evidence = input.evidence;
  const empty: BrowserApproachGrade["measured"] = {
    driveSource: null,
    recorderGlobalPresent: input.recorderGlobalPresent,
    phase: null,
    physicianActorId: null,
    toeBonesResolved: false,
    skeletonSampleCount: 0,
    frameCount: 0,
    walkFrames: 0,
    settleFrames: 0,
    stoppedFrames: 0,
    arrivalErrorMeters: null,
    settledYawErrorDegrees: null,
    authoredTargetHeadingRadians: null,
    observedFinalYawRadians: null,
    stoppedSeconds: 0,
    stoppedRootTravelMeters: null,
    walkFootSlideLeft: null,
    walkFootSlideRight: null,
    settleTurnFootSlideLeft: null,
    settleTurnFootSlideRight: null,
    stanceOnlySlideLeft: null,
    stanceOnlySlideRight: null,
    deepestFloorPenetrationMeters: null,
    observedObstacleIds: [],
    monitorVisible: null,
    clipStanceAdvanceMetersPerSecond: null,
    limbTravelMeters: null,
  };
  if (input.recorderGlobalPresent) {
    problems.push("window.__openClinXrPedsDrive was present; a recorder global cannot drive an acceptance run");
  }
  if (evidence === null) {
    problems.push("the page published no bedside-approach telemetry, so nothing was observed");
    return { ok: false, problems, measured: empty };
  }
  if (evidence.driveSource !== "case_owned_bedside_approach") {
    problems.push(`the drive came from ${String(evidence.driveSource)}, not the case-owned producer`);
  }
  if (evidence.physicianActorId !== PHYSICIAN_ACTOR_ID) {
    problems.push(`the approaching actor is ${String(evidence.physicianActorId)}, not ${PHYSICIAN_ACTOR_ID}`);
  }
  if (!evidence.toeBonesResolved) {
    problems.push("the loaded rig carried no named toe bones, so no stance foot was observed");
  }
  if (evidence.skeletonSampleCount < 3) {
    problems.push(
      `only ${evidence.skeletonSampleCount} frames carried skeleton samples; zero or absent samples are the `
      + "measurement observing nothing, not a pass",
    );
  }
  const samples = evidence.samples;
  const floorOriginY = evidence.floorOriginY ?? 0;
  const walk = samples.filter((sample) => sample.phase === "walking");
  const settle = samples.filter((sample) => sample.phase === "settling");
  const stopped = samples.filter((sample) => sample.phase === "arrived");
  if (walk.length === 0) problems.push("no frame was observed walking");
  if (stopped.length === 0) problems.push("no frame was observed stopped");
  const last = samples[samples.length - 1];
  const target = evidence.targetWorld;
  const arrivalErrorMeters =
    last === undefined || target === null
      ? null
      : Math.hypot(last.slot.x - target.x, last.slot.z - target.z);
  if (arrivalErrorMeters === null) problems.push("no final pose or target was published, so arrival is unmeasured");
  else if (arrivalErrorMeters > ARRIVAL_ERROR_MAX_METERS) {
    problems.push(`arrival error ${arrivalErrorMeters.toFixed(5)} m exceeds the ${ARRIVAL_ERROR_MAX_METERS} m cap`);
  }
  const settledYaw =
    last === undefined || evidence.targetHeadingRadians === null
      ? null
      : yawErrorDegrees(last.slot.yaw, evidence.targetHeadingRadians);
  if (settledYaw === null) problems.push("no settled heading was published");
  else if (settledYaw > SETTLED_YAW_ERROR_MAX_DEGREES) {
    problems.push(`settled heading error ${settledYaw.toFixed(3)} deg exceeds the ${SETTLED_YAW_ERROR_MAX_DEGREES} deg cap`);
  }
  if (evidence.stoppedSeconds < STOPPED_OBSERVATION_MIN_SECONDS) {
    problems.push(
      `the stopped observation ran ${evidence.stoppedSeconds.toFixed(2)} s, under the `
      + `${STOPPED_OBSERVATION_MIN_SECONDS} s minimum`,
    );
  }
  let stoppedRootTravelMeters: number | null = null;
  if (stopped.length > 1) {
    stoppedRootTravelMeters = 0;
    for (let index = 1; index < stopped.length; index += 1) {
      const a = stopped[index - 1];
      const b = stopped[index];
      if (a === undefined || b === undefined) continue;
      stoppedRootTravelMeters += Math.hypot(b.slot.x - a.slot.x, b.slot.z - a.slot.z);
    }
    if (stoppedRootTravelMeters > PERCEPTUAL_FLOOR_METERS) {
      problems.push(
        `the root travelled ${stoppedRootTravelMeters.toFixed(5)} m during the stopped observation, over `
        + `${PERCEPTUAL_FLOOR_METERS} m`,
      );
    }
  }
  const walkLeft = footSlideOfWorldTrack(walk.map((sample) => ({ toe: sample.leftToe })), floorOriginY);
  const walkRight = footSlideOfWorldTrack(walk.map((sample) => ({ toe: sample.rightToe })), floorOriginY);
  const turnLeft = footSlideOfWorldTrack(settle.map((sample) => ({ toe: sample.leftToe })), floorOriginY);
  const turnRight = footSlideOfWorldTrack(settle.map((sample) => ({ toe: sample.rightToe })), floorOriginY);
  for (const [name, slide] of [["toe1-1.L", walkLeft], ["toe1-1.R", walkRight]] as const) {
    if (slide.contactFrames < 3) {
      problems.push(`${name} was in floor contact for ${slide.contactFrames} walking frames; under three, slide is unmeasurable`);
      continue;
    }
    if (slide.worstFrameMeters > PERCEPTUAL_FLOOR_METERS) {
      problems.push(`${name} worst walking frame ${slide.worstFrameMeters.toFixed(5)} m exceeds ${PERCEPTUAL_FLOOR_METERS} m`);
    }
    if (slide.totalMeters > FOOT_ROLL_ALLOWANCE_PER_WINDOW_METERS * slide.windows) {
      problems.push(
        `${name} total walking slide ${slide.totalMeters.toFixed(5)} m exceeds `
        + `${(FOOT_ROLL_ALLOWANCE_PER_WINDOW_METERS * slide.windows).toFixed(5)} m over ${slide.windows} window(s)`,
      );
    }
  }
  let deepest: number | null = null;
  for (const sample of samples) {
    for (const toe of [sample.leftToe, sample.rightToe]) {
      if (toe === null) continue;
      const depth = floorOriginY - toe.y;
      if (deepest === null || depth > deepest) deepest = depth;
    }
  }
  if (deepest !== null && deepest > PERCEPTUAL_FLOOR_METERS) {
    problems.push(`a foot reached ${deepest.toFixed(5)} m below the floor frame; a submerged foot is not a stance`);
  }
  // A CLIP THAT DECLARED ITSELF PLAYED MUST HAVE MOVED A LIMB. Measured in the actor's own frame,
  // because a body slid across a room with a frozen pose moves every joint in world space and has
  // animated nothing.
  let limbTravelMeters: number | null = null;
  if (walk.length > 1) {
    limbTravelMeters = 0;
    for (let index = 1; index < walk.length; index += 1) {
      const a = walk[index - 1];
      const b = walk[index];
      if (a?.leftToe == null || b?.leftToe == null) continue;
      limbTravelMeters += Math.hypot(
        (b.leftToe.x - b.slot.x) - (a.leftToe.x - a.slot.x),
        b.leftToe.y - a.leftToe.y,
        (b.leftToe.z - b.slot.z) - (a.leftToe.z - a.slot.z),
      );
    }
    if (limbTravelMeters <= PERCEPTUAL_FLOOR_METERS) {
      problems.push(
        `the locomotion clip declared itself played and moved a contact joint ${limbTravelMeters.toFixed(6)} m in the `
        + "actor's own frame; a flag is not motion",
      );
    }
  }
  if (evidence.observedObstacleIds.length === 0) {
    problems.push("the runtime observed no obstacle geometry; an empty list cannot establish a clear route");
  }
  return {
    ok: problems.length === 0,
    problems,
    measured: {
      driveSource: evidence.driveSource,
      recorderGlobalPresent: input.recorderGlobalPresent,
      phase: evidence.phase,
      physicianActorId: evidence.physicianActorId,
      toeBonesResolved: evidence.toeBonesResolved,
      skeletonSampleCount: evidence.skeletonSampleCount,
      frameCount: samples.length,
      walkFrames: walk.length,
      settleFrames: settle.length,
      stoppedFrames: stopped.length,
      arrivalErrorMeters,
      settledYawErrorDegrees: settledYaw,
      authoredTargetHeadingRadians: evidence.targetHeadingRadians,
      observedFinalYawRadians: last?.slot.yaw ?? null,
      stoppedSeconds: evidence.stoppedSeconds,
      stoppedRootTravelMeters,
      walkFootSlideLeft: walkLeft,
      walkFootSlideRight: walkRight,
      settleTurnFootSlideLeft: turnLeft,
      settleTurnFootSlideRight: turnRight,
      stanceOnlySlideLeft: stanceFootSlide(
        walk.map((sample) => ({ toe: sample.leftToe, stanceFoot: sample.stanceFoot })),
        "left",
        floorOriginY,
      ),
      stanceOnlySlideRight: stanceFootSlide(
        walk.map((sample) => ({ toe: sample.rightToe, stanceFoot: sample.stanceFoot })),
        "right",
        floorOriginY,
      ),
      deepestFloorPenetrationMeters: deepest,
      observedObstacleIds: evidence.observedObstacleIds,
      monitorVisible: evidence.monitorVisible,
      clipStanceAdvanceMetersPerSecond: evidence.clipStanceAdvanceMetersPerSecond,
      limbTravelMeters,
    },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

type CliOptions = { outputDir: string; waitMs: number; timeoutMs: number };

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    outputDir: path.join(".openclinxr/evidence/sc-05-bedside-approach"),
    waitMs: 4000,
    timeoutMs: 240_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--output-dir" && next !== undefined) {
      options.outputDir = next;
      index += 1;
    } else if (arg === "--wait-ms" && next !== undefined) {
      options.waitMs = Number(next);
      index += 1;
    } else if (arg === "--timeout-ms" && next !== undefined) {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

export async function captureBedsideApproach(options: CliOptions): Promise<BrowserApproachGrade> {
  await mkdir(options.outputDir, { recursive: true });
  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
    scenarioId: SCENARIO_ID,
    stationId: STATION_ID,
    scenario: sceneClosureCaseDocument() as never,
  });
  const bundleJson = `${JSON.stringify(bundle, null, 2)}\n`;
  const bundleSha256 = await sha256Hex(bundleJson);

  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newEvidencePage(browser, { viewport: { width: 1440, height: 900 } });
    await page.route(BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const url =
      `${server.url}?openclinxrScenarioId=${SCENARIO_ID}`
      + `&stationId=${STATION_ID}`
      + `&openclinxrEnvironmentId=${ENVIRONMENT_ID}`
      + "&openclinxrPortalStart=encounter"
      + "&openclinxrAcceleratedExam=1";
    await page.goto(url, { waitUntil: "networkidle", timeout: options.timeoutMs });

    // WAIT FOR THE RUNTIME TO SAY IT STOPPED, not for a fixed sleep. A capture that screenshots on a
    // timer records whatever phase the page happened to be in and calls it an arrival.
    // A TIMEOUT IS STILL AN OBSERVATION. Letting `waitForFunction` throw would discard everything
    // the page did manage to report, and a capture that says nothing is indistinguishable from a
    // capture that was never run. The wait is recorded and the grade then fails on what it sees.
    let waitTimedOut = false;
    await page.waitForFunction(
      (minSeconds) => {
        const evidence = (globalThis as Record<string, unknown>)["__openClinXrBedsideApproachEvidence"] as
          | { phase?: string; stoppedSeconds?: number }
          | undefined;
        return evidence?.phase === "arrived" && (evidence.stoppedSeconds ?? 0) >= minSeconds;
      },
      STOPPED_OBSERVATION_MIN_SECONDS + 1,
      { timeout: options.timeoutMs },
    ).catch(() => {
      waitTimedOut = true;
    });
    await page.waitForTimeout(options.waitMs);

    const screenshotPath = path.join(options.outputDir, "sc-05-bedside-approach-arrived.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const observed = await page.evaluate(() => {
      const host = globalThis as Record<string, unknown>;
      return {
        evidence: (host["__openClinXrBedsideApproachEvidence"] ?? null) as unknown,
        recorderGlobalPresent: host["__openClinXrPedsDrive"] !== undefined,
        bootPhases: (host["__openClinXrBootEvidence"] ?? null) as unknown,
        bundleSource: (host["__openClinXrRuntimeBundleScenarioMatch"] ?? null) as unknown,
      };
    });
    const grade = gradeBrowserApproach({
      evidence: observed.evidence as RuntimeEvidence | null,
      recorderGlobalPresent: observed.recorderGlobalPresent,
    });
    const inspectionPath = path.join(options.outputDir, "sc-05-bedside-approach-inspection.json");
    await writeFile(
      inspectionPath,
      `${JSON.stringify(
        {
          schemaVersion: "openclinxr.sc-05-ui-xr-bedside-approach-capture.v1",
          generatedAt: new Date().toISOString(),
          claimScope:
            "one headless chromium run of the shipped UI-XR entry on the persisted scene-closure case, "
            + "measured on the frames it drew",
          notEvidenceFor: [
            "clinical_validity",
            "worn_headset_readiness",
            "public_deployment",
            "gait_realism",
            "scoring_validity",
          ],
          url,
          screenshotPath,
          transport: {
            fulfilledRoute: BUNDLE_ROUTE,
            producer: "createEdChestPainLocalLearnerRuntimeAssetBundle over sceneClosureCaseDocument()",
            bundleSha256,
            reason:
              "no static bundle ships for this case and the API route that would serve it is SC-01/SC-01S's "
              + "and is unbuilt; apps/ui-xr/public is outside this card's frozen write roots",
          },
          waitTimedOut,
          pageErrors,
          bootPhases: observed.bootPhases,
          bundleScenarioMatch: observed.bundleSource,
          grade,
          rawEvidence: observed.evidence,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stdout.write(`${inspectionPath}\n`);
    process.stdout.write(`${screenshotPath}\n`);
    for (const problem of grade.problems) process.stdout.write(`  - ${problem}\n`);
    return grade;
  } finally {
    await browser.close();
    await stopPortlessDevServer(server.proc);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void captureBedsideApproach(parseArgs(process.argv.slice(2)))
    .then((grade) => {
      process.exitCode = grade.ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
