/**
 * Repeatable factory step: bind the shipped CC0 walk clip onto every ambulatory MPFB actor.
 *
 * WHY THIS EXISTS, measured 2026-09-25. Only mpfb-clinical-physician-adult.glb carries
 * `openclinxr_retarget_walk_source` (bound 90f179882 by hand: extract-library-clip.ts ->
 * motion_bind_stage.py (Blender, retarget_bvh) -> dropLeadingRestFrame -> graft-bound-clip.ts
 * --publish). Every other shipped MPFB actor has an empty motionClips array (measured via
 * their provenance.json, 2026-09-25) even though several are cast into walking roles (staff
 * approaching a bedside, family walking in, an ambulatory patient). The physician's recipe
 * works unchanged per actor because motion_bind_stage.py retargets onto the ACTOR PASSED IN
 * — the bound rotations already fit that body's own proportions; nothing here grafts the
 * physician's own baked clip onto another rig by bone name, which would keep the physician's
 * adult stride length on a child body.
 *
 * This is that recipe as a list-driven station entry point instead of N hand runs. It does
 * NOT call graft-bound-clip.ts's CLI (main()) for the publish step: that CLI's
 * --foot-plant-report flag defaults to the physician-only
 * docs/openclinxr/evidence/bound-clip-foot-plant.json, and passing that default through for a
 * different actor would copy the PHYSICIAN's measured foot-plant numbers into that actor's own
 * provenance record — a wrong-numbers defect the measure-before-claiming discipline exists to
 * refuse. This script calls the graft functions directly and passes no footPlantReportPath
 * unless one is actually supplied for that actor.
 *
 *   pnpm exec tsx tools/openclinxr/factory/bind-walk-clip-all.ts [--actor <stem>]... [--dry-run]
 *
 * With no --actor flags, binds every stem in WALK_BIND_ACTOR_STEMS that does not already carry
 * openclinxr_retarget_walk_source (idempotent replay — safe to re-run after an unrelated rebake).
 *
 * claimScope: mechanical replay of a proven per-actor bind+graft, list-driven.
 * notEvidenceFor: clinical_gait_realism, visual_walk_quality, quest_readiness, runtime_playback
 * (same scope the graft itself declares — capture and grade separately).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { measureStanceGroundAdvance } from "@openclinxr/xr-humanoid-animation/case-owned-approach-runtime";
// Same package (repo-root package.json, no package.json under either tools/ subtree) as this
// file — not a cross-package reach, so it is outside the shrink-only frozen-boundary freeze that
// governs relative imports INTO packages/*/src (see nothing-reaches-across-a-package-boundary-
// by-path.test.ts). The two imports above are bare package-subpath specifiers for the same
// reason: `@openclinxr/asset-registry/approach-executor` and
// `@openclinxr/xr-humanoid-animation/case-owned-approach-runtime` are published exports, not
// relative src reaches, so the freeze's regex (which only matches `.`-prefixed specifiers) does
// not see them either.
import { boundClipJointTrack } from "../evidence/foot-plant/bound-clip-foot-track.js";
import { dropLeadingRestFrame, graftBoundClip } from "./graft-bound-clip.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const CLIP_NAME = "openclinxr_retarget_walk_source";
const LIBRARY_PATH = path.join(
  process.env.HOME ?? "",
  ".openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb",
);
const LIBRARY_CLIP_NAME = "Walk";
const SOURCE_CLIP_CITATION = "~/.openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb#Walk";
const STAGE_SCRIPT = path.join(
  REPO_ROOT,
  "packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_stage.py",
);
/**
 * Invoked as a CHILD PROCESS (`pnpm exec tsx ... -- --library ... --clip ... --output ...`),
 * never imported by relative path: `nothing-reaches-across-a-package-boundary-by-path.test.ts`
 * freezes the exact set of tools/ -> packages/ relative src imports at its current size (shrink
 * only), and this file lives in tools/ while the extractor lives in packages/factory-stations/src.
 */
const EXTRACT_LIBRARY_CLIP_SCRIPT = path.join(
  REPO_ROOT,
  "packages/openclinxr/factory-stations/src/motion_retarget/extract-library-clip.ts",
);
const TARGET_MAP = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json",
);
const SOURCE_MAP = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mesh2motion-human-66.json",
);
/**
 * MEASURED 2026-09-25, root cause of the nurse/child high-lurch regression. The physician's
 * currently-shipped `openclinxr_retarget_walk_source` was bound with "First person, Z up" (see
 * the "## FIXED (wt/walk-rebind)" note in
 * `tools/openclinxr/evidence/foot-plant/the-walk-clip-faces-the-same-way-it-travels.test.ts`) —
 * NOT "Third person, Z up", which an earlier doc for the RETIRED `walk_formal_cc0` clip named.
 * This file originally copied the stale "Third person, Z up" value. Probed against all 7 newly
 * bound actors with `boundClipJointTrack` + `measureStanceGroundAdvance` (same technique the test
 * above uses on the physician): every one had `advance.forward.z` NEGATIVE while its own rest
 * `toe1-1.L - foot.L` z was POSITIVE — the clip's stance-window travel pointed exactly opposite
 * the way its own feet face at rest. The runtime's `travelYawForClipForward` then had to apply a
 * near-180 degree correction beyond the physician's, so the character walked while pivoting
 * through most of a half-turn instead of walking a bedside approach — that pivot arc is the
 * measured high lurch (nurse 1.521, child 1.425, physician-orientation actors unaffected).
 * `verifyClipTravelHeading` below re-checks this per actor at bind time and REFUSES to publish a
 * mismatch, so a future source-clip change cannot reintroduce this silently.
 */
const SOURCE_ORIENTATION = "First person, Z up";
// Relative, matching the physician's own provenance convention exactly — the licence-lineage
// audit (tools/openclinxr/evidence/licence/selected-scene-asset-lineage.ts) resolves this string
// against its own clearance table and rejects an absolute path as "clip-licence-record-absent"
// even though it names the same file.
const LICENCE_RECORD = "docs/openclinxr/asset-licence-records/row-05-mesh2motion-clip-library-ledger-correction.json";
const LICENCE_STATUS =
  "CC0 1.0 - VERIFIED in LICENSE-CC0.MD of the mesh2motion-app clone, which dedicates all 3d models, blend files, rigs and animations. The CarnegieMellonAnimations subtree of the same clone is EXCLUDED and is not the source of this clip.";

const WORK_DIR = path.join(REPO_ROOT, ".openclinxr/walk-bind");

/**
 * Every MPFB actor this station knows how to bind, with why it should walk (staff/family/
 * ambulatory patient) or an explicit skip reason (not cast, dev fixture, superseded runtime
 * path). mpfb-clinical-physician-adult is intentionally absent — it is the DONE case this
 * recipe was generalised from, and the graft refuses a duplicate clip name if replayed onto it.
 */
export const WALK_BIND_ACTORS: ReadonlyArray<{ stem: string; role: string; reason: string }> = [
  { stem: "mpfb-clinical-nurse-adult", role: "nurse", reason: "staff — walks the bedside approach in ED/OB/peds stations" },
  { stem: "mpfb-family-partner-adult", role: "family", reason: "family/partner — walks in to the ED/OB bedside" },
  { stem: "mpfb-street-adult-male", role: "patient", reason: "ambulatory street-casual patient (telehealth/clinic/urgent-care)" },
  { stem: "mpfb-peds-nurse-kevin", role: "nurse", reason: "peds nurse — walks the bedside approach" },
  { stem: "mpfb-gown-adult-patient", role: "patient", reason: "default gowned adult patient body, reused as ED/inpatient/OB fallback across most stations" },
  { stem: "mpfb-peds-patient-child", role: "patient", reason: "peds patient — brief asks for a walked bedside-approach capture" },
  { stem: "mpfb-ob-patient-aisha", role: "patient", reason: "OB triage patient — presents ambulatory before the exam" },
];

/** Actors intentionally left out, and why — recorded so the next run does not re-litigate it. */
export const WALK_BIND_SKIPPED: ReadonlyArray<{ stem: string; reason: string }> = [
  { stem: "mpfb-clinical-physician-adult", reason: "already bound (90f179882) — the recipe this station generalises" },
  { stem: "mpfb-peds-parent-aisha", reason: "runtime cast path resolves to the SEPARATE candidates/mpfb-peds-parent-aisha.motion-bind.glb (seated clip), not this plain GLB — not the shipped asset" },
  { stem: "mpfb-gown-inspect", reason: "dev/debug fixture, not cast into any scenario" },
  { stem: "mpfb-viseme-inspect", reason: "dev/debug fixture, not cast into any scenario" },
  {
    stem: "Anny-family actors (ed_chest_pain_*, adult_male_street_casual, peds_*)",
    reason:
      "different armature topology (23-bone minimal Anny rig, not the 137-joint MPFB2 default_no_toes rig this stage's --map targets); the Anny rail is also fully retired from casting (#652, ANNY_TO_MPFB_RUNTIME_PATH) so no learner ever loads these bytes — binding them would not reach a runtime consumer",
  },
];

function resolveBlender(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER;
  }
  for (const candidate of ["/opt/homebrew/bin/blender", "/usr/local/bin/blender"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "blender";
}

function runBlender(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(resolveBlender(), args, { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 600_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runNode(tsxArgs: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "tsx", ...tsxArgs], { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function existingClipName(actorGlbPath: string): Promise<string | null> {
  if (!existsSync(actorGlbPath)) return null;
  const io = new NodeIO();
  const doc = await io.read(actorGlbPath);
  return doc.getRoot().listAnimations().some((animation) => animation.getName() === CLIP_NAME) ? CLIP_NAME : null;
}

export type ClipTravelHeadingCheck = {
  ok: boolean;
  restToeAheadOfAnkleZ: number;
  stanceAdvanceForwardZ: number;
  stanceAdvanceMetersPerSecond: number;
  windowFrames: number;
  detail: string;
};

/**
 * Does this clip's own stance-window travel point the same way its own feet face at rest?
 *
 * Same measurement `the-walk-clip-faces-the-same-way-it-travels.test.ts` makes on the physician,
 * generalised to any bound GLB. A mismatch means the retarget produced a clip that locomotes
 * backward relative to its own foot orientation — `travelYawForClipForward` then has to correct
 * for close to a half-turn beyond whatever route heading was intended, and that extra pivot is
 * what shows up downstream as high lurch. `bindWalkClipForActor` refuses to publish a mismatch.
 */
export async function verifyClipTravelHeading(
  glbPath: string,
  clipName: string,
): Promise<ClipTravelHeadingCheck> {
  const [toe, foot] = await Promise.all([
    boundClipJointTrack({ glbPath, clipName, boneName: "toe1-1.L" }),
    boundClipJointTrack({ glbPath, clipName, boneName: "foot.L" }),
  ]);
  const restToe = toe.samples[0];
  const restFoot = foot.samples[0];
  if (!restToe || !restFoot) {
    return {
      ok: false,
      restToeAheadOfAnkleZ: 0,
      stanceAdvanceForwardZ: 0,
      stanceAdvanceMetersPerSecond: 0,
      windowFrames: 0,
      detail: `${clipName} on ${glbPath}: no rest-frame sample for toe1-1.L or foot.L`,
    };
  }
  const restToeAheadOfAnkleZ = restToe.position.z - restFoot.position.z;
  const advance = measureStanceGroundAdvance(toe.samples, {
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    floorOriginY: 0,
  });
  const ok =
    advance.windowFrames > 1
    && advance.metersPerSecond > 0
    && Math.sign(advance.forward.z) === Math.sign(restToeAheadOfAnkleZ);
  return {
    ok,
    restToeAheadOfAnkleZ,
    stanceAdvanceForwardZ: advance.forward.z,
    stanceAdvanceMetersPerSecond: advance.metersPerSecond,
    windowFrames: advance.windowFrames,
    detail: ok
      ? `travel matches rest (restZ=${restToeAheadOfAnkleZ.toFixed(4)}, advanceForwardZ=${advance.forward.z.toFixed(4)})`
      : `travel MISMATCHES rest (restZ=${restToeAheadOfAnkleZ.toFixed(4)}, advanceForwardZ=${advance.forward.z.toFixed(4)}, windowFrames=${advance.windowFrames}, mps=${advance.metersPerSecond.toFixed(3)})`,
  };
}

export type WalkBindResult = {
  stem: string;
  status: "bound" | "already_bound" | "rebound" | "failed";
  detail: string;
  graftedChannels?: number;
  graftedJoints?: number;
  headingCheck?: ClipTravelHeadingCheck;
};

export async function bindWalkClipForActor(stem: string): Promise<WalkBindResult> {
  const actorGlb = path.join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${stem}.glb`);
  const provenancePath = path.join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${stem}.provenance.json`);
  if (!existsSync(actorGlb)) {
    return { stem, status: "failed", detail: `actor GLB not found: ${actorGlb}` };
  }
  const existing = await existingClipName(actorGlb);
  let removeClips: Array<{ clipName: string; reason: string }> | undefined;
  if (existing) {
    const check = await verifyClipTravelHeading(actorGlb, existing);
    if (check.ok) {
      return {
        stem,
        status: "already_bound",
        detail: `${actorGlb} already carries ${CLIP_NAME} with correct travel heading`,
        headingCheck: check,
      };
    }
    removeClips = [
      {
        clipName: existing,
        reason: `rebound with corrected --source-orientation: ${check.detail}`,
      },
    ];
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const boundGlb = path.join(WORK_DIR, `${stem}-walk-bound.glb`);
  const bindReport = path.join(WORK_DIR, `${stem}-walk-bind-report.json`);
  const walkSourceGlb = path.join(WORK_DIR, "walk-source.glb");

  // Blender IMPORTS whatever clips the actor GLB already carries. On a REBIND, the actor on disk
  // still has the wrong-heading clip from the previous run: importing it alongside the freshly
  // retargeted action collides on the desired name, Blender suffixes the NEW one ".001", and the
  // OLD wrong clip keeps the base name — so every downstream step (drop, heading check, graft)
  // silently re-inspects the STALE clip instead of the one this run just produced. Measured on
  // the nurse: after switching --source-orientation, the heading numbers were byte-identical to
  // the pre-switch run, because the "fix" was never actually being checked. Strip any existing
  // animations from a COPY of the actor before feeding it to Blender, always — not just when a
  // clip is already published — so import never collides regardless of on-disk state.
  const bindInputActorGlb = path.join(WORK_DIR, `${stem}-walk-bind-input.glb`);
  {
    const io = new NodeIO();
    const document = await io.read(actorGlb);
    for (const animation of document.getRoot().listAnimations()) animation.dispose();
    await io.write(bindInputActorGlb, document);
  }

  const bindResult = await runBlender([
    "--background",
    "--python",
    STAGE_SCRIPT,
    "--",
    "--actor",
    bindInputActorGlb,
    "--clip",
    walkSourceGlb,
    "--map",
    TARGET_MAP,
    "--source-map",
    SOURCE_MAP,
    "--source-orientation",
    SOURCE_ORIENTATION,
    "--output",
    boundGlb,
    "--report",
    bindReport,
  ]);
  if (bindResult.code !== 0) {
    const reportText = existsSync(bindReport) ? readFileSync(bindReport, "utf8") : "";
    return {
      stem,
      status: "failed",
      detail: `motion_bind_stage.py exit ${bindResult.code}\n${bindResult.stderr.slice(-1500)}\n${reportText.slice(0, 1000)}`,
    };
  }

  // "First person, Z up" (the physician's own proven orientation, see the constant's comment
  // above) does not reliably prepend a duplicate rest key the way the retired "Third person, Z
  // up" bind did — measured on the nurse, whose hip key0->key1 step is 0.0 deg, correctly
  // refused by dropLeadingRestFrame's own precondition ("does not look like a prepended rest
  // frame"). That refusal means there is nothing to drop for THIS actor, not that the pipeline
  // is broken: fall back to the raw bind output rather than forcing a drop the safety check has
  // already said would remove real motion.
  const droppedGlb = path.join(WORK_DIR, `${stem}-walk-bound-dropped.glb`);
  let clipSourceForGraft = boundGlb;
  try {
    await dropLeadingRestFrame({ targetPath: boundGlb, clipName: CLIP_NAME, outputPath: droppedGlb });
    clipSourceForGraft = droppedGlb;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("does not look like a prepended rest frame")) throw err;
    console.log(`${stem}: no leading rest frame to drop (${message}); using the raw bind output`);
  }

  const headingCheck = await verifyClipTravelHeading(clipSourceForGraft, CLIP_NAME);
  if (!headingCheck.ok) {
    return {
      stem,
      status: "failed",
      detail: `refusing to publish — bound clip travels opposite its own rest foot orientation: ${headingCheck.detail}`,
      headingCheck,
    };
  }

  const graftOutputGlb = path.join(WORK_DIR, `${stem}-walk-bind-grafted.glb`);
  const graftReport = await graftBoundClip({
    targetPath: actorGlb,
    sourcePath: clipSourceForGraft,
    clipName: CLIP_NAME,
    ...(removeClips ? { removeClips } : {}),
    outputPath: graftOutputGlb,
    publish: {
      provenancePath,
      // No footPlantReportPath: no per-actor foot-plant measurement exists yet for this actor,
      // and the CLI's physician-only default would misattribute the physician's own numbers.
      sourceClipPath: SOURCE_CLIP_CITATION,
      licenceRecordPath: LICENCE_RECORD,
      licenceStatus: LICENCE_STATUS,
    },
  });

  return {
    stem,
    status: removeClips ? "rebound" : "bound",
    detail: `graftedChannels=${graftReport.graftedChannels} graftedJoints=${graftReport.graftedJoints} outputBytes=${graftReport.output.bytes}; ${headingCheck.detail}`,
    graftedChannels: graftReport.graftedChannels,
    graftedJoints: graftReport.graftedJoints,
    headingCheck,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const explicitActors = args
    .flatMap((arg, index) => (arg === "--actor" ? [args[index + 1]] : []))
    .filter((value): value is string => Boolean(value));
  const stems = explicitActors.length > 0 ? explicitActors : WALK_BIND_ACTORS.map((actor) => actor.stem);

  mkdirSync(WORK_DIR, { recursive: true });
  const walkSourceGlb = path.join(WORK_DIR, "walk-source.glb");
  if (!existsSync(walkSourceGlb)) {
    const extractionReport = path.join(WORK_DIR, "walk-source-extraction.json");
    const extraction = await runNode([
      EXTRACT_LIBRARY_CLIP_SCRIPT,
      "--library",
      LIBRARY_PATH,
      "--clip",
      LIBRARY_CLIP_NAME,
      "--output",
      walkSourceGlb,
      "--report",
      extractionReport,
    ]);
    if (extraction.code !== 0) {
      throw new Error(`extract-library-clip.ts exit ${extraction.code}\n${extraction.stderr.slice(-1500)}`);
    }
    const report = JSON.parse(readFileSync(extractionReport, "utf8")) as {
      clip: { channels: number; joints: number };
    };
    console.log(
      `EXTRACTED ${LIBRARY_CLIP_NAME}: channels=${report.clip.channels} joints=${report.clip.joints} -> ${walkSourceGlb}`,
    );
  } else {
    console.log(`REUSING extracted clip at ${walkSourceGlb}`);
  }

  if (dryRun) {
    console.log(JSON.stringify({ stems, skipped: WALK_BIND_SKIPPED }, null, 2));
    return;
  }

  const results: WalkBindResult[] = [];
  for (const stem of stems) {
    console.log(`BINDING ${stem}...`);
    const result = await bindWalkClipForActor(stem);
    results.push(result);
    console.log(`${result.status.toUpperCase()} ${stem}: ${result.detail}`);
  }

  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.status === "failed")) process.exit(1);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
