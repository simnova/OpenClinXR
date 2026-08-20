/**
 * #462 — isolated AA-vs-rest still pair on the shipped peds parent, AFTER the visemes02
 * bake reached it.
 *
 * THE INSTRUMENT (same isolated subject lab as #459/#460/#434):
 * `apps/ui-xr/isolated-subject.html` (`isolated-subject-lab.ts`), `subjectKind: "glb"`,
 * `bodyGlb: /xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb`, `focus: "head"`. The lab
 * derives the head box from the body's own bind-pose bounds, so the camera is identical
 * across both states by construction.
 *
 * THE DRIVE GOES THROUGH THE SHIPPED APPLIER AND IS READ BACK IN-PAGE.
 * `rest` drives `viseme_aa` at 0; `aa-full` drives it at 1.0 through
 * `applyVisemeWeights` (identity-first resolution on the REAL `viseme_aa` target — NOT the
 * FACS `mouth-open` alias, so #460's 0.3 cap does not apply). The probe REFUSES unless the
 * live influence reads back exactly 0 / 1.0, and refuses unless the two stills differ —
 * proving the viseme actually rendered, not just that the file exists.
 *
 * NOT TESTED: whether AA@1.0 on the real viseme SPARES the mid-face. That is what the
 * still pair is FOR and the superagent grades it — this contract asserts the pair exists
 * and that the drive took effect, never that it looks good.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer, stopPortlessDevServer,
} from "./lib/portless-server.js";
import { regionLuminance } from "./lib/png-region-luminance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const TARGET = "viseme_aa";
const SUBJECT = "mpfb-peds-parent-aisha.motion-bind.glb";
const GLB_URL_PATH = "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
const GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", GLB_URL_PATH);

const LEDGER = join(REPO_ROOT, "tools/openclinxr/evidence/parent-visemes02.json");
const STILLS: Record<string, string> = {
  rest: "tools/openclinxr/evidence/stills/parent-visemes02-rest.png",
  "aa-full": "tools/openclinxr/evidence/stills/parent-visemes02-aa-full.png",
};

const VIEW_W = 1280;
const VIEW_H = 960;
/** Blank-frame floor (#431): real content sd 26.90-45.56, blanks 0.96-1.82. */
const MIN_CONTENT_SD = 8;
/** Contract (2): each still must carry rendered content. */
const MIN_STILL_BYTES = 40_000;

type StateDef = { stateId: string; requestedWeight: number };

const STATES: StateDef[] = [
  { stateId: "rest", requestedWeight: 0 },
  { stateId: "aa-full", requestedWeight: 1.0 },
];

type StateMeasure = {
  stateId: string;
  influence: number;
  targetIndex: number | null;
  appliedMeshes: number;
  otherMax: number;
  influenceCount: number;
};

/** In-page applier: drive `viseme_aa` through the shipped applyVisemeWeights, every 5 ms
 *  from before the scene root appears until the lab's 4-frame render loop draws its final
 *  frame (#460's bind-before-render discipline). */
function applierInitScript(state: StateDef): string {
  return `(async () => {
    const REQUESTED = ${JSON.stringify(state.requestedWeight)};
    const TARGET = ${JSON.stringify(TARGET)};
    let applyFn = null;
    const importPromise = import("/src/viseme-morph-apply.js").then(function (mod) {
      applyFn = mod.applyVisemeWeights;
    });
    let applied = 0;
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      if (!applyFn) return;
      let touched = 0;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[TARGET];
        if (idx === undefined) return;
        applyFn(o, { [TARGET]: REQUESTED });
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
    void importPromise.catch(function () { /* surfaced by the applied>0 wait below */ });
    step();
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Read the LIVE influence of `viseme_aa` back from the scene graph. */
const MEASURE_EVALUATE = `(() => {
  const root = window.__openClinXrIsolatedSceneRoot;
  if (!root) return null;
  const TARGET = ${JSON.stringify(TARGET)};
  const out = { influence: 0, targetIndex: null, appliedMeshes: 0, otherMax: 0, influenceCount: 0 };
  root.traverse(function (o) {
    if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    const idx = o.morphTargetDictionary[TARGET];
    if (idx === undefined) return;
    const influences = o.morphTargetInfluences;
    out.appliedMeshes += 1;
    out.influenceCount = influences.length;
    if (out.targetIndex === null) out.targetIndex = idx;
    const w = Math.abs(influences[idx] || 0);
    if (w > Math.abs(out.influence)) out.influence = influences[idx] || 0;
    for (let k = 0; k < influences.length; k++) {
      if (k === idx) continue;
      const v = Math.abs(influences[k] || 0);
      if (v > out.otherMax) out.otherMax = v;
    }
  });
  return out;
})()`;

export async function runParentVisemes02Stills(): Promise<void> {
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
      subjectId: "parent_visemes02",
      subjectKind: "glb",
      bodyGlb: GLB_URL_PATH,
      focus: "head",
      label: "parent visemes02 AA-vs-rest subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;

    const browser = await chromium.launch({ headless: true });
    const rows: StateMeasure[] = [];

    async function loadState(browser: Browser, state: StateDef): Promise<StateMeasure> {
      const page: Page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });
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
        const labError = (await page.evaluate(
          `(() => document.querySelector("#app")?.textContent ?? "")()`,
        )) as string;
        if (labError.includes("Isolated subject lab error")) {
          throw new Error(`${state.stateId}: isolated subject lab refused: ${labError.slice(0, 2000)}`);
        }
        if (pageErrors.length) {
          throw new Error(`${state.stateId}: page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
        }
        await page.evaluate(
          `(() => { if (window.__openClinXrMorphApplierStop) window.__openClinXrMorphApplierStop(); })()`,
        );
        await page.waitForTimeout(300);

        const measure = (await page.evaluate(MEASURE_EVALUATE)) as StateMeasure | null;
        if (!measure) throw new Error(`${state.stateId}: in-page measure returned nothing`);
        if (measure.targetIndex === null) throw new Error(`${state.stateId}: ${TARGET} absent from every skinned mesh`);
        if (measure.appliedMeshes === 0) throw new Error(`${state.stateId}: applier never drove a mesh`);

        const abs = join(REPO_ROOT, STILLS[state.stateId]!);
        await mkdir(dirname(abs), { recursive: true });
        const canvas = page.locator("#isolated-subject-capture-canvas");
        if (await canvas.count()) {
          await canvas.screenshot({ path: abs });
        } else {
          await page.screenshot({ path: abs, type: "png" });
        }
        const stillBytes = await readFile(abs);
        const stillStat = await stat(abs);
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
          `${state.stateId}: influence=${measure.influence} targetIndex=${measure.targetIndex} appliedMeshes=${measure.appliedMeshes} otherMax=${measure.otherMax} sd=${lum.sd.toFixed(2)} bytes=${stillStat.size}\n`,
        );
        return { ...measure, stateId: state.stateId };
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    try {
      for (const state of STATES) {
        rows.push(await loadState(browser, state));
      }
    } finally {
      await browser.close();
    }

    const byId = new Map(rows.map((r) => [r.stateId, r]));
    const rest = byId.get("rest")!;
    const aaFull = byId.get("aa-full")!;
    if (Math.abs(rest.influence) > 1e-6) {
      throw new Error(`rest influence read ${rest.influence}, expected 0`);
    }
    if (Math.abs(aaFull.influence - 1.0) > 1e-6) {
      throw new Error(
        `aa-full influence read ${aaFull.influence}, expected 1.0 — the viseme did not bind before render`,
      );
    }
    if (aaFull.otherMax > 1e-6) {
      throw new Error(`aa-full: other influences not at 0 (max ${aaFull.otherMax})`);
    }

    // The two stills must differ: the viseme rendered, not just a rest-pose re-draw.
    const restHash = sha256Hex(await readFile(join(REPO_ROOT, STILLS["rest"]!)));
    const aaFullHash = sha256Hex(await readFile(join(REPO_ROOT, STILLS["aa-full"]!)));
    if (restHash === aaFullHash) {
      throw new Error(`rest and aa-full stills are byte-identical — ${TARGET} did not render`);
    }
    process.stdout.write(`stills differ: rest=${restHash.slice(0, 16)}… aa-full=${aaFullHash.slice(0, 16)}…\n`);

    const ledger = {
      schemaVersion: "openclinxr.parent-visemes02.v1",
      issue: "462",
      factoryStep: "clothing_generate",
      generatedAt: new Date().toISOString(),
      target: TARGET,
      subject: SUBJECT,
      sourceGlb: GLB_URL_PATH,
      sourceGlbSha256: servedSha256,
      appliedThrough:
        "apps/ui-xr/src/viseme-morph-apply.ts applyVisemeWeights — resolved name 'viseme_aa' at full 1.0 " +
        "(identity-first on the REAL viseme target, not the FACS mouth-open alias, so #460's 0.3 cap does not apply)",
      caseResolution: {
        bakedName: "viseme_aa",
        runtimeToken: "AA",
        measured:
          "resolveVisemeTarget('AA', [viseme_aa,...]) === 'viseme_aa' (viseme-timeline-drive.ts, case-insensitive); " +
          "resolveMorphTarget('viseme_aa', names) === 'viseme_aa' (identity-first). No rename needed on either side.",
      },
      states: rows.map((r) => ({
        stateId: r.stateId,
        influence: r.influence,
        targetIndex: r.targetIndex,
        appliedMeshes: r.appliedMeshes,
        otherMax: r.otherMax,
        influenceCount: r.influenceCount,
      })),
      stills: [
        { stateId: "rest", path: STILLS["rest"]! },
        { stateId: "aa-full", path: STILLS["aa-full"]! },
      ],
      claimScope:
        "the shipped peds parent now carries the 15 visemes02 targets and the shipped applier drives " +
        "viseme_aa at full 1.0 in the running scene (live influence readback), evidenced by two face-framed " +
        "isolated stills sharing one derived camera",
      notEvidenceFor: [
        "whether AA@1.0 on the real viseme spares the mid-face (the superagent grades the stills)",
        "the runtime mixer or dialogue timing",
        "other actors, Quest, frame budget",
        "clinical validity",
        "scoring validity",
      ],
    };

    const json = `${JSON.stringify(ledger, null, 2)}\n`;
    await writeFile(LEDGER, json, "utf8");
    process.stdout.write(`${LEDGER}\n`);
    for (const s of ledger.stills) process.stdout.write(`${join(REPO_ROOT, s.path)}\n`);
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
  void runParentVisemes02Stills().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
