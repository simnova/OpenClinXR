/**
 * #431 (#402 reproduce / #419 E2) — AN ISOLATED SPEAKING/NOT-SPEAKING STILL PAIR FOR THE PARENT.
 *
 * ## THE INSTRUMENT (v2 — the scenario runtime does not render in this environment)
 *
 * The v1 probe captured from the scenario runtime and produced two empty grey fields (graded:
 * mean 142.7 sd 0.96 and mean 184.3 sd 1.82 against a known-good sheet at sd 26.90). The
 * orchestrator's ruling changed the instrument: render the parent through the ISOLATED SUBJECT
 * LAB (`apps/ui-xr/isolated-subject.html` → `isolated-subject-lab.ts`), a separate render path
 * that derives the camera from the subject mesh and has produced graded renders on other
 * subjects. This file is that instrument.
 *
 * ## WHAT IS REUSED (no third harness)
 *
 *  - The isolated lab page IS the harness: `subjectKind: "glb"`, `focus: "head"`. The camera is
 *    derived from the mesh by the lab itself (`computeMeshBounds` → `resolveFocus("head")` →
 *    `frameCamera`): the head-region AABB from the subject's own bounds, mouth in the lower
 *    middle of the frame. No camera position is authored here (D1).
 *  - `spawnPortlessDevServer` from `./lib/portless-server.js` (the shared boot path the E2.2
 *    probe uses).
 *
 * ## THE TWO STATES
 *
 * The isolated lab cannot drive the runtime speaking state (no dialogue, no mouth cue), so the
 * speaking frame is the orchestrator-sanctioned stand-in: the SAME actor, SAME GLB bytes, with
 * the `mouth-open` morph (the `viseme_AA` jaw-drop target per `morph-target-resolver.ts`)
 * driven to weight 1.0 — rest vs one mouth-open viseme at full weight.
 *
 *  - not-speaking: the lab renders the parent with all morph influences at 0 (rest).
 *  - speaking: the lab renders the parent with `mouth-open` influence = 1.0.
 *
 * The morph is applied from an in-page interval the moment `window.__openClinXrIsolatedSceneRoot`
 * appears — BEFORE the lab's 4-frame render loop draws the final frame — so the rendered frame
 * carries the viseme while the framing came from the unmorphed bind-pose bounds.
 *
 * ## SAME CAMERA, SAME FRAMING — BY CONSTRUCTION
 *
 * `computeMeshBounds` and `resolveFocus` read `geometry.attributes.position` (bind pose, no morph
 * displacement), so the head box and the derived camera are byte-identical whether the mouth-open
 * morph is applied or not. The lab records `packFraming.boundsMin/boundsMax` and `focusRegion`
 * per load; this probe records both loads' records in the artifact and refuses to write if they
 * differ by more than 1 mm — the pair then shares one derived camera by measurement, not by
 * assertion.
 *
 * ## THE GLB BYTES
 *
 * Both frames are rendered from `mpfb-peds-parent-aisha.motion-bind.glb` — the runtime path for
 * `parent_tara_johnson_v1` (`humanoid-runtime-asset-url.ts`), which carries 32 morph targets
 * including `mouth-open`. The probe hashes the bytes served by the dev server at that path and
 * the tracked file on disk, and requires them to be equal, so `sourceGlbSha256` is the exact
 * byte identity of what both frames were captured from.
 *
 * ## ARTIFACT BOOKKEEPING
 *
 * Each frame row is written from ITS OWN file's bytes and sha256, computed after both stills
 * exist. The v1 artifact stamped one frame's hash onto both rows; that bug is fixed by reading
 * the files at the end and building the rows from the reads.
 *
 * ## NOT TESTED / CLAIM SCOPE
 *
 * This probe does not judge whether a spike is present — the orchestrator grades the pair. The
 * viseme stand-in is not the runtime speaking state; the artifact says so. No cause, no fix, no
 * rebake, no GLB touched, no `apps/ui-xr` product edit.
 */

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer, stopPortlessDevServer,
} from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
/** Runtime asset path for parent_tara_johnson_v1 (humanoid-runtime-asset-url.ts). */
const SOURCE_GLB_URL_PATH = "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
/** Same bytes on disk, so the recorded hash ties the stills to a tracked file. */
const SOURCE_GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", SOURCE_GLB_URL_PATH);

/** Mouth-open viseme target (viseme_AA jaw drop) — verified present on the parent GLB. */
const MOUTH_OPEN_MORPH = "mouth-open";
const MORPH_WEIGHT = 1.0;

const NOT_SPEAKING_STILL = "tools/openclinxr/evidence/stills/speaking-parent-not-speaking.png";
const SPEAKING_STILL = "tools/openclinxr/evidence/stills/speaking-parent-speaking.png";
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-parent-still-pair.json");

type LabEvidence = {
  meshCount: number;
  boundsMeters: { width: number; height: number; depth: number };
  packFraming: {
    boundsMin: { x: number; y: number; z: number };
    boundsMax: { x: number; y: number; z: number };
    packCamera: unknown;
  };
  frameCoverage: number;
  focusRegion: { kind: string; neckPositionMeters?: number };
};

/** In-page morph applier: fires the instant the lab exposes the scene root, before its render. */
function morphApplierEvaluate(morphName: string, weight: number): string {
  return `(() => {
    const MORPH = ${JSON.stringify(morphName)};
    const WEIGHT = ${JSON.stringify(weight)};
    let applied = 0;
    let handled = 0;
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      handled += 1;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[MORPH];
        if (idx === undefined) return;
        o.morphTargetInfluences[idx] = WEIGHT;
        applied += 1;
      });
    };
    window.__openClinXrMorphApplier = { applied: 0, handled: 0, running: true };
    const timer = window.setInterval(function () {
      step();
      window.__openClinXrMorphApplier.applied = applied;
      window.__openClinXrMorphApplier.handled = handled;
    }, 5);
    window.__openClinXrMorphApplierStop = function () { window.clearInterval(timer); window.__openClinXrMorphApplier.running = false; };
    step();
    return { ok: true };
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function runSpeakingParentStillPairProbe(): Promise<void> {
  let server: PortlessDevServer | undefined;
  const frameRows: Array<{ stateId: string; speakingFlag: boolean; evidence: LabEvidence; morphInfluence: number; morphReadback: { appliedMeshes: number; maxInfluence: number } | null }> = [];
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    // The bytes both frames are rendered from: hash the served GLB and require it to match the
    // tracked file, so the recorded hash is the exact byte identity of the rendered frames.
    const served = await fetch(new URL(SOURCE_GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    const servedSha256 = sha256Hex(servedBytes);
    const diskBytes = await readFile(SOURCE_GLB_DISK_PATH);
    const diskSha256 = sha256Hex(diskBytes);
    if (servedSha256 !== diskSha256) {
      throw new Error(
        `served GLB (${servedSha256}) differs from tracked file (${diskSha256}) — refusing to record a hash that does not match the frames' bytes`,
      );
    }
    process.stdout.write(`sourceGlbSha256=${servedSha256} (served == tracked)\n`);

    const spec = {
      subjectId: PARENT_ACTOR_ID,
      subjectKind: "glb",
      bodyGlb: SOURCE_GLB_URL_PATH,
      focus: "head",
      label: "parent speaking-pair subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;
    process.stdout.write(`labUrl=${labUrl}\n`);

    const browser = await chromium.launch({ headless: true });
    try {
      for (const state of [
        { stateId: "not-speaking", applyMorph: false },
        { stateId: "speaking", applyMorph: true },
      ] as const) {
        const page: Page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
        try {
          await page.goto(labUrl, { waitUntil: "networkidle", timeout: 240_000 });
          if (state.applyMorph) {
            // Start the in-page applier BEFORE the GLB finishes loading; it fires within 5 ms of
            // the root appearing — long before the lab's 4-frame render loop draws its final frame.
            await page.evaluate(morphApplierEvaluate(MOUTH_OPEN_MORPH, MORPH_WEIGHT));
          }
          await page.waitForFunction(
            `(() => {
              const root = window.__openClinXrIsolatedSceneRoot;
              if (!root) return false;
              let hasSkinned = false;
              root.traverse(function (o) {
                if (o.isSkinnedMesh && o.geometry && o.geometry.attributes.skinIndex) hasSkinned = true;
              });
              return hasSkinned;
            })()`,
            { timeout: 120_000 },
          );
          await page.waitForFunction(
            `() => window.__openClinXrIsolatedSubjectEvidence != null`,
            { timeout: 60_000 },
          );
          if (state.applyMorph) {
            await page.evaluate(`() => { if (window.__openClinXrMorphApplierStop) window.__openClinXrMorphApplierStop(); }`);
          }
          await page.waitForTimeout(300); // settle; canvas holds the final rendered frame

          const info = (await page.evaluate(`(() => {
            const ev = window.__openClinXrIsolatedSubjectEvidence;
            const root = window.__openClinXrIsolatedSceneRoot;
            const out = {
              evidence: null,
              morphInfluence: 0,
              appliedMeshes: 0,
              hasMouthOpen: false,
              cameraInScene: null,
            };
            if (ev) {
              out.evidence = {
                meshCount: ev.meshCount,
                boundsMeters: ev.boundsMeters,
                packFraming: ev.packFraming,
                frameCoverage: ev.frameCoverage,
                focusRegion: ev.focusRegion,
              };
            }
            if (root) {
              let maxInf = 0;
              let applied = 0;
              let hasMouthOpen = false;
              root.traverse(function (o) {
                if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
                const idx = o.morphTargetDictionary["mouth-open"];
                if (idx !== undefined) hasMouthOpen = true;
                for (let k = 0; k < o.morphTargetInfluences.length; k++) {
                  const v = Math.abs(o.morphTargetInfluences[k] || 0);
                  if (v > maxInf) maxInf = v;
                }
                if (idx !== undefined && Math.abs((o.morphTargetInfluences[idx] || 0) - 1) < 1e-6) applied += 1;
              });
              out.morphInfluence = Number(maxInf.toFixed(4));
              out.appliedMeshes = applied;
              out.hasMouthOpen = hasMouthOpen;
            }
            let cam = null;
            const scene = window.__openClinXrIsolatedSceneRoot;
            return out;
          })()`) as unknown as {
            evidence: LabEvidence | null;
            morphInfluence: number;
            appliedMeshes: number;
            hasMouthOpen: boolean;
          });
          if (!info.evidence) throw new Error(`${state.stateId}: lab evidence missing`);
          if (!info.hasMouthOpen) {
            throw new Error(`${state.stateId}: parent GLB has no mouth-open morph on any skinned mesh`);
          }
          if (state.applyMorph && info.appliedMeshes === 0) {
            throw new Error(`${state.stateId}: morph applier never applied mouth-open to a mesh`);
          }
          if (state.applyMorph && info.morphInfluence < 0.99) {
            throw new Error(`${state.stateId}: mouth-open influence read ${info.morphInfluence}, expected 1.0`);
          }

          const still = state.stateId === "speaking" ? SPEAKING_STILL : NOT_SPEAKING_STILL;
          const abs = join(REPO_ROOT, still);
          await page.screenshot({ path: abs, type: "png" });
          process.stdout.write(
            `${state.stateId}: meshCount=${info.evidence.meshCount} coverage=${info.evidence.frameCoverage.toFixed(3)} morph=${info.morphInfluence} appliedMeshes=${info.appliedMeshes}\n`,
          );
          frameRows.push({
            stateId: state.stateId,
            speakingFlag: state.stateId === "speaking",
            evidence: info.evidence,
            morphInfluence: info.morphInfluence,
            morphReadback: { appliedMeshes: info.appliedMeshes, maxInfluence: info.morphInfluence },
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close();
    }

    // --- Bookkeeping: rows come from the files, after both exist. ---
    const rest = frameRows.find((r) => r.stateId === "not-speaking")!;
    const speak = frameRows.find((r) => r.stateId === "speaking")!;
    const restStillAbs = join(REPO_ROOT, NOT_SPEAKING_STILL);
    const speakStillAbs = join(REPO_ROOT, SPEAKING_STILL);
    const [restBytes, speakBytes, restData, speakData] = await Promise.all([
      stat(restStillAbs).then((s) => s.size),
      stat(speakStillAbs).then((s) => s.size),
      readFile(restStillAbs),
      readFile(speakStillAbs),
    ]);
    const restSha = sha256Hex(restData);
    const speakSha = sha256Hex(speakData);
    if (restSha === speakSha) {
      throw new Error(
        "both stills are byte-identical — the viseme was not in the rendered frame; refusing to write a pair that compares nothing",
      );
    }

    // Same derived camera: the lab's framing records must match to the millimetre.
    const boundsEqual = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean =>
      Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.z - b.z) < 0.001;
    if (
      !boundsEqual(rest.evidence.packFraming.boundsMin, speak.evidence.packFraming.boundsMin) ||
      !boundsEqual(rest.evidence.packFraming.boundsMax, speak.evidence.packFraming.boundsMax)
    ) {
      throw new Error("the lab derived DIFFERENT subject bounds for the two states — framing is not shared");
    }

    const frames = [
      {
        stateId: rest.stateId,
        speakingFlag: rest.speakingFlag,
        morphInfluence: rest.morphInfluence,
        still: NOT_SPEAKING_STILL,
        bytes: restBytes,
        sha256: restSha,
        labEvidence: rest.evidence,
        morphReadback: rest.morphReadback,
      },
      {
        stateId: speak.stateId,
        speakingFlag: speak.speakingFlag,
        morphInfluence: speak.morphInfluence,
        still: SPEAKING_STILL,
        bytes: speakBytes,
        sha256: speakSha,
        labEvidence: speak.evidence,
        morphReadback: speak.morphReadback,
      },
    ];

    const artifact = {
      schemaVersion: "openclinxr.speaking-parent-still-pair.v2",
      generatedAt: new Date().toISOString(),
      actor: PARENT_ACTOR_ID,
      sourceGlb: SOURCE_GLB_URL_PATH,
      sourceGlbSha256: servedSha256,
      speakingStateNote:
        "The isolated subject lab cannot drive the runtime speaking state (no dialogue, no mouth cue), so the speaking frame is the sanctioned stand-in: " +
        "the SAME actor from the SAME GLB bytes with the mouth-open morph (viseme_AA jaw drop, per morph-target-resolver.ts) driven to weight 1.0. " +
        "not-speaking = all morph influences at 0 (rest). This is a viseme morph stand-in, not the runtime speaking state.",
      source:
        "isolated subject lab renders (apps/ui-xr/isolated-subject.html -> isolated-subject-lab.ts) via playwright headless chromium against the ui-xr " +
        "portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); subjectKind=glb, bodyGlb=mpfb-peds-parent-aisha.motion-bind.glb, focus=head; " +
        "camera derived by the lab from the head-region AABB of the subject's own unmorphed bounds (computeMeshBounds -> resolveFocus -> frameCamera), never a " +
        "hardcoded position; the mouth-open morph is applied from an in-page interval the moment the lab exposes the scene root, before its 4-frame render loop " +
        "draws the final frame; both frames share the derived camera (framing records compared to 1 mm in this probe); NOT the scenario runtime, NOT a static asset read.",
      url: labUrl,
      frames,
      claimScope:
        "an isolated rest-vs-mouth-open-viseme still pair of parent_tara_johnson_v1 (peds asthma parent GLB), same GLB bytes, same derived camera and framing, " +
        "differing only in the mouth-open morph weight; #402 reproduce / #419 E2.3",
      notEvidenceFor: [
        "the runtime speaking state (this is a viseme stand-in, not dialogue)",
        "whether a spike is present (the orchestrator grades the pair)",
        "the cause",
        "any fix",
        "production phoneme timing",
        "clinical validity",
        "scoring validity",
        "quest readiness",
      ],
    };

    const json = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(ARTIFACT, json, "utf8");
    process.stdout.write(`${ARTIFACT}\n`);
    process.stdout.write(`${restStillAbs}\n`);
    process.stdout.write(`${speakStillAbs}\n`);
  } finally {
    if (server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runSpeakingParentStillPairProbe().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
