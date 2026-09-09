/**
 * Brief §7 step 5: "Capture actual displayed motion, not merely successful loading or a
 * `clipPlayed` flag. Independently sample the final posed skeleton and skinned mesh across time."
 *
 * Every foot-plant number landed so far was measured off the ASSET — the BVH, then the bound GLB,
 * then the grafted GLB. None of them says the runtime displays anything. This one boots the app,
 * finds the actor that carries a locomotion clip, and samples the posed skeleton and the
 * CPU-skinned mesh frame by frame while the locomotion drive is on and again while it is off.
 *
 * IT REFUSES A FLAG. `openClinXrLocomotionClipPlayback.playing` is read and REPORTED, but the
 * outcome is decided by measured joint displacement: a runtime that set the flag and animated
 * nothing is `unsatisfied`, which is the failure the brief names by name.
 *
 * THE CONTROL IS THE SAME STATION WITH THE DRIVE OFF. Without it, a figure that jitters for any
 * other reason — breathing, sway, the idle clip — would read as a walk. Breathing moves the root a
 * couple of centimetres, so the treatment has to beat the control by a wide margin rather than beat
 * zero.
 *
 * claimScope: world displacement of named leg joints and of the skinned mesh on the loaded actor
 * that carries a locomotion clip, under the runtime's own locomotion drive.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, or any other actor.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page, chromium } from "playwright";
import { SKINNED_WORLD_SAMPLING_SOURCE } from "../lib/skinned-world-sampling.js";
import { newEvidencePage } from "../lib/evidence-page.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "../ui-xr-environment-room-capture.js";

/** Tracked, because a report under .openclinxr/ has no land path and this one is the deliverable. */
export const DISPLAYED_WALK_REPORT_PATH =
  "docs/openclinxr/evidence/displayed-walk-on-the-loaded-physician.json";

/** The brief's four required-state outcomes. Only `satisfied` permits promotion. */
export type DisplayedWalkOutcome = "satisfied" | "unsatisfied" | "pending" | "unknown";

type Vec3 = { x: number; y: number; z: number };

export type JointTrack = {
  joint: string;
  samples: Array<{ frame: number; position: Vec3 }>;
  /** Sum of frame-to-frame world displacement, in metres. */
  pathLengthMeters: number;
  /** Largest distance between any two samples. Distinguishes a stride from a tremor. */
  spanMeters: number;
};

export type DisplayedWalkPass = {
  locomotionDrive: number;
  actorId: string;
  locomotionClipName: string | null;
  clipPlaybackFlag: { clipName?: string; playing?: boolean; timeSeconds?: number } | null;
  ownedBoneChains: string[];
  joints: JointTrack[];
  /** CPU-skinned mesh bounds centre per frame — the figure a learner sees, not a bone. */
  skinnedCentre: JointTrack;
  framesSampled: number;
};

export type StagedActor = { actorId: string; locomotionClipName: string | null; playback: string | null };

export type DisplayedWalkReport = {
  schemaVersion: "openclinxr.displayed-walk-on-the-loaded-physician.v1";
  measuredAt: string;
  scenarioId: string;
  driven: DisplayedWalkPass | null;
  control: DisplayedWalkPass | null;
  /** Every actor the runtime staged, so a refusal names what WAS there. */
  stagedActors: StagedActor[];
  outcome: DisplayedWalkOutcome;
  evidence: string;
  claimScope: string;
  notEvidenceFor: readonly string[];
};

/**
 * The scenario whose cast fills the additional_cast slot with a PHYSICIAN.
 *
 * Measured across the bank: `ward_delirium_med_rec_v1` is the only one that does
 * (`senior_resident_ward_v1`, `/generated-humanoids/mpfb-clinical-physician-adult.glb`, the actor
 * the walk clip was grafted into). `ed_chest_pain_priority_v2` casts patient, nurse and spouse and
 * no physician at all, which is why running this against the ED station reports `unknown` rather
 * than substituting another clinical actor — the outcome brief §7 step 3 asks to be reported.
 */
const SCENARIO_ID = process.env["OPENCLINXR_DISPLAYED_WALK_SCENARIO"] ?? "ward_delirium_med_rec_v1";
/**
 * Joint names as the GLB declares them.
 *
 * THE RUNTIME SPELLS THEM DIFFERENTLY. Measured 2026-09-09 on the loaded physician: three's
 * GLTFLoader sanitises `.` out of node names, so the GLB's `toe1-1.L` is `toe1-1L` in the scene.
 * A sampler matching the asset spelling finds nothing and reports a figure with no legs, which is
 * what the first run of this instrument did. Matching is on the dot-stripped name.
 */
const SAMPLED_JOINTS = ["toe1-1.L", "toe1-1.R", "foot.L", "foot.R", "lowerleg01.L", "upperleg01.L"] as const;
const FRAMES_PER_PASS = 60;

const CLAIM_SCOPE =
  "world displacement of named leg joints and of the skinned mesh on the loaded actor carrying a locomotion clip";
const NOT_EVIDENCE_FOR = [
  "gait_realism",
  "clinical_plausibility",
  "quest_readiness",
  "actors_without_a_locomotion_clip",
] as const;

function pathLength(samples: ReadonlyArray<{ position: Vec3 }>): number {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!.position;
    const b = samples[i]!.position;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

function span(samples: ReadonlyArray<{ position: Vec3 }>): number {
  let worst = 0;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const a = samples[i]!.position;
      const b = samples[j]!.position;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Set the runtime's own locomotion drive. Nothing else in the page is touched. */
/**
 * Wait until some staged actor carries a locomotion clip.
 *
 * Resolves quietly on timeout: an absent actor is a legitimate outcome the classifier reports as
 * `unknown` with the staged cast named, and throwing here would turn that into a crash.
 */
async function waitForLocomotionActor(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const scene = (globalThis as unknown as { __openClinXrDebugScene?: { traverse?: (cb: (o: { userData?: Record<string, unknown> }) => void) => void } }).__openClinXrDebugScene;
        if (!scene?.traverse) return false;
        let found = false;
        scene.traverse((object) => {
          if (typeof object.userData?.["openClinXrLocomotionClipName"] === "string") found = true;
        });
        return found;
      },
      undefined,
      { timeout: timeoutMs },
    );
  } catch {
    // Fall through: the classifier reports `unknown` and names what WAS staged.
  }
}

async function listStagedActors(page: Page): Promise<StagedActor[]> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return [];
    const rows = [];
    scene.traverse(function (o) {
      const ud = o.userData || {};
      if (!ud.openClinXrActorId) return;
      rows.push({
        actorId: ud.openClinXrActorId,
        locomotionClipName: ud.openClinXrLocomotionClipName === undefined ? null : ud.openClinXrLocomotionClipName,
        playback: ud.openClinXrAnimationPlayback || null
      });
    });
    return rows;
  })()`);
}

async function setLocomotionDrive(page: Page, locomotion: number): Promise<void> {
  await page.evaluate(`(() => { window.__openClinXrPedsDrive = { locomotion: ${locomotion} }; })()`);
}

/**
 * Sample one frame: the world position of each named joint under the actor that carries a
 * locomotion clip, plus the CPU-skinned mesh centre.
 *
 * IDENTITY IS DATA-DRIVEN. The actor is found by `userData.openClinXrLocomotionClipName`, the stamp
 * the loader writes for exactly this reason — not by a name pattern, which captures the wrong figure
 * the day a slot is renamed.
 */
async function sampleFrame(page: Page, joints: readonly string[]): Promise<{
  actorId: string;
  locomotionClipName: string | null;
  clipPlaybackFlag: DisplayedWalkPass["clipPlaybackFlag"];
  ownedBoneChains: string[];
  positions: Record<string, Vec3 | null>;
  skinnedCentre: Vec3 | null;
} | null> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;

${SKINNED_WORLD_SAMPLING_SOURCE}

    let humanoid = null;
    scene.traverse(function (o) {
      if (humanoid) return;
      const ud = o.userData || {};
      if (typeof ud.openClinXrLocomotionClipName === "string" && ud.openClinXrLocomotionClipName) humanoid = o;
    });
    if (!humanoid) return null;
    if (typeof humanoid.updateMatrixWorld === "function") humanoid.updateMatrixWorld(true);

    const wanted = ${JSON.stringify(joints)};
    const positions = {};
    const byKey = {};
    const key = function (name) { return String(name || "").split(".").join("").toLowerCase(); };
    for (var i = 0; i < wanted.length; i += 1) { positions[wanted[i]] = null; byKey[key(wanted[i])] = wanted[i]; }
    humanoid.traverse(function (o) {
      const declared = byKey[key(o.name)];
      if (declared && positions[declared] === null) {
        const e = o.matrixWorld && o.matrixWorld.elements;
        if (e) positions[declared] = { x: e[12], y: e[13], z: e[14] };
      }
    });

    let centre = null;
    humanoid.traverse(function (o) {
      if (centre || !o.isSkinnedMesh) return;
      const box = skinnedWorldAabb(o);
      if (!box) return;
      centre = {
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2
      };
    });

    const ud = humanoid.userData || {};
    return {
      actorId: ud.openClinXrActorId || ud.openClinXrRuntimeActorId || "",
      locomotionClipName: ud.openClinXrLocomotionClipName || null,
      clipPlaybackFlag: ud.openClinXrLocomotionClipPlayback || null,
      ownedBoneChains: ud.openClinXrOwnedBoneChains || [],
      positions: positions,
      skinnedCentre: centre
    };
  })()`);
}

async function runPass(page: Page, locomotion: number): Promise<DisplayedWalkPass | null> {
  await setLocomotionDrive(page, locomotion);
  const perJoint = new Map<string, Array<{ frame: number; position: Vec3 }>>();
  const centreSamples: Array<{ frame: number; position: Vec3 }> = [];
  let last: Awaited<ReturnType<typeof sampleFrame>> = null;
  for (let frame = 0; frame < FRAMES_PER_PASS; frame += 1) {
    const sample = await sampleFrame(page, SAMPLED_JOINTS);
    if (!sample) return null;
    last = sample;
    for (const joint of SAMPLED_JOINTS) {
      const position = sample.positions[joint];
      if (!position) continue;
      if (!perJoint.has(joint)) perJoint.set(joint, []);
      perJoint.get(joint)!.push({ frame, position });
    }
    if (sample.skinnedCentre) centreSamples.push({ frame, position: sample.skinnedCentre });
    // One rendered frame between samples: the loop advances the mixer on rAF, so sampling faster
    // than the page draws would report a still figure however well the clip plays.
    await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  }
  if (!last) return null;
  return {
    locomotionDrive: locomotion,
    actorId: last.actorId,
    locomotionClipName: last.locomotionClipName,
    clipPlaybackFlag: last.clipPlaybackFlag,
    ownedBoneChains: last.ownedBoneChains,
    joints: [...perJoint].map(([joint, samples]) => ({
      joint,
      samples,
      pathLengthMeters: pathLength(samples),
      spanMeters: span(samples),
    })),
    skinnedCentre: {
      joint: "skinned_mesh_centre",
      samples: centreSamples,
      pathLengthMeters: pathLength(centreSamples),
      spanMeters: span(centreSamples),
    },
    framesSampled: FRAMES_PER_PASS,
  };
}

export function classifyDisplayedWalk(input: {
  driven: DisplayedWalkPass | null;
  control: DisplayedWalkPass | null;
  stagedActors?: readonly StagedActor[];
}): { outcome: DisplayedWalkOutcome; evidence: string } {
  const { driven, control } = input;
  if (!driven || !control) {
    const staged = (input.stagedActors ?? []).map((actor) => actor.actorId).filter(Boolean);
    return {
      outcome: "unknown",
      evidence:
        `no staged actor carries a locomotion clip, so no adequate observation was made. Staged: ${staged.length > 0 ? staged.join(", ") : "<none>"}. `
        + "The clip is on mpfb-clinical-physician-adult.glb, which reaches the runtime only through an additional_cast slot filled by an actor with role physician; this scenario's cast has none, which is the outcome brief §7 step 3 asks to be reported rather than worked around by substituting another clinical actor.",
    };
  }
  if (driven.joints.length === 0) {
    return {
      outcome: "pending",
      evidence: `the actor ${driven.actorId || "<unnamed>"} was found but none of its leg joints resolved by name, so the skeleton was not sampled`,
    };
  }
  const drivenToe = driven.joints.find((track) => track.joint === "toe1-1.L");
  const controlToe = control.joints.find((track) => track.joint === "toe1-1.L");
  if (!drivenToe || !controlToe) {
    return { outcome: "unknown", evidence: "the left toe did not resolve in both passes, so the two cannot be compared" };
  }
  // The control moves: breathing and sway are real. The treatment must beat it by a wide margin,
  // not merely beat zero.
  const margin = controlToe.spanMeters * 5;
  if (drivenToe.spanMeters <= margin) {
    return {
      outcome: "unsatisfied",
      evidence: `the driven toe spans ${drivenToe.spanMeters.toFixed(4)} m against a drive-off control of ${controlToe.spanMeters.toFixed(4)} m, inside the 5x margin — the runtime reports playback ${JSON.stringify(driven.clipPlaybackFlag)} while displaying no stride`,
    };
  }
  if (driven.skinnedCentre.samples.length === 0) {
    return {
      outcome: "pending",
      evidence: `the skeleton moved (${drivenToe.spanMeters.toFixed(4)} m at the toe) but no skinned mesh was sampled, so the figure a learner sees was not observed`,
    };
  }
  return {
    outcome: "satisfied",
    evidence: `driven toe spans ${drivenToe.spanMeters.toFixed(4)} m over ${driven.framesSampled} frames against a drive-off control of ${controlToe.spanMeters.toFixed(4)} m; the skinned mesh centre travelled ${driven.skinnedCentre.pathLengthMeters.toFixed(4)} m and the actor claims chains [${driven.ownedBoneChains.join(", ")}]`,
  };
}

export async function measureDisplayedWalk(): Promise<DisplayedWalkReport> {
  let server: PortlessDevServer | null = null;
  let driven: DisplayedWalkPass | null = null;
  let control: DisplayedWalkPass | null = null;
  let stagedActors: StagedActor[] = [];
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    const browser = await chromium.launch();
    try {
      const page = await newEvidencePage(browser);
      await page.goto(buildRoomCaptureUrl(server.url, SCENARIO_ID, ROOM_CAPTURE_MODE), {
        waitUntil: "load",
        timeout: 180_000,
      });
      await waitForStationShell(page, 180_000);
      // The shell resolves before the humanoids finish arriving. Wait for the STAMP rather than a
      // fixed sleep: the first version slept 2 s and reported "no actor carries a clip" on a run
      // where the actor appeared a few seconds later, which is a timing artifact wearing the shape
      // of a finding.
      await waitForLocomotionActor(page, 120_000);
      // Control FIRST, so the drive-off numbers cannot be contaminated by a clip left running.
      stagedActors = await listStagedActors(page);
      control = await runPass(page, 0);
      driven = await runPass(page, 1);
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }

  return {
    schemaVersion: "openclinxr.displayed-walk-on-the-loaded-physician.v1",
    measuredAt: new Date().toISOString(),
    scenarioId: SCENARIO_ID,
    driven,
    control,
    stagedActors,
    ...classifyDisplayedWalk({ driven, control, stagedActors }),
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
  };
}

async function main(): Promise<void> {
  const report = await measureDisplayedWalk();
  const outputPath = path.resolve(process.cwd(), DISPLAYED_WALK_REPORT_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${report.outcome} — ${report.evidence}\n${outputPath}\n`);
}

if (process.argv[1]?.endsWith("displayed-walk-on-the-loaded-physician.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
