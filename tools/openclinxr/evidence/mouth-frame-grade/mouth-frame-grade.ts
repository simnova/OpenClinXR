/** Mouth-frame grade: AA phoneme jaw still, PP still, teeth-centroid motion. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../lib/slotted-playwright.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");

const SOURCE_GLB_URL_PATH =
  "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
const SOURCE_GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", SOURCE_GLB_URL_PATH);

const JAW_OPEN_TEETH_CLEAR_RADIANS = 0.15086;
const OUT_DIR = join(REPO_ROOT, "tools/openclinxr/evidence/mouth-frame-grade");

const sha256Hex = (d: Buffer | Uint8Array): string =>
  createHash("sha256").update(d).digest("hex");

/** Pinned every 5ms until the screenshot: jaw rotation + capped viseme_AA/mouth-open morph. */
function aaApplierEvaluate(): string {
  return `(() => {
    const D = ${JSON.stringify(JAW_OPEN_TEETH_CLEAR_RADIANS)};
    let restX = null;
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      root.traverse(function (o) {
        if (o.isBone && /^jaw$/i.test(o.name || "")) {
          if (restX === null) restX = o.rotation.x;
          o.rotation.x = restX + D;
        }
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const jawFrac = 1.0;
        for (const n of ["viseme_AA", "mouth-open"]) {
          const idx = o.morphTargetDictionary[n];
          if (idx !== undefined) o.morphTargetInfluences[idx] = Math.min(jawFrac, 1);
        }
      });
    };
    const timer = window.setInterval(step, 5);
    window.__openClinXrMouthGradeStop = function () { window.clearInterval(timer); };
    step();
    return { ok: true };
  })()`;
}

/** Pinned: jaw at rest, mouth-compression=1, other visemes + mouth-open at 0. */
function ppApplierEvaluate(): string {
  return `(() => {
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const dict = o.morphTargetDictionary;
        for (const n of Object.keys(dict)) {
          if (n === "mouth-compression") o.morphTargetInfluences[dict[n]] = 1;
          else if (n === "viseme_sil") continue;
          else if (/^viseme_/i.test(n) || n === "mouth-open") o.morphTargetInfluences[dict[n]] = 0;
        }
      });
    };
    const timer = window.setInterval(step, 5);
    window.__openClinXrMouthGradeStop = function () { window.clearInterval(timer); };
    step();
    return { ok: true };
  })()`;
}

const MEASURE = `(() => {
  const D = ${JSON.stringify(JAW_OPEN_TEETH_CLEAR_RADIANS)};
  const root = window.__openClinXrIsolatedSceneRoot;
  let teeth = null;
  root.traverse(function (o) {
    if (o.isSkinnedMesh && /teeth/i.test(o.name || "")) teeth = o;
  });
  if (!teeth) return { error: "no teeth mesh found" };
  let jaw = null;
  root.traverse(function (o) { if (o.isBone && /^jaw$/i.test(o.name || "")) jaw = o; });
  if (!jaw) return { error: "no jaw bone found" };
  const restX = jaw.rotation.x;
  const skel = teeth.skeleton;
  const jointNames = skel.bones.map(function (b) { return b.name; });
  const pos = teeth.geometry.attributes.position;
  const si = teeth.geometry.attributes.skinIndex;
  const sw = teeth.geometry.attributes.skinWeight;
  const counts = {};
  const strongest = new Uint8Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    let bi = si.getX(v), bw = sw.getX(v);
    if (sw.getY(v) > bw) { bi = si.getY(v); bw = sw.getY(v); }
    if (sw.getZ(v) > bw) { bi = si.getZ(v); bw = sw.getZ(v); }
    if (sw.getW(v) > bw) { bi = si.getW(v); }
    strongest[v] = bi;
    const jn = skel.bones[bi] ? skel.bones[bi].name : "unknown";
    counts[jn] = (counts[jn] || 0) + 1;
  }
  const THREE_V = teeth.material;
  function centroids() {
    root.updateMatrixWorld(true);
    skel.update();
    const bm = skel.boneMatrices;
    const out = { full: [0,0,0], n: 0, ys: [] };
    const tmp = new Float32Array(3);
    const per = [];
    for (let v = 0; v < pos.count; v++) {
      let x = 0, y = 0, z = 0;
      const idx = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)];
      const wts = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)];
      for (let k = 0; k < 4; k++) {
        const m = bm.subarray(idx[k] * 16, idx[k] * 16 + 16);
        const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
        x += wts[k] * (m[0]*px + m[4]*py + m[8]*pz + m[12]);
        y += wts[k] * (m[1]*px + m[5]*py + m[9]*pz + m[13]);
        z += wts[k] * (m[2]*px + m[6]*py + m[10]*pz + m[14]);
      }
      // to world
      const e = teeth.matrixWorld.elements;
      const wx = e[0]*x + e[4]*y + e[8]*z + e[12];
      const wy = e[1]*x + e[5]*y + e[9]*z + e[13];
      const wz = e[2]*x + e[6]*y + e[10]*z + e[14];
      per.push([wx, wy, wz]);
      out.full[0] += wx; out.full[1] += wy; out.full[2] += wz;
      out.ys.push(wy);
    }
    out.n = pos.count;
    out.full = out.full.map(function (s) { return s / out.n; });
    const sorted = out.ys.slice().sort(function (a,b) { return a-b; });
    const med = sorted[Math.floor(sorted.length / 2)];
    const up = [0,0,0]; let un = 0;
    const lo = [0,0,0]; let ln = 0;
    for (const p of per) {
      if (p[1] > med) { up[0]+=p[0]; up[1]+=p[1]; up[2]+=p[2]; un++; }
      else if (p[1] < med) { lo[0]+=p[0]; lo[1]+=p[1]; lo[2]+=p[2]; ln++; }
    }
    out.upper = un ? up.map(function (s) { return s / un; }) : [0,0,0];
    out.upperCount = un;
    out.lower = ln ? lo.map(function (s) { return s / ln; }) : [0,0,0];
    out.lowerCount = ln;
    return out;
  }
  const atRest = centroids();
  jaw.rotation.x = restX + D;
  const atAA = centroids();
  jaw.rotation.x = restX;
  function dist(a, b) {
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }
  return {
    teethMeshName: teeth.name,
    jointNames: jointNames,
    strongestCounts: counts,
    vertexCount: pos.count,
    restJawX: restX,
    fullDeltaM: dist(atRest.full, atAA.full),
    upperDeltaM: dist(atRest.upper, atAA.upper),
    upperCount: atAA.upperCount,
    lowerDeltaM: dist(atRest.lower, atAA.lower),
    lowerCount: atAA.lowerCount,
  };
})()`;

export async function runMouthFrameGrade(): Promise<void> {
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });
    const served = await fetch(new URL(SOURCE_GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedSha = sha256Hex(new Uint8Array(await served.arrayBuffer()));
    const diskSha = sha256Hex(await readFile(SOURCE_GLB_DISK_PATH));
    if (servedSha !== diskSha) throw new Error("served GLB differs from tracked file");
    process.stdout.write(`sourceGlbSha256=${servedSha} (served == tracked)\n`);

    const spec = {
      subjectId: "parent_tara_johnson_v1",
      subjectKind: "glb",
      bodyGlb: SOURCE_GLB_URL_PATH,
      focus: "head",
      label: "mouth frame grade subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;
    await mkdir(OUT_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    let measure: Record<string, unknown> | undefined;
    try {
      for (const frame of [
        { id: "aa", applier: aaApplierEvaluate() },
        { id: "pp", applier: ppApplierEvaluate() },
      ] as const) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
        try {
          page.on("pageerror", (e) => process.stdout.write(`${frame.id} pageerror: ${String(e).slice(0, 400)}\n`));
          page.on("response", (r) => { if (r.status() >= 400) process.stdout.write(`${frame.id} ${r.status()} ${r.url()}\n`); });
          page.on("console", (msg) => { if (msg.type() === "error") process.stdout.write(`${frame.id} console: ${msg.text().slice(0, 400)}\n`); });
          await page.goto(labUrl, { waitUntil: "domcontentloaded", timeout: 240_000 });
          process.stdout.write(`${frame.id}: loaded\n`);
          await page.evaluate(frame.applier);
          for (let i = 0; i < 120; i++) {
            const ready = await page.evaluate(
              `(() => { const r = window.__openClinXrIsolatedSceneRoot; if (!r) return "noroot";
                let s = false; r.traverse(function (o) {
                  if (o.isSkinnedMesh && o.geometry && o.geometry.attributes.skinIndex) s = true; });
                if (!s) return "noskinned";
                return window.__openClinXrIsolatedSubjectEvidence != null ? "ready" : "noev"; })()`,
            );
            if (ready === "ready") break;
            if (i % 20 === 0) process.stdout.write(`${frame.id}: wait ${i} state=${ready}\n`);
            if (i === 119) throw new Error(`${frame.id}: lab never ready (last=${ready})`);
            await page.waitForTimeout(2000);
          }
          process.stdout.write(`${frame.id}: ready\n`);
          if (frame.id === "aa") {
            measure = (await page.evaluate(MEASURE)) as Record<string, unknown>;
            if ((measure as { error?: string }).error) {
              throw new Error(`teeth measure failed: ${(measure as { error: string }).error}`);
            }
          }
          await page.evaluate(
            `() => { if (window.__openClinXrMouthGradeStop) window.__openClinXrMouthGradeStop(); }`,
          );
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(OUT_DIR, `${frame.id}.png`), type: "png" });
          process.stdout.write(`wrote ${frame.id}.png\n`);
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close();
    }
    const m = measure as unknown as {
      teethMeshName: string;
      jointNames: string[];
      strongestCounts: Record<string, number>;
      vertexCount: number;
      restJawX: number;
      fullDeltaM: number;
      upperDeltaM: number;
      upperCount: number;
      lowerDeltaM: number;
      lowerCount: number;
    };
    const doc = {
      schemaVersion: "openclinxr.mouth-frame-grade.v1",
      generatedAt: new Date().toISOString(),
      glb: SOURCE_GLB_URL_PATH,
      glbSha256: servedSha,
      aaJawRadians: JAW_OPEN_TEETH_CLEAR_RADIANS,
      teethMeshName: m.teethMeshName,
      teethVertexCount: m.vertexCount,
      strongestSkinJointCounts: m.strongestCounts,
      teethCentroidDeltaM: Number(m.fullDeltaM.toFixed(6)),
      upperHalfCentroidDeltaM: Number(m.upperDeltaM.toFixed(6)),
      upperHalfVertexCount: m.upperCount,
      lowerHalfCentroidDeltaM: Number(m.lowerDeltaM.toFixed(6)),
      lowerHalfVertexCount: m.lowerCount,
      claimScope: "teeth_follow_phoneme_jaw",
      notEvidenceFor: ["clinical", "Quest", "pixel grade"],
    };
    await writeFile(join(OUT_DIR, "teeth-motion.json"), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    process.stdout.write(
      `teeth=${m.teethMeshName} fullDelta=${m.fullDeltaM.toFixed(6)}m upperDelta=${m.upperDeltaM.toFixed(6)}m lowerDelta=${m.lowerDeltaM.toFixed(6)}m joints=${JSON.stringify(m.strongestCounts)}\n`,
    );
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
  void runMouthFrameGrade().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
