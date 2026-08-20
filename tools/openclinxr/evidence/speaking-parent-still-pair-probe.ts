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
 *
 * ## THE MOUTH-OPEN SWEEP (#459, E2) — ADDITIVE EXTENSION, SAME INSTRUMENT
 *
 * `runMouthOpenSweep()` (below) reuses this file's proven instrument — same lab page, same derived
 * camera, same in-page morph applier — to render `mouth-open` at **0 / 0.3 / 0.6 / 1.0** as ONE
 * labelled contact sheet. Deliverables: `mouth-open-sweep-sheet.png` + `mouth-open-sweep.json`
 * (both tracked; intermediates live under gitignored `.openclinxr/evidence/issue-459/cells`).
 * This is a MEASUREMENT slice: it does not fix the collapse, does not pick a threshold, does not
 * touch the two graded stills (`runSpeakingParentStillPairProbe` and its artifacts are unchanged).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { buildContactSheet } from "./isolated-subject-harness.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
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

/* =====================================================================
 * #459 E2 — MOUTH-OPEN SWEEP (0 / 0.3 / 0.6 / 1.0)
 * Same instrument as the pair: isolated-subject lab, head focus, derived
 * camera, in-page morph applier. Four renders -> one labelled sheet.
 * ===================================================================== */

/** The four weights the superagent specified. A sweep, not a threshold. */
const MOUTH_OPEN_WEIGHTS = [0, 0.3, 0.6, 1.0] as const;

const SWEEP_SHEET = join(REPO_ROOT, "tools/openclinxr/evidence/mouth-open-sweep-sheet.png");
const SWEEP_LEDGER = join(REPO_ROOT, "tools/openclinxr/evidence/mouth-open-sweep.json");
/** Full-size intermediates — gitignored by design (#396); the sheet/ledger are the tracked deliverables. */
const SWEEP_CELLS_DIR = join(REPO_ROOT, ".openclinxr/evidence/issue-459/cells");

type SweepCell = {
  morphWeight: number;
  imagePath: string;
  evidence: LabEvidence;
  mouthOpenInfluence: number;
  appliedMeshes: number;
};

/** In-page readback: mouth-open influence by NAME plus the frame-level evidence (not an unnamed max). */
function sweepReadbackEvaluate(weight: number): string {
  return `(() => {
    const TARGET_WEIGHT = ${JSON.stringify(weight)};
    const ev = window.__openClinXrIsolatedSubjectEvidence;
    const root = window.__openClinXrIsolatedSceneRoot;
    const out = { evidence: null, hasMouthOpen: false, mouthOpen: 0, maxInfluence: 0, appliedMeshes: 0 };
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
      let mouthOpen = 0;
      let maxInf = 0;
      let hasMouthOpen = false;
      let applied = 0;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary["mouth-open"];
        if (idx !== undefined) hasMouthOpen = true;
        for (let k = 0; k < o.morphTargetInfluences.length; k++) {
          const v = Math.abs(o.morphTargetInfluences[k] || 0);
          if (v > maxInf) maxInf = v;
        }
        if (idx !== undefined) {
          const v = o.morphTargetInfluences[idx] || 0;
          if (Math.abs(v) > Math.abs(mouthOpen)) mouthOpen = v;
          if (Math.abs(v - TARGET_WEIGHT) < 0.01) applied += 1;
        }
      });
      out.hasMouthOpen = hasMouthOpen;
      out.mouthOpen = Number(mouthOpen.toFixed(4));
      out.maxInfluence = Number(maxInf.toFixed(4));
      out.appliedMeshes = applied;
    }
    return out;
  })()`;
}

/** Same-camera check: bounds must match the rest cell to the millimetre (frame derives from bind pose). */
function sweepBoundsEqual(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.z - b.z) < 0.001;
}

/** #459 E2 — render mouth-open at the four sweep weights, compose ONE labelled sheet, write the ledger. */
export async function runMouthOpenSweep(): Promise<void> {
  let server: PortlessDevServer | undefined;
  const cells: SweepCell[] = [];
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    // The bytes every cell is rendered from: hash the served GLB and require it to match the
    // tracked file, so the recorded hash is the exact byte identity of the rendered cells.
    const served = await fetch(new URL(SOURCE_GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    const servedSha256 = sha256Hex(servedBytes);
    const diskBytes = await readFile(SOURCE_GLB_DISK_PATH);
    const diskSha256 = sha256Hex(diskBytes);
    if (servedSha256 !== diskSha256) {
      throw new Error(
        `served GLB (${servedSha256}) differs from tracked file (${diskSha256}) — refusing to record a hash that does not match the rendered bytes`,
      );
    }
    process.stdout.write(`sourceGlbSha256=${servedSha256} (served == tracked)\n`);

    const spec = {
      subjectId: PARENT_ACTOR_ID,
      subjectKind: "glb",
      bodyGlb: SOURCE_GLB_URL_PATH,
      focus: "head",
      label: "parent mouth-open sweep subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;
    process.stdout.write(`labUrl=${labUrl}\n`);

    const browser = await chromium.launch({ headless: true });
    try {
      for (const weight of MOUTH_OPEN_WEIGHTS) {
        const page: Page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
        try {
          await page.goto(labUrl, { waitUntil: "networkidle", timeout: 240_000 });
          if (weight > 0) {
            // Start the in-page applier BEFORE the render loop's final frame: it fires within
            // 5 ms of the root appearing and keeps the influence pinned until stopped.
            await page.evaluate(morphApplierEvaluate(MOUTH_OPEN_MORPH, weight));
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
          if (weight > 0) {
            await page.evaluate(`() => { if (window.__openClinXrMorphApplierStop) window.__openClinXrMorphApplierStop(); }`);
          }
          await page.waitForTimeout(300); // settle; canvas holds the final rendered frame

          const info = (await page.evaluate(sweepReadbackEvaluate(weight))) as unknown as {
            evidence: LabEvidence | null;
            hasMouthOpen: boolean;
            mouthOpen: number;
            maxInfluence: number;
            appliedMeshes: number;
          };
          if (!info.evidence) throw new Error(`weight ${weight}: lab evidence missing`);
          if (!info.hasMouthOpen) {
            throw new Error(`weight ${weight}: parent GLB has no mouth-open morph on any skinned mesh`);
          }
          if (info.appliedMeshes === 0) {
            throw new Error(`weight ${weight}: no skinned mesh carries mouth-open at the target weight`);
          }
          if (Math.abs(info.mouthOpen - weight) >= 0.02) {
            throw new Error(`weight ${weight}: mouth-open influence read ${info.mouthOpen}, expected ${weight}`);
          }
          if (weight === 0 && info.maxInfluence >= 0.02) {
            throw new Error(`weight 0: rest frame is not rest — max morph influence ${info.maxInfluence}`);
          }

          const cellPath = join(SWEEP_CELLS_DIR, `mouth-open-${weight.toFixed(1)}.png`);
          await mkdir(SWEEP_CELLS_DIR, { recursive: true });
          await page.screenshot({ path: cellPath, type: "png" });
          process.stdout.write(
            `weight ${weight}: meshCount=${info.evidence.meshCount} coverage=${info.evidence.frameCoverage.toFixed(3)} mouthOpen=${info.mouthOpen} appliedMeshes=${info.appliedMeshes}\n`,
          );
          cells.push({
            morphWeight: weight,
            imagePath: cellPath,
            evidence: info.evidence,
            mouthOpenInfluence: info.mouthOpen,
            appliedMeshes: info.appliedMeshes,
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      // A sweep whose cells are byte-identical answers nothing — refuse to compose it.
      const cellHashes = new Set<string>();
      for (const c of cells) cellHashes.add(sha256Hex(await readFile(c.imagePath)));
      if (cellHashes.size !== cells.length) {
        throw new Error("two sweep cells are byte-identical — the morph was not driven between cells");
      }

      // Same derived camera across all four cells: framing records must match the rest cell to 1 mm.
      const rest = cells.find((c) => c.morphWeight === 0)!;
      for (const c of cells) {
        if (
          !sweepBoundsEqual(rest.evidence.packFraming.boundsMin, c.evidence.packFraming.boundsMin) ||
          !sweepBoundsEqual(rest.evidence.packFraming.boundsMax, c.evidence.packFraming.boundsMax)
        ) {
          throw new Error(`weight ${c.morphWeight}: derived bounds differ from the rest cell — framing is not shared`);
        }
      }

      // One labelled contact sheet: 2x2 grid, 640x480 cells, 36px label band (buildContactSheet, #163).
      const composite = await browser.newPage();
      try {
        await buildContactSheet({
          page: composite,
          cells: cells.map((c) => ({
            imagePath: c.imagePath,
            label: c.morphWeight === 0 ? "mouth-open 0.0 (rest)" : `mouth-open ${c.morphWeight.toFixed(1)}`,
          })),
          outPath: SWEEP_SHEET,
          columns: 2,
          cellWidth: 640,
          cellHeight: 480,
        });
      } finally {
        await composite.close().catch(() => undefined);
      }
    } finally {
      await browser.close();
    }

    // Ledger: luminance per full-size cell render (the pixels the sheet downscales from).
    const cellEntries: Array<{ morphWeight: number; luminance: { mean: number; sd: number } }> = [];
    for (const c of cells) {
      const lum = regionLuminance(new Uint8Array(await readFile(c.imagePath)));
      if (!lum) throw new Error(`weight ${c.morphWeight}: cell PNG not decodable for luminance`);
      if (lum.sd <= 8) {
        throw new Error(`weight ${c.morphWeight}: cell reads as blank (sd ${lum.sd.toFixed(2)}) — refusing a sweep of blanks`);
      }
      cellEntries.push({
        morphWeight: c.morphWeight,
        luminance: { mean: Number(lum.mean.toFixed(2)), sd: Number(lum.sd.toFixed(2)) },
      });
    }

    const [sheetStat] = await Promise.all([stat(SWEEP_SHEET)]);
    if (sheetStat.size <= 60_000) {
      throw new Error(`composed sheet is only ${sheetStat.size} bytes — not a gradeable 4-cell sheet`);
    }

    const ledger = {
      schemaVersion: "openclinxr.mouth-open-sweep.v1",
      generatedAt: new Date().toISOString(),
      actor: PARENT_ACTOR_ID,
      sourceGlb: SOURCE_GLB_URL_PATH,
      sourceGlbSha256: servedSha256,
      weights: [...MOUTH_OPEN_WEIGHTS],
      cells: cellEntries,
      cameraNote:
        "one derived camera for all four cells by construction: the lab frames from the subject's unmorphed bind-pose bounds " +
        "(computeMeshBounds -> resolveFocus -> frameCamera), so the camera is byte-identical across weights; the probe compares " +
        "each cell's packFraming bounds to the rest cell to 1 mm and refuses to write otherwise.",
      source:
        "isolated subject lab renders (apps/ui-xr/isolated-subject.html -> isolated-subject-lab.ts) via playwright headless chromium against the ui-xr " +
        "portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); subjectKind=glb, bodyGlb=mpfb-peds-parent-aisha.motion-bind.glb, focus=head; " +
        "mouth-open driven to each sweep weight by the same in-page applier the still-pair probe uses, before the lab's 4-frame render loop draws the final frame; " +
        "one labelled contact sheet composed by buildContactSheet (Playwright HTML composite, no sharp dep); " +
        "luminance measured per full-size cell render by regionLuminance (lib/png-region-luminance.ts) over the whole frame.",
      url: labUrl,
      claimScope:
        "an isolated four-weight sweep of mouth-open (0/0.3/0.6/1.0) on parent_tara_johnson_v1 (peds asthma parent GLB), same GLB bytes, same derived camera, " +
        "one labelled contact sheet for the orchestrator to grade; #459 E2",
      notEvidenceFor: [
        "which weight is clinically acceptable (the orchestrator grades the sheet)",
        "the runtime mixer (nothing here changes what it emits)",
        "whether a spike is present (#402 — different shape, out of scope)",
        "the cause of the mid-face collapse",
        "any fix",
        "production phoneme timing",
        "clinical validity",
        "scoring validity",
        "quest readiness",
      ],
    };

    await writeFile(SWEEP_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    process.stdout.write(`${SWEEP_SHEET}\n`);
    process.stdout.write(`${SWEEP_LEDGER}\n`);
    for (const e of cellEntries) {
      process.stdout.write(
        `cell ${e.morphWeight}: luminance mean=${e.luminance.mean} sd=${e.luminance.sd}\n`,
      );
    }
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
  const sweep = process.argv.includes("--sweep");
  const run = sweep ? runMouthOpenSweep() : runSpeakingParentStillPairProbe();
  void run.catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
