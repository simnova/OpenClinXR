/**
 * AU12 smile grade — isolated control vs treatment stills of FACS mouth-corner-puller on the GRADE SUBJECT.
 *
 * SUBJECT: body-param-adult_lean_female-library.glb (phenotype adult_lean_female, library garment, 32 FACS targets).
 * TARGET: "mouth-corner-puller" — present on this GLB per provenance (morphTargetNames includes it).
 *
 * CONTROL: weight 0 (rest). TREATMENT: weight 0.5 (runtime reassured value from live UI-XR emotion path).
 * SAME CAMERA: isolated-subject-lab `focus: "head"` derives head box from bind-pose bounds — identical by construction.
 * APPLIER: direct drive (not through applyVisemeWeights — that caps mouth-open; mouth-corner-puller has no cap).
 *
 * PNGs: .openclinxr/evidence/au12-smile-grade/{control,treatment}.png (gitignored) + docs/assets/au12-smile-{control,treatment}.png for harvest.
 * JSON: tools/openclinxr/evidence/au12-smile-grade/au12-smile-grade.json (tracked).
 * CLAIM SCOPE: au12_mouth_corner_puller_isolated. NOT EVIDENCE FOR: clinical, Quest, AU6, cavity win.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer, stopPortlessDevServer,
} from "../lib/portless-server.js";
import { regionLuminance } from "../lib/png-region-luminance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Known workspace root structure: tools/openclinxr/evidence/au12-smile-grade/ is 4 levels deep from openclinxr root
const REPO_ROOT = pathResolve(HERE, "../../../..");

const TARGET = "mouth-corner-puller";
const SUBJECT = "body-param-adult_lean_female-library.glb";
const GLB_URL_PATH = "/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";
const GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", GLB_URL_PATH);

const CONTROL_WEIGHT = 0;
const TREATMENT_WEIGHT = 0.5;

const EVIDENCE_DIR = join(REPO_ROOT, ".openclinxr/evidence/au12-smile-grade");
const STILLS = {
  control: join(EVIDENCE_DIR, "control.png"),
  treatment: join(EVIDENCE_DIR, "treatment.png"),
};

const HARVEST_DIR = join(REPO_ROOT, "docs/assets");
const HARVEST_STILLS = {
  control: join(HARVEST_DIR, "au12-smile-control.png"),
  treatment: join(HARVEST_DIR, "au12-smile-treatment.png"),
};

const JSON_OUT = join(REPO_ROOT, "tools/openclinxr/evidence/au12-smile-grade/au12-smile-grade.json");

const VIEW_W = 1280;
const VIEW_H = 960;
const MIN_CONTENT_SD = 8;
const MIN_STILL_BYTES = 40_000;

type StateDef = {
  stateId: "control" | "treatment";
  requestedWeight: number;
};

const STATES: StateDef[] = [
  { stateId: "control", requestedWeight: CONTROL_WEIGHT },
  { stateId: "treatment", requestedWeight: TREATMENT_WEIGHT },
];

type Vec3 = { x: number; y: number; z: number };
type StateMeasure = {
  stateId: string;
  influence: number;
  targetIndex: number | null;
  appliedMeshes: number;
  otherMax: number;
  influenceCount: number;
  packFraming: { boundsMin: Vec3; boundsMax: Vec3 } | null;
  focusRegion: { kind: string; boundsMeters: { min: Vec3; max: Vec3 } } | null;
};

/**
 * In-page applier: drives TARGET to REQUESTED directly (every other influence = 0), every 5 ms
 * from before the lab exposes the scene root until the lab's 4-frame render loop has drawn
 * its final frame. Direct drive — NOT through applyVisemeWeights.
 */
function applierInitScript(state: StateDef): string {
  return `(async () => {
    const REQUESTED = ${JSON.stringify(state.requestedWeight)};
    const TARGET = ${JSON.stringify(TARGET)};
    let applied = 0;
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      let touched = 0;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[TARGET];
        if (idx === undefined) return;
        for (let k = 0; k < o.morphTargetInfluences.length; k++) o.morphTargetInfluences[k] = 0;
        o.morphTargetInfluences[idx] = REQUESTED;
        touched += 1;
      });
      applied = touched;
      window.__openClinXrMorphApplier = { applied: applied, running: true };
    };
    window.__openClinXrMorphApplierStop = function () {
      window.clearInterval(timer);
      if (window.__openClinXrMorphApplier) window.__openClinXrMorphApplier.running = false;
    };
    const timer = window.setInterval(step, 5);
    step();
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function boundsEqual(a: Vec3, b: Vec3, tol = 0.001): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
}

/**
 * In-page evaluator: reads live morph influence + records lab framing evidence.
 */
const MEASURE_EVALUATE = `(() => {
  const root = window.__openClinXrIsolatedSceneRoot;
  if (!root) return null;
  const ev = window.__openClinXrIsolatedSubjectEvidence;
  const TARGET = ${JSON.stringify(TARGET)};
  const out = {
    influence: 0, targetIndex: null, appliedMeshes: 0, otherMax: 0, influenceCount: 0,
    packFraming: null, focusRegion: null,
  };
  root.traverse(function (o) {
    if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    const idx = o.morphTargetDictionary[TARGET];
    if (idx === undefined) return;
    const influences = o.morphTargetInfluences;
    out.appliedMeshes += 1;
    out.influenceCount = influences.length;
    if (out.targetIndex === null) out.targetIndex = idx;
    const w = Math.abs(influences[idx] || 0);
    if (w > Math.abs(out.influence)) {
      out.influence = influences[idx] || 0;
    }
    for (let k = 0; k < influences.length; k++) {
      if (k === idx) continue;
      const v = Math.abs(influences[k] || 0);
      if (v > out.otherMax) out.otherMax = v;
    }
  });
  if (ev) {
    out.packFraming = ev.packFraming;
    out.focusRegion = ev.focusRegion;
  }
  return out;
})()`;

export async function runAu12SmileGradeCapture(): Promise<void> {
  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const served = await fetch(new URL(GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    const servedSha256 = sha256Hex(servedBytes);
    const diskBytes = await readFile(GLB_DISK_PATH);
    const diskSha256 = sha256Hex(diskBytes);
    if (servedSha256 !== diskSha256) {
      throw new Error(
        `served GLB (${servedSha256}) differs from tracked file (${diskSha256}) — refusing to record a hash that does not match the frames' bytes`,
      );
    }
    process.stdout.write(`subjectGlbSha256=${servedSha256} (served == tracked)\n`);

    const spec = {
      subjectId: "adult_lean_female_library_au12",
      subjectKind: "glb",
      bodyGlb: GLB_URL_PATH,
      focus: "head",
      label: "adult_lean_female library AU12 grade subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;

    const browser = await chromium.launch({ headless: true });
    const rows: StateMeasure[] = [];

    async function loadStateAndMeasure(pw: import("playwright").Browser, state: StateDef): Promise<StateMeasure> {
      const page: Page = await pw.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });
      try {
        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(String(err)));
        await page.addInitScript(applierInitScript(state));
        await page.goto(labUrl, { waitUntil: "networkidle", timeout: 240_000 });
        await page.waitForFunction(
          `(() => {
            if (window.__openClinXrIsolatedSubjectEvidence != null
                && window.__openClinXrMorphApplier != null
                && window.__openClinXrMorphApplier.applied > 0) return true;
            const app = document.querySelector("#app");
            return app != null && app.textContent.includes("Isolated subject lab error");
          })()`,
          { timeout: 120_000 },
        );
        const labError = await page.evaluate(
          `(() => document.querySelector("#app")?.textContent ?? "")()`,
        ) as string;
        if (labError.includes("Isolated subject lab error")) {
          throw new Error(`${state.stateId}: isolated subject lab refused: ${labError.slice(0, 2000)}`);
        }
        await page.evaluate(
          `(() => { if (window.__openClinXrMorphApplierStop) window.__openClinXrMorphApplierStop(); })()`,
        );
        await page.waitForTimeout(300);

        const measure = (await page.evaluate(MEASURE_EVALUATE)) as StateMeasure | null;
        if (!measure) throw new Error(`${state.stateId}: in-page measure returned nothing`);
        if (measure.targetIndex === null) throw new Error(`${state.stateId}: ${TARGET} absent from every skinned mesh`);
        if (measure.appliedMeshes === 0) throw new Error(`${state.stateId}: applier never drove a mesh`);

        const stillPath = STILLS[state.stateId]!;
        await mkdir(dirname(stillPath), { recursive: true });
        const canvas = page.locator("#isolated-subject-capture-canvas");
        if (await canvas.count()) {
          await canvas.screenshot({ path: stillPath });
        } else {
          await page.screenshot({ path: stillPath, type: "png" });
        }
        const stillBytes = await readFile(stillPath);
        const stillStat = await stat(stillPath);
        const lum = regionLuminance(stillBytes);
        if (!lum || lum.sd <= MIN_CONTENT_SD) {
          throw new Error(
            `${state.stateId}: flat/empty frame (mean ${lum?.mean.toFixed(1) ?? "?"}, sd ${lum?.sd.toFixed(2) ?? "?"}) — nothing rendered`,
          );
        }
        if (stillStat.size <= MIN_STILL_BYTES) {
          throw new Error(`${state.stateId}: still is ${stillStat.size} bytes — below the ${MIN_STILL_BYTES} floor`);
        }
        process.stdout.write(
          `${state.stateId}: influence=${measure.influence} appliedMeshes=${measure.appliedMeshes} otherMax=${measure.otherMax} ` +
            `sd=${lum.sd.toFixed(2)} bytes=${stillStat.size}\n`,
        );
        return { ...measure, stateId: state.stateId };
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    try {
      for (const state of STATES) {
        rows.push(await loadStateAndMeasure(browser, state));
      }
    } finally {
      await browser.close();
    }

    // Verify live influences match requested
    const byId = new Map(rows.map((r) => [r.stateId, r]));
    const control = byId.get("control")!;
    const treatment = byId.get("treatment")!;
    if (Math.abs(control.influence - CONTROL_WEIGHT) > 1e-6) {
      throw new Error(`control: live influence read ${control.influence}, expected ${CONTROL_WEIGHT}`);
    }
    if (Math.abs(treatment.influence - TREATMENT_WEIGHT) > 1e-6) {
      throw new Error(`treatment: live influence read ${treatment.influence}, expected ${TREATMENT_WEIGHT}`);
    }
    if (control.otherMax > 1e-6) {
      throw new Error(`control: other influences not at 0 (max ${control.otherMax})`);
    }
    if (treatment.otherMax > 1e-6) {
      throw new Error(`treatment: other influences not at 0 (max ${treatment.otherMax})`);
    }

    // Same derived camera: head boxes must match to 1 mm
    const first = rows[0]!;
    for (const row of rows) {
      if (!row.packFraming || !first.packFraming) {
        throw new Error(`${row.stateId}: packFraming missing — camera identity uncheckable`);
      }
      if (
        !boundsEqual(row.packFraming.boundsMin, first.packFraming.boundsMin) ||
        !boundsEqual(row.packFraming.boundsMax, first.packFraming.boundsMax)
      ) {
        throw new Error(
          `${row.stateId}: lab derived DIFFERENT bounds than ${first.stateId} — states do not share one derived camera`,
        );
      }
    }

    // Copy to harvest location
    await mkdir(HARVEST_DIR, { recursive: true });
    await copyFile(STILLS.control, HARVEST_STILLS.control);
    await copyFile(STILLS.treatment, HARVEST_STILLS.treatment);

    // Read stills for JSON
    const controlBytes = await readFile(STILLS.control);
    const treatmentBytes = await readFile(STILLS.treatment);
    const controlStat = await stat(STILLS.control);
    const treatmentStat = await stat(STILLS.treatment);
    const controlLum = regionLuminance(controlBytes)!;
    const treatmentLum = regionLuminance(treatmentBytes)!;
    const controlSha = sha256Hex(controlBytes);
    const treatmentSha = sha256Hex(treatmentBytes);

    if (controlSha === treatmentSha) {
      throw new Error(`control and treatment stills are identical (sha256 ${controlSha.slice(0,16)}…) — the morph did not render; refusing`);
    }

    const artifact = {
      schemaVersion: "openclinxr.au12-smile-grade.v1",
      generatedAt: new Date().toISOString(),
      subject: SUBJECT,
      sourceGlb: GLB_URL_PATH,
      sourceGlbSha256: servedSha256,
      morphTarget: TARGET,
      controlWeight: CONTROL_WEIGHT,
      treatmentWeight: TREATMENT_WEIGHT,
      states: rows.map((r) => ({
        stateId: r.stateId,
        influence: r.influence,
        targetIndex: r.targetIndex,
        appliedMeshes: r.appliedMeshes,
        otherMax: r.otherMax,
        influenceCount: r.influenceCount,
      })),
      camera: {
        derivation:
          "lab-derived head framing (camera-fit-to-bounds.ts resolveFocus('head') -> frameCamera) from the " +
          "subject's own bind-pose bounds — identical for both states by construction, verified to 1 mm " +
          "across the loads via packFraming bounds",
        framePx: { width: VIEW_W, height: VIEW_H },
        headBoxMeters: first.focusRegion?.boundsMeters ?? null,
      },
      stills: [
        {
          stateId: "control",
          path: STILLS.control,
          harvestPath: HARVEST_STILLS.control,
          bytes: controlStat.size,
          sha256: controlSha,
          luminance: { mean: Number(controlLum.mean.toFixed(2)), sd: Number(controlLum.sd.toFixed(2)) },
        },
        {
          stateId: "treatment",
          path: STILLS.treatment,
          harvestPath: HARVEST_STILLS.treatment,
          bytes: treatmentStat.size,
          sha256: treatmentSha,
          luminance: { mean: Number(treatmentLum.mean.toFixed(2)), sd: Number(treatmentLum.sd.toFixed(2)) },
        },
      ],
      claimScope: "au12_mouth_corner_puller_isolated",
      notEvidenceFor: [
        "clinical validity",
        "quest readiness",
        "AU6 cheek-raiser (absent on this GLB; shipped MPFB FACS has no AU6)",
        "cavity win (inner-mouth visibility not assessed here)",
        "whether 0.5 reads as reassured to a learner (structural intactness is not legibility)",
        "production phoneme timing or dialogue mixer",
        "scoring validity",
      ],
    };

    const json = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(JSON_OUT, json, "utf8");
    process.stdout.write(`${JSON_OUT}\n`);
    for (const s of artifact.stills) process.stdout.write(`${s.path} (${s.bytes} bytes, sha256=${s.sha256.slice(0,16)}…)\n`);
    process.stdout.write(`${HARVEST_STILLS.control} (harvest copy)\n`);
    process.stdout.write(`${HARVEST_STILLS.treatment} (harvest copy)\n`);
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
  void runAu12SmileGradeCapture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}