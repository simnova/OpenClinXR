/**
 * Brief §7 step 2 acceptance: does an authored plant offset reach the POSED HUMANOID?
 *
 * The brief is explicit about what does not count: "Bundle metadata, a primitive proxy, or a
 * direct preview-only overlay is insufficient." It asks for "the expected support-relative/world
 * delta on the actual loaded humanoid after framing, pose application and subsequent frame
 * updates", with an unauthored control that retains its defaults.
 *
 * Every proof the twelve scene-layout cards landed is below that bar by construction. They assert
 * pure functions, bundle fields and one source-text call site; none of them loads a humanoid. This
 * instrument is the part that was missing, and it is deliberately an INSTRUMENT rather than a
 * contract: it measures and reports, and it is not wired into any gate yet, because a gate over a
 * measurement nobody has read is how a green suite starts meaning nothing.
 *
 * WHAT IT SAMPLES, and why two things rather than one. The actor slot Group is the container; the
 * skinned mesh is the figure a learner sees. The brief names the failure that separates them —
 * "Writing world coordinates into local bases is not a fix" — and a slot that moves while its
 * humanoid child compensates in local space satisfies any slot-only assertion while the figure
 * stays put. Both are recorded per station, so the two can disagree in the artifact rather than
 * silently agreeing in a boolean.
 *
 * TWO SAMPLES, not one. The first is taken once the runtime reports its assets settled; the second
 * after a further frame budget. "Subsequent frame updates" is a requirement because the frame loop
 * writes transforms every frame, so a placement that is correct at settle and gone six frames later
 * has not survived. The drift between the two samples is reported, never averaged away.
 *
 * claimScope: world placement of the loaded, posed, skinned patient for the stations listed below.
 * notEvidenceFor: clinical correctness of any position, Quest performance, motion quality, and any
 * station not enumerated here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page, chromium } from "playwright";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { SKINNED_WORLD_SAMPLING_SOURCE } from "./lib/skinned-world-sampling.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const AUTHORED_OFFSET_EVIDENCE_DIR = ".openclinxr/evidence/authored-offset-on-the-posed-humanoid";
export const AUTHORED_OFFSET_REPORT_NAME = "authored-offset-on-the-posed-humanoid.json";

/**
 * The brief's four required-state outcomes (§ "Complementary research"). `pending` means an
 * identified consumer is still loading; `unknown` means no adequate observation. Neither permits
 * promotion, and an unsupported required state is `unsatisfied` rather than `unknown`.
 */
export type PlacementOutcome = "satisfied" | "unsatisfied" | "pending" | "unknown";

export type Vec3 = { x: number; y: number; z: number };

export type PosedHumanoidSample = {
  /** World position of the OUTER actor slot Group. The container. */
  slotWorld: Vec3 | null;
  /** World centre of the CPU-skinned mesh bounds. The figure. */
  skinnedCentreWorld: Vec3 | null;
  /** Frames the runtime had drawn when this sample was taken. */
  framesObserved: number;
  /** Every skinned mesh found, for the case where the patient is not the only one. */
  skinnedMeshCount: number;
};

export type AuthoredOffsetRow = {
  scenarioId: string;
  patientActorId: string;
  /** From the case, not from the runtime: what the author asked for, or null when unauthored. */
  authoredOffsetMeters: Vec3 | null;
  authoredSupportSurface: string | null;
  postureObserved: string;
  atSettle: PosedHumanoidSample;
  afterFurtherFrames: PosedHumanoidSample;
  /** afterFurtherFrames minus atSettle, on the skinned centre. Non-zero means it did not survive. */
  skinnedDriftMeters: Vec3 | null;
  /** The same station with the authored offset SUPPRESSED. The control half of the pair. */
  suppressedControl: PosedHumanoidSample | null;
  /** authored sample minus suppressed sample, on the skinned centre. This is the measured delta. */
  measuredOffsetDeltaMeters: Vec3 | null;
  outcome: PlacementOutcome;
  /** Why the outcome is what it is, in one sentence, always populated. */
  evidence: string;
};

export type AuthoredOffsetReport = {
  schemaVersion: "openclinxr.authored-offset-on-the-posed-humanoid.v1";
  measuredAt: string;
  claimScope: string;
  notEvidenceFor: readonly string[];
  rows: AuthoredOffsetRow[];
};

const CLAIM_SCOPE =
  "world placement of the loaded, posed, skinned patient after settle and after further frames";

const NOT_EVIDENCE_FOR = [
  "clinical_correctness_of_any_position",
  "quest_readiness",
  "motion_quality",
  "stations_not_enumerated_in_this_report",
] as const;

/** How many further frames must pass between the two samples. */
const FURTHER_FRAME_BUDGET = 30;

/** The patient the CASE declares for this scenario, independent of what the runtime loaded. */
function declaredPatientActorId(scenarioId: string): string {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  const patient = scenario?.actors?.find((actor) => actor.role === "patient");
  return patient?.actorId ?? "";
}

function authoredPlacementFor(scenarioId: string, actorId: string): {
  offset: Vec3 | null;
  supportSurface: string | null;
} {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId);
  const actor = scenario?.actors?.find((candidate) => candidate.actorId === actorId);
  const placement = actor?.placement;
  const raw = placement?.plantOffsetMeters;
  const offset =
    raw && typeof raw.x === "number" && typeof raw.y === "number" && typeof raw.z === "number"
      ? { x: raw.x, y: raw.y, z: raw.z }
      : null;
  return { offset, supportSurface: placement?.supportSurface ?? null };
}

/**
 * Wait until the runtime says its scene assets have stopped arriving.
 *
 * NOT `waitForSceneAssetsSettled` from declared-actors-rendered.ts, which does the same job and
 * cannot run: its callback references `browserPageWindow`, a TYPES-ONLY alias declared in
 * browser-dom.d.ts whose own header says "Runtime behavior is unchanged — types only". Measured
 * 2026-09-09 against a real page: both `const win = browserPageWindow` inside an evaluate string
 * and a typed waitForFunction callback referencing it throw
 * `ReferenceError: browserPageWindow is not defined`. The alias exists to keep tsgo quiet about
 * page globals and silently made the callbacks unrunnable.
 *
 * `globalThis` is used here instead because it resolves in BOTH scopes: it typechecks in node and
 * IS the window object inside the page. A failed asset counts as settled, so a broken load reports
 * rather than hanging.
 */
async function waitForSceneAssetsSettled(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = globalThis as unknown as {
        __openClinXrSceneAssetEvidence?: { pendingCount?: number; assets?: unknown[] };
      };
      const evidence = win.__openClinXrSceneAssetEvidence;
      if (!evidence || !Array.isArray(evidence.assets) || evidence.assets.length === 0) return false;
      return (evidence.pendingCount ?? 0) === 0;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function waitForHumanoidsAndFrames(page: Page, minFrames: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = globalThis as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      if ((win.__openClinXrFrameStats?.framesObserved ?? 0) < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      return skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

/**
 * Read the posed patient off the LIVE scene graph.
 *
 * Identity comes from `userData.openClinXrActorPosture` and the actor-id stamps the runtime
 * already writes, never from object-name guessing: a name-pattern match silently captures the
 * wrong figure the day someone renames a slot, and the whole measurement is about which figure
 * moved.
 */
async function samplePosedPatient(page: Page): Promise<PosedHumanoidSample & { posture: string; actorId: string }> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const frames = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const empty = {
      slotWorld: null, skinnedCentreWorld: null, framesObserved: frames,
      skinnedMeshCount: 0, posture: "unknown", actorId: ""
    };
    if (!scene || typeof scene.traverse !== "function") return empty;

${SKINNED_WORLD_SAMPLING_SOURCE}

    let slot = null;
    let actorId = "";
    let posture = "unknown";
    scene.traverse(function (o) {
      const ud = o.userData || {};
      const role = ud.openClinXrActorSlotKind || ud.openClinXrActorRole || "";
      const id = ud.openClinXrActorId || ud.openClinXrRuntimeActorId || "";
      const isPatientSlot =
        role === "primary_patient"
        || (typeof id === "string" && id.indexOf("patient") === 0);
      if (isPatientSlot && !slot) {
        slot = o;
        actorId = typeof id === "string" ? id : "";
        if (typeof ud.openClinXrActorPosture === "string") posture = ud.openClinXrActorPosture;
      }
      if (slot && posture === "unknown" && typeof ud.openClinXrActorPosture === "string") {
        posture = ud.openClinXrActorPosture;
      }
    });

    let skinnedMeshCount = 0;
    let centre = null;
    if (slot) {
      if (typeof slot.updateMatrixWorld === "function") slot.updateMatrixWorld(true);
      slot.traverse(function (o) {
        if (!o.isSkinnedMesh) return;
        skinnedMeshCount += 1;
        if (centre) return;
        const box = skinnedWorldAabb(o);
        if (!box) return;
        centre = {
          x: (box.min.x + box.max.x) / 2,
          y: (box.min.y + box.max.y) / 2,
          z: (box.min.z + box.max.z) / 2
        };
      });
    }

    const e = slot && slot.matrixWorld && slot.matrixWorld.elements;
    return {
      slotWorld: e ? { x: e[12], y: e[13], z: e[14] } : null,
      skinnedCentreWorld: centre,
      framesObserved: frames,
      skinnedMeshCount: skinnedMeshCount,
      posture: posture,
      actorId: actorId
    };
  })()`);
}

function subtract(a: Vec3 | null, b: Vec3 | null): Vec3 | null {
  if (!a || !b) return null;
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function classify(row: Omit<AuthoredOffsetRow, "outcome" | "evidence">): {
  outcome: PlacementOutcome;
  evidence: string;
} {
  const settled = row.atSettle;
  const later = row.afterFurtherFrames;

  // THE COUNTERWEIGHT, added after the first run reported "satisfied" about the wrong figure.
  // Navigating to the clinic scenario sampled patient_robert_hayes_v1 — the ED patient — because
  // apps/ui-xr/src/main.ts:641 binds createEdChestPainLocalLearnerRuntimeAssetBundle() and only
  // RECORDS a scenario_mismatch rather than materializing the selected case. The lookup for an
  // authored offset then found none (that actor authors none), took the unauthored-control branch,
  // and reported green. A measurement that cannot tell which humanoid it measured is worth less
  // than no measurement, so identity is checked against the CASE before anything else.
  const declared = declaredPatientActorId(row.scenarioId);
  if (declared && row.patientActorId && row.patientActorId !== declared) {
    return {
      outcome: "unsatisfied",
      evidence: `identity mismatch: the case declares ${declared} for ${row.scenarioId} but the runtime staged ${row.patientActorId}; the selected scenario did not reach the loaded cast, so no placement claim about this station is possible`,
    };
  }
  if (declared && !row.patientActorId) {
    return {
      outcome: "unknown",
      evidence: `no patient slot was found in the scene for ${row.scenarioId} (the case declares ${declared}), so no adequate observation was made`,
    };
  }
  if (settled.skinnedMeshCount === 0 || later.skinnedMeshCount === 0) {
    return {
      outcome: "pending",
      evidence: `no skinned mesh under the patient slot at sample time (${settled.skinnedMeshCount} at settle, ${later.skinnedMeshCount} after ${FURTHER_FRAME_BUDGET} further frames); an identified consumer is still loading`,
    };
  }
  if (!settled.skinnedCentreWorld || !later.skinnedCentreWorld) {
    return {
      outcome: "unknown",
      evidence: "a skinned mesh was present but its world bounds could not be computed, so no adequate observation was made",
    };
  }
  const drift = row.skinnedDriftMeters;
  const driftMagnitude = drift ? Math.hypot(drift.x, drift.y, drift.z) : Number.NaN;
  if (row.authoredOffsetMeters === null) {
    return {
      outcome: "satisfied",
      evidence: `unauthored control: patient held at x=${later.skinnedCentreWorld.x.toFixed(4)} z=${later.skinnedCentreWorld.z.toFixed(4)} with ${driftMagnitude.toFixed(4)} m of drift across ${FURTHER_FRAME_BUDGET} further frames; defaults retained because nothing was authored`,
    };
  }
  const delta = row.measuredOffsetDeltaMeters;
  if (!delta) {
    return {
      outcome: "unknown",
      evidence: `authored offset {x:${row.authoredOffsetMeters.x}, z:${row.authoredOffsetMeters.z}} is recorded and the humanoid was sampled at x=${later.skinnedCentreWorld.x.toFixed(4)} z=${later.skinnedCentreWorld.z.toFixed(4)}, but the suppressed control did not sample, so no delta exists and no verdict is possible`,
    };
  }
  // THE VERDICT. Compared on the TANGENT axes only: x and z are what an authored offset moves,
  // and y is refused outright for a supported posture by composeSupportedActorWorldPosition. The
  // tolerance is the measured frame-to-frame drift of the UNAUTHORED control (~0.008 m at its
  // worst across 30 frames), rounded up to 0.02 m — ambient movement of a figure the frame loop
  // rewrites every frame, measured before this comparison existed and independent of it.
  const TOLERANCE_METERS = 0.02;
  const errX = Math.abs(delta.x - row.authoredOffsetMeters.x);
  const errZ = Math.abs(delta.z - row.authoredOffsetMeters.z);
  const shown = `measured delta {x:${delta.x.toFixed(4)}, z:${delta.z.toFixed(4)}} vs authored {x:${row.authoredOffsetMeters.x}, z:${row.authoredOffsetMeters.z}} (err x=${errX.toFixed(4)} z=${errZ.toFixed(4)}, tolerance ${TOLERANCE_METERS})`;
  if (errX <= TOLERANCE_METERS && errZ <= TOLERANCE_METERS) {
    return {
      outcome: "satisfied",
      evidence: `the authored offset reaches the posed skinned humanoid: ${shown}`,
    };
  }
  return {
    outcome: "unsatisfied",
    evidence: `the authored offset does NOT reach the posed skinned humanoid: ${shown}`,
  };
}

export async function measureAuthoredOffsetOnPosedHumanoid(input: {
  scenarioIds: readonly string[];
  patientActorIds: Readonly<Record<string, string>>;
  baseUrl?: string;
}): Promise<AuthoredOffsetReport> {
  let server: PortlessDevServer | undefined;
  const rows: AuthoredOffsetRow[] = [];
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      // Make the TYPES-ONLY alias real inside this page, because the shared helpers this
      // instrument imports (waitForStationShell) reference `browserPageWindow` in their
      // callbacks and throw ReferenceError without it. One line here beats a third inlined
      // copy of a wait; the root-cause fix belongs to the 59 evidence tools that share the
      // alias, not to this file.
      await page.addInitScript(
        "globalThis.browserPageWindow = globalThis; globalThis.browserPageDocument = globalThis.document;",
      );
      for (const scenarioId of input.scenarioIds) {
        process.stdout.write(`authored-offset: goto ${scenarioId}\n`);
        await page.goto(buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE), {
          waitUntil: "load",
          timeout: 180_000,
        });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidsAndFrames(page, 6, 180_000);
        await waitForSceneAssetsSettled(page, 60_000);
        await page.waitForTimeout(900);

        const atSettle = await samplePosedPatient(page);
        await waitForHumanoidsAndFrames(page, atSettle.framesObserved + FURTHER_FRAME_BUDGET, 60_000);
        const afterFurtherFrames = await samplePosedPatient(page);

        const patientActorId =
          afterFurtherFrames.actorId || atSettle.actorId || input.patientActorIds[scenarioId] || "";
        const authored = authoredPlacementFor(scenarioId, patientActorId);

        // THE CONTROL HALF. Same station, same waits, authored offset suppressed. Only when the
        // case authors one: re-navigating a station that authors nothing would sample the same
        // thing twice and produce a zero delta that looks like a measurement.
        let suppressedControl: PosedHumanoidSample | null = null;
        if (authored.offset) {
          const controlUrl = `${buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE)}&openclinxrSuppressAuthoredPlantOffset=1`;
          process.stdout.write(`authored-offset: control ${scenarioId}\n`);
          await page.goto(controlUrl, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 6, 180_000);
          await waitForSceneAssetsSettled(page, 60_000);
          await page.waitForTimeout(900);
          const controlSettle = await samplePosedPatient(page);
          await waitForHumanoidsAndFrames(page, controlSettle.framesObserved + FURTHER_FRAME_BUDGET, 60_000);
          suppressedControl = await samplePosedPatient(page);
        }
        const base: Omit<AuthoredOffsetRow, "outcome" | "evidence"> = {
          scenarioId,
          patientActorId,
          authoredOffsetMeters: authored.offset,
          authoredSupportSurface: authored.supportSurface,
          postureObserved: afterFurtherFrames.posture,
          atSettle,
          afterFurtherFrames,
          skinnedDriftMeters: subtract(
            afterFurtherFrames.skinnedCentreWorld,
            atSettle.skinnedCentreWorld,
          ),
          suppressedControl,
          measuredOffsetDeltaMeters: subtract(
            afterFurtherFrames.skinnedCentreWorld,
            suppressedControl?.skinnedCentreWorld ?? null,
          ),
        };
        rows.push({ ...base, ...classify(base) });
      }
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }

  return {
    schemaVersion: "openclinxr.authored-offset-on-the-posed-humanoid.v1",
    measuredAt: new Date().toISOString(),
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
    rows,
  };
}

export async function writeAuthoredOffsetReport(report: AuthoredOffsetReport): Promise<string> {
  const dir = path.resolve(process.cwd(), AUTHORED_OFFSET_EVIDENCE_DIR);
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, AUTHORED_OFFSET_REPORT_NAME);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

/**
 * The two controls the brief names in step 2: the AUTHORED clinic placement and an UNAUTHORED
 * supine station. Authoring the target supine encounter is the step that follows, once this
 * instrument can tell the two apart.
 */
export const STEP_TWO_CONTROL_SCENARIO_IDS = [
  "clinic_knee_pain_return_to_play_v1",
  "ed_chest_pain_priority_v2",
] as const;

const STEP_TWO_PATIENT_ACTOR_IDS: Record<string, string> = {
  clinic_knee_pain_return_to_play_v1: "patient_jordan_cole_v1",
  ed_chest_pain_priority_v2: "patient_robert_hayes_v1",
};

async function main(): Promise<void> {
  const report = await measureAuthoredOffsetOnPosedHumanoid({
    scenarioIds: STEP_TWO_CONTROL_SCENARIO_IDS,
    patientActorIds: STEP_TWO_PATIENT_ACTOR_IDS,
  });
  const outputPath = await writeAuthoredOffsetReport(report);
  for (const row of report.rows) {
    process.stdout.write(
      `${row.scenarioId}: ${row.outcome} — ${row.patientActorId || "<no patient slot>"} posture=${row.postureObserved}\n  ${row.evidence}\n`,
    );
  }
  process.stdout.write(`authored-offset report: ${outputPath}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("authored-offset-on-the-posed-humanoid.ts")
    || process.argv[1].endsWith("authored-offset-on-the-posed-humanoid.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
