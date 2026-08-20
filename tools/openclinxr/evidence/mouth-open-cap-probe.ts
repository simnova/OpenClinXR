/**
 * #460 — cap FACS `mouth-open` at 0.3, evidenced by mid-face vertex displacement + face-framed stills.
 *
 * ## THE INSTRUMENT (same lab as #459/#434 — the isolated subject lab, not the scenario runtime)
 *
 * `apps/ui-xr/isolated-subject.html` (`isolated-subject-lab.ts`), `subjectKind: "glb"`,
 * `bodyGlb: xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb`,
 * `focus: "head"`. The lab derives the head box from the body's own bind-pose bounds, so the
 * camera is identical across every state by construction — verified to 1 mm below.
 *
 * ## GEOMETRIC, NOT PHOTOMETRIC — #459's whole-frame luminance was blind to the collapse
 *
 * The ledger's `midFaceDeltaMm` is measured in-page from the LIVE scene graph, per state:
 * the applied influence `mesh.morphTargetInfluences[dictionary["mouth-open"]]` times the
 * mouth-open morph delta at each mid-face vertex (`geometry.morphAttributes.position[index]`,
 * the exact array the renderer blends), averaged over the mid-face band and expressed in mm.
 * The mid-face band is derived deterministically from the bind pose (never from the morphed
 * pose): the top 20% of body height = head slice; face side z >= head-center; central
 * |x - headCenter| < 0.6 * half head width; y in the middle 40% of the head slice (nose
 * bridge + cheeks + mouth region).
 *
 * ## THE CAP IS EXERCISED THROUGH THE SHIPPED APPLIER
 *
 * `rest`, `at-cap` and `full-request` are driven through `applyVisemeWeights` (the product
 * module, dynamically imported in-page) with `mouth-open` requested at 0 / 0.3 / 1.0. The
 * probe REFUSES unless the live influence reads back 0.3 for BOTH `at-cap` and `full-request`
 * — a full request clamped in the real scene is the product proof, not a ledger claim.
 *
 * `sweep-03` / `sweep-10` re-measure #459's two graded non-zero cells with the same geometric
 * instrument, driving the morph DIRECTLY at 0.3 / 1.0 (as the sweep did — no cap existed) so
 * the ledger keeps the graded 1.0 cell's true displacement as the upper reference.
 *
 * ## NOT TESTED / CLAIM SCOPE
 *
 * The orchestrator grades the three stills (rest / at-cap / full-request). No rebake, no GLB
 * touched, no `#459` sheet or ledger touched, no runtime mixer change.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer, stopPortlessDevServer,
} from "./lib/portless-server.js";
import { regionLuminance } from "./lib/png-region-luminance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const CAP = 0.3;
const TARGET = "mouth-open";
const SUBJECT = "mpfb-peds-parent-aisha.motion-bind.glb";
const GLB_URL_PATH = "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
const GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", GLB_URL_PATH);

const LEDGER = join(REPO_ROOT, "tools/openclinxr/evidence/mouth-open-cap.json");
const STILLS: Record<string, string> = {
  rest: "tools/openclinxr/evidence/stills/mouth-open-rest.png",
  "at-cap": "tools/openclinxr/evidence/stills/mouth-open-at-cap.png",
  "full-request": "tools/openclinxr/evidence/stills/mouth-open-full-request.png",
};

const VIEW_W = 1280;
const VIEW_H = 960;
/** Blank-frame floor (#431): real content sd 26.90-45.56, blanks 0.96-1.82. */
const MIN_CONTENT_SD = 8;
/** Contract (2): each still must carry rendered content. */
const MIN_STILL_BYTES = 40_000;

type StateDef = {
  stateId: string;
  requestedWeight: number;
  /** Through the shipped applyVisemeWeights (cap exercised) vs direct drive (mirrors #459's sweep cells). */
  throughApplier: boolean;
};

const STATES: StateDef[] = [
  { stateId: "rest", requestedWeight: 0, throughApplier: true },
  { stateId: "at-cap", requestedWeight: 0.3, throughApplier: true },
  { stateId: "full-request", requestedWeight: 1.0, throughApplier: true },
  { stateId: "sweep-03", requestedWeight: 0.3, throughApplier: false },
  { stateId: "sweep-10", requestedWeight: 1.0, throughApplier: false },
];

type Vec3 = { x: number; y: number; z: number };
type StateMeasure = {
  stateId: string;
  influence: number;
  targetIndex: number | null;
  appliedMeshes: number;
  otherMax: number;
  influenceCount: number;
  midFaceVertexCount: number;
  midFaceMeanDeltaMm: number | null;
  packFraming: { boundsMin: Vec3; boundsMax: Vec3 } | null;
  focusRegion: { kind: string; boundsMeters: { min: Vec3; max: Vec3 } } | null;
};

/**
 * In-page applier: drives `mouth-open` to REQUESTED, either through the shipped
 * `applyVisemeWeights` (the cap path) or directly (mirrors #459's sweep drive), every 5 ms
 * from before the lab exposes the scene root until the lab's 4-frame render loop has drawn
 * its final frame.
 */
function applierInitScript(state: StateDef): string {
  return `(async () => {
    const REQUESTED = ${JSON.stringify(state.requestedWeight)};
    const THROUGH_APPLIER = ${JSON.stringify(state.throughApplier)};
    const TARGET = ${JSON.stringify(TARGET)};
    let applyFn = null;
    const getApply = async function () {
      if (applyFn) return applyFn;
      const mod = await import("/src/viseme-morph-apply.js");
      applyFn = mod.applyVisemeWeights;
      return applyFn;
    };
    let applied = 0;
    const step = async function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      const fn = THROUGH_APPLIER ? await getApply() : null;
      let touched = 0;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[TARGET];
        if (idx === undefined) return;
        if (THROUGH_APPLIER) {
          fn(o, { [TARGET]: REQUESTED });
        } else {
          for (let k = 0; k < o.morphTargetInfluences.length; k++) o.morphTargetInfluences[k] = 0;
          o.morphTargetInfluences[idx] = REQUESTED;
        }
        touched += 1;
      });
      applied = touched;
      window.__openClinXrMorphApplier = { applied: applied, running: true };
    };
    window.__openClinXrMorphApplierStop = function () {
      window.clearInterval(timer);
      if (window.__openClinXrMorphApplier) window.__openClinXrMorphApplier.running = false;
    };
    const timer = window.setInterval(function () { void step(); }, 5);
    await step();
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function boundsEqual(a: Vec3, b: Vec3, tol = 0.001): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
}

/** Mid-face vertex selection + mean mouth-open delta, computed in-page from the LIVE mesh graph. */
const MEASURE_EVALUATE = `(() => {
  const root = window.__openClinXrIsolatedSceneRoot;
  if (!root) return null;
  const ev = window.__openClinXrIsolatedSubjectEvidence;
  const TARGET = ${JSON.stringify(TARGET)};
  const out = {
    influence: 0, targetIndex: null, appliedMeshes: 0, otherMax: 0, influenceCount: 0,
    midFaceVertexCount: 0, midFaceMeanDeltaMm: null,
    packFraming: null, focusRegion: null,
  };
  const parts = [];
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
    const geom = o.geometry;
    const pos = geom && geom.attributes && geom.attributes.position;
    const morph = geom && geom.morphAttributes && geom.morphAttributes.position;
    if (!pos || !morph || !morph[idx]) return;
    parts.push({ pos: pos.array, d: morph[idx].array, count: pos.count });
  });
  if (parts.length === 0) return out;
  // The GLB's body is split into several primitives (meshopt vertex-fetch), each carrying the
  // same 32-target dictionary over a vertex subset — accumulate bounds and deltas across all.
  let minY = Infinity, maxY = -Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      const y = p.pos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Head slice = top 20% of the bind-pose body height; mid-face = face side, central x,
  // middle 40% of the slice (nose bridge + cheeks + mouth). Derived from bind pose only,
  // so the vertex set is identical across all five states.
  const HEAD = 0.2 * (maxY - minY);
  const headBottom = maxY - HEAD;
  let hminX = Infinity, hmaxX = -Infinity, hminZ = Infinity, hmaxZ = -Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      if (p.pos[i * 3 + 1] < headBottom - 1e-4) continue;
      const x = p.pos[i * 3], z = p.pos[i * 3 + 2];
      if (x < hminX) hminX = x;
      if (x > hmaxX) hmaxX = x;
      if (z < hminZ) hminZ = z;
      if (z > hmaxZ) hmaxZ = z;
    }
  }
  const hcx = (hminX + hmaxX) / 2;
  const hcz = (hminZ + hmaxZ) / 2;
  const xHalf = 0.6 * ((hmaxX - hminX) / 2);
  const yLo = headBottom + 0.30 * HEAD;
  const yHi = headBottom + 0.70 * HEAD;
  let sum = 0, n = 0;
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      const y = p.pos[i * 3 + 1];
      if (y < yLo || y > yHi) continue;
      if (p.pos[i * 3 + 2] <= hcz) continue;
      if (Math.abs(p.pos[i * 3] - hcx) > xHalf) continue;
      const dx = p.d[i * 3], dy = p.d[i * 3 + 1], dz = p.d[i * 3 + 2];
      sum += Math.hypot(dx, dy, dz);
      n += 1;
    }
  }
  out.midFaceVertexCount = n;
  // Applied displacement = live influence × morph delta (the renderer blends base + w*delta);
  // scale the mean delta by the influence read back from the scene graph.
  out.midFaceMeanDeltaMm = n > 0 ? 1000 * (sum / n) * Math.abs(out.influence) : null;
  if (ev) {
    out.packFraming = ev.packFraming;
    out.focusRegion = ev.focusRegion;
  }
  return out;
})()`;

export async function runMouthOpenCapProbe(): Promise<void> {
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
      subjectId: "parent_mouth_open_cap",
      subjectKind: "glb",
      bodyGlb: GLB_URL_PATH,
      focus: "head",
      label: "parent mouth-open cap subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;

    const browser = await chromium.launch({ headless: true });
    const rows: StateMeasure[] = [];
    try {
      for (const state of STATES) {
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
          if (measure.targetIndex === null) throw new Error(`${state.stateId}: mouth-open absent from every skinned mesh`);
          if (measure.appliedMeshes === 0) throw new Error(`${state.stateId}: applier never drove a mesh`);
          if (measure.midFaceMeanDeltaMm === null || measure.midFaceVertexCount < 1000) {
            throw new Error(
              `${state.stateId}: mid-face measure failed (verts=${measure.midFaceVertexCount}, delta=${measure.midFaceMeanDeltaMm})`,
            );
          }
          if (measure.otherMax > 1e-6) {
            throw new Error(`${state.stateId}: other influences not at 0 (max ${measure.otherMax})`);
          }

          if (STILLS[state.stateId]) {
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
              `${state.stateId}: influence=${measure.influence} midFaceDelta=${measure.midFaceMeanDeltaMm.toFixed(4)}mm ` +
                `verts=${measure.midFaceVertexCount} sd=${lum.sd.toFixed(2)} bytes=${stillStat.size}\n`,
            );
          } else {
            process.stdout.write(
              `${state.stateId}: influence=${measure.influence} midFaceDelta=${measure.midFaceMeanDeltaMm.toFixed(4)}mm ` +
                `verts=${measure.midFaceVertexCount}\n`,
            );
          }
          rows.push({ ...measure, stateId: state.stateId });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close();
    }

    // --- Cap actually clamped in the live scene: full request lands at 0.3, sweep-10 stays 1.0. ---
    const byId = new Map(rows.map((r) => [r.stateId, r]));
    const atCap = byId.get("at-cap")!;
    const full = byId.get("full-request")!;
    const sweep10 = byId.get("sweep-10")!;
    const rest = byId.get("rest")!;
    const sweep03 = byId.get("sweep-03")!;
    for (const [id, expected] of [
      ["rest", 0],
      ["at-cap", CAP],
      ["full-request", CAP],
      ["sweep-03", 0.3],
      ["sweep-10", 1.0],
    ] as const) {
      const got = byId.get(id)!.influence;
      if (Math.abs(got - expected) > 1e-6) {
        throw new Error(`${id}: live influence read ${got}, expected ${expected}`);
      }
    }
    if (!(rest.midFaceMeanDeltaMm! < atCap.midFaceMeanDeltaMm!)) {
      throw new Error(`rest delta (${rest.midFaceMeanDeltaMm}) not below at-cap (${atCap.midFaceMeanDeltaMm})`);
    }
    if (!(atCap.midFaceMeanDeltaMm! <= sweep03.midFaceMeanDeltaMm!)) {
      throw new Error(`at-cap (${atCap.midFaceMeanDeltaMm}) above the 0.3 cell (${sweep03.midFaceMeanDeltaMm})`);
    }
    if (!(atCap.midFaceMeanDeltaMm! < sweep10.midFaceMeanDeltaMm!)) {
      throw new Error(`at-cap (${atCap.midFaceMeanDeltaMm}) not strictly below the 1.0 cell (${sweep10.midFaceMeanDeltaMm})`);
    }
    if (Math.abs(full.midFaceMeanDeltaMm! - atCap.midFaceMeanDeltaMm!) > 1e-4) {
      throw new Error(`full-request (${full.midFaceMeanDeltaMm}) differs from at-cap (${atCap.midFaceMeanDeltaMm})`);
    }

    // --- Same derived camera across all five states (bind-pose bounds — verified to 1 mm). ---
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

    const midFaceDeltaMm = {
      rest: Number(rest.midFaceMeanDeltaMm!.toFixed(4)),
      atCap: Number(atCap.midFaceMeanDeltaMm!.toFixed(4)),
      atFullRequest: Number(full.midFaceMeanDeltaMm!.toFixed(4)),
      atSweep03: Number(sweep03.midFaceMeanDeltaMm!.toFixed(4)),
      atSweep10: Number(sweep10.midFaceMeanDeltaMm!.toFixed(4)),
    };

    // Rest must differ from the cap on disk too (the applier bound, not only the ledger).
    const restBytes = await readFile(join(REPO_ROOT, STILLS["rest"]!));
    const capBytes = await readFile(join(REPO_ROOT, STILLS["at-cap"]!));
    if (sha256Hex(restBytes) === sha256Hex(capBytes)) {
      throw new Error("rest and at-cap stills are byte-identical — the morph did not bind");
    }

    const ledger = {
      schemaVersion: "openclinxr.mouth-open-cap.v1",
      issue: "460",
      factoryStep: "dialogue_runtime",
      generatedAt: new Date().toISOString(),
      cap: CAP,
      subject: SUBJECT,
      sourceGlb: GLB_URL_PATH,
      sourceGlbSha256: servedSha256,
      appliedThrough:
        "apps/ui-xr/src/viseme-morph-apply.ts applyVisemeWeights — resolved name 'mouth-open' clamped to 0.3; " +
        "rest / at-cap / full-request driven through it in-page; sweep-03 / sweep-10 drive the morph directly " +
        "at its swept weight (mirrors #459's cells, which had no cap)",
      midFaceDeltaMm,
      midFaceMeasure: {
        derivation:
          "mean Euclidean magnitude of the mouth-open morph delta (geometry.morphAttributes.position[index], " +
          "the exact array the renderer blends) over the mid-face band, scaled by the LIVE applied influence " +
          "(morphTargetInfluences[index]) and expressed in mm. Mid-face band derived from the bind pose only: " +
          "head slice = top 20% of body height; face side z >= head-center-z; central |x - head-center-x| < 0.6 " +
          "half head width; y in [headBottom + 0.30, headBottom + 0.70] of the slice (nose bridge + cheeks + mouth). " +
          "Same vertex set for all five states; measured in-page in the running scene, not from the file.",
        vertexCount: atCap.midFaceVertexCount,
        bandFractionOfBodyHeight: 0.2,
        yBandOfHeadSlice: [0.3, 0.7],
        xBandFractionOfHeadHalfWidth: 0.6,
        faceSide: "z >= head-center-z",
      },
      states: rows.map((r) => ({
        stateId: r.stateId,
        influence: r.influence,
        targetIndex: r.targetIndex,
        appliedMeshes: r.appliedMeshes,
        otherMax: r.otherMax,
        midFaceVertexCount: r.midFaceVertexCount,
        midFaceMeanDeltaMm: Number(r.midFaceMeanDeltaMm!.toFixed(4)),
      })),
      camera: {
        derivation:
          "lab-derived head framing (camera-fit-to-bounds.ts resolveFocus('head') -> frameCamera) from the " +
          "subject's own bind-pose bounds — identical for all five states by construction, verified to 1 mm " +
          "across the loads via packFraming bounds",
        framePx: { width: VIEW_W, height: VIEW_H },
        headBoxMeters: first.focusRegion?.boundsMeters ?? null,
      },
      stills: [
        { stateId: "rest", path: STILLS["rest"]! },
        { stateId: "at-cap", path: STILLS["at-cap"]! },
        { stateId: "full-request", path: STILLS["full-request"]! },
      ],
      claimScope:
        "mouth-open capped at 0.3 in the shipped applier, evidenced by: live influence readbacks (a requested " +
        "1.0 lands at 0.3 in the running scene), geometric mid-face vertex displacement at rest / cap / " +
        "full-request / the #459 sweep's 0.3 and 1.0 cells, and three face-framed stills sharing one derived camera",
      notEvidenceFor: [
        "whether 0.3 reads as speech to a learner (structural intactness is not legibility)",
        "#402's spike (absent from every graded cell; still open)",
        "baking viseme_AA onto the parent (the follow-on that could raise or remove this cap)",
        "other FACS targets at 1.0 (only mouth-open was swept)",
        "the runtime mixer or dialogue timing",
        "clinical validity",
        "scoring validity",
        "quest readiness",
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
  void runMouthOpenCapProbe().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
