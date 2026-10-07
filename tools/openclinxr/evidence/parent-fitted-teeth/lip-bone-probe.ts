/**
 * Lip-bone probe renderer (lip-bones2 slice, SCRATCH evidence -> scratchpad).
 *
 * Renders probe rows (viseme + explicit bone table through the REAL
 * lip-bone-rounding code path bundled in-page) in the isolated-subject
 * mouth-focus front + 3/4 views, saves stills + tooth counts, then
 * pixel-measures every row with the pixel lip instrument calibrated from
 * the probe run's own sil stills. Output goes to the coordinator
 * scratchpad (NOT the repo): probe PNGs + lip-bone-probe.json.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/lip-bone-probe.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import type { Page } from "../lib/slotted-playwright.js";
import {
  calibratePixelLipThresholds,
  measurePhiltrumBand,
  measurePhiltrumSilhouette,
  measurePixelLipForward,
  measurePixelLipFront,
} from "./pixel-lip-measure.ts";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const OUT_DIR = "/private/tmp/claude-501/-Volumes-files-src-openclinxr/bde3aa49-e17c-405c-b469-621484cb7ff2/scratchpad/lb2-probe";

type BoneRow = { viseme: string; bone: string; channel: "x" | "z"; fullMm: number; source: string };
type ProbeRow = { id: string; viseme: string; table: BoneRow[] | null };

const oris04x = (v: "O" | "U", mm: number): BoneRow[] => [
  { viseme: v, bone: "oris04.L", channel: "x", fullMm: mm, source: `headless-ring:${mm}mm` },
  { viseme: v, bone: "oris04.R", channel: "x", fullMm: -mm, source: `headless-ring:${mm}mm` },
];
// Philtrum-lump round: oris05 owns the philtrum/upper-lip skin headlessly
// (dominant verts y303-485) while oris01 owns the lower lip (y536-657), so
// the forward push shifts down: less upper, same-or-more lower.
const orisT1 = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 3, source: "philtrum-round:T1" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 1, source: "philtrum-round:T1" },
];
// Round 3 (complete tables: every row lists ALL driven bones explicitly,
// because the wire hook already applied the default table at drive time and
// the probe call only overrides the bones it lists — omitted bones keep the
// hook's offsets). base0 = morph-only reference (all zeroed).
const zeroAll = (v: "O" | "U"): BoneRow[] => [
  { viseme: v, bone: "oris04.L", channel: "x", fullMm: 0, source: "philtrum-round:base0" },
  { viseme: v, bone: "oris04.R", channel: "x", fullMm: 0, source: "philtrum-round:base0" },
  { viseme: v, bone: "oris01", channel: "z", fullMm: 0, source: "philtrum-round:base0" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 0, source: "philtrum-round:base0" },
];
const orisCur = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 3, source: "philtrum-round:cur" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 3, source: "philtrum-round:cur" },
];
const orisT2f = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 4, source: "philtrum-round:T2f" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 0, source: "philtrum-round:T2f" },
];
const orisT4f = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 4, source: "philtrum-round:T4f" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 1, source: "philtrum-round:T4f" },
];
const orisT5f = (v: "O" | "U"): BoneRow[] => [
  ...orisT4f(v).slice(0, 2),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 4, source: "philtrum-round:T5f" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 0, source: "philtrum-round:T5f" },
  { viseme: v, bone: "oris03.L", channel: "z", fullMm: 2, source: "philtrum-round:T5f" },
  { viseme: v, bone: "oris03.R", channel: "z", fullMm: 2, source: "philtrum-round:T5f" },
];
const orisT6f = (v: "O" | "U"): BoneRow[] => [
  ...orisT4f(v).slice(0, 2),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 4, source: "philtrum-round:T6f" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 0, source: "philtrum-round:T6f" },
  { viseme: v, bone: "oris04.L", channel: "z", fullMm: 2, source: "philtrum-round:T6f" },
  { viseme: v, bone: "oris04.R", channel: "z", fullMm: 2, source: "philtrum-round:T6f" },
];
const orisT7 = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 3, source: "philtrum-round:T7" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 2, source: "philtrum-round:T7" },
];
const orisT8 = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 4, source: "philtrum-round:T8" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 2, source: "philtrum-round:T8" },
];

const orisT9 = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 3, source: "philtrum-round:T9" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 2.5, source: "philtrum-round:T9" },
];
const orisT10 = (v: "O" | "U"): BoneRow[] => [
  ...oris04x(v, 6),
  { viseme: v, bone: "oris01", channel: "z", fullMm: 6, source: "philtrum-round:T10" },
  { viseme: v, bone: "oris05", channel: "z", fullMm: 2, source: "philtrum-round:T10" },
];

const ROWS: ProbeRow[] = [
  { id: "base-sil", viseme: "sil", table: null },
  { id: "base-E", viseme: "E", table: null },
  { id: "base-O", viseme: "O", table: null },
  { id: "base-U", viseme: "U", table: null },
  { id: "T9-O", viseme: "O", table: orisT9("O") },
  { id: "T9-U", viseme: "U", table: orisT9("U") },
  { id: "T10-O", viseme: "O", table: orisT10("O") },
  { id: "T10-U", viseme: "U", table: orisT10("U") },
];

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function bundle(source: string, globalName: string): string {
  const output = path.join(tmpdir(), `lbprobe-${globalName}-${process.pid}.js`);
  execFileSync(esbuildBin(), [source, "--bundle", "--format=iife", `--global-name=${globalName}`, "--platform=browser",
    `--alias:@openclinxr/asset-registry=${path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts")}`,
    `--outfile=${output}`,
  ], { stdio: "inherit" });
  const result = readFileSync(output, "utf8");
  rmSync(output, { force: true });
  return result;
}

// Pose + tooth-count page JS: same drive call and central-ROI counting as
// the shipped isolated-viseme-stills tool (LANDMARK_JS condensed).
const PAGE_JS = `
function findBodyMesh(root) {
  let found = null;
  root.traverse((o) => {
    if (found || !o || !o.isSkinnedMesh) return;
    const n = String(o.name || "");
    if (/_body$/i.test(n)) found = o;
  });
  if (!found) throw new Error("body mesh missing");
  return found;
}
function orisDominant(body) {
  const skel = body.skeleton;
  const si = body.geometry.getAttribute("skinIndex");
  const sw = body.geometry.getAttribute("skinWeight");
  const bones = skel.bones;
  const out = [];
  for (let i = 0; i < body.geometry.getAttribute("position").count; i += 1) {
    let joint = si.getX(i), best = sw.getX(i);
    if (sw.getY(i) > best) { best = sw.getY(i); joint = si.getY(i); }
    if (sw.getZ(i) > best) { best = sw.getZ(i); joint = si.getZ(i); }
    if (sw.getW(i) > best) { best = sw.getW(i); joint = si.getW(i); }
    if (/^oris/i.test(bones[joint] ? bones[joint].name : "")) out.push(i);
  }
  if (!out.length) throw new Error("no oris-dominant verts");
  return out;
}
function posedWorld(body, index) {
  const pos = body.geometry.getAttribute("position");
  const morph = body.geometry.morphAttributes.position || [];
  const inf = body.morphTargetInfluences || [];
  const dict = body.morphTargetDictionary || {};
  const v = new THREE.Vector3().fromBufferAttribute(pos, index);
  for (const key of Object.keys(dict)) {
    const w = inf[dict[key]] || 0;
    if (!w) continue;
    const delta = morph[dict[key]];
    if (!delta) continue;
    v.x += w * delta.getX(index); v.y += w * delta.getY(index); v.z += w * delta.getZ(index);
  }
  body.skeleton.update();
  const bm = body.skeleton.boneMatrices;
  const si = body.geometry.getAttribute("skinIndex");
  const sw = body.geometry.getAttribute("skinWeight");
  const out = new THREE.Vector3(0, 0, 0);
  const tmp = new THREE.Vector3();
  const slots = [[si.getX(index), sw.getX(index)], [si.getY(index), sw.getY(index)], [si.getZ(index), sw.getZ(index)], [si.getW(index), sw.getW(index)]];
  for (const [j, w] of slots) {
    if (!w) continue;
    tmp.set(v.x, v.y, v.z).applyMatrix4(new THREE.Matrix4().fromArray(bm, j * 16));
    out.x += w * tmp.x; out.y += w * tmp.y; out.z += w * tmp.z;
  }
  return out;
}
function projectEvidenceCamera(world) {
  const ev = window.__openClinXrIsolatedSubjectEvidence;
  const cam = ev && ev.packFraming && ev.packFraming.packCamera;
  if (!cam) throw new Error("pack camera evidence missing");
  const canvas = window.document.getElementById("isolated-subject-capture-canvas");
  const W = canvas.width, H = canvas.height;
  const camera = new THREE.PerspectiveCamera(cam.fov, W / H, 0.01, 100);
  camera.position.set(cam.position.x, cam.position.y, cam.position.z);
  camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
  const v = new THREE.Vector3(world.x, world.y, world.z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H, W, H };
}
window.__probePose = (viseme, table) => {
  const root = window.__openClinXrIsolatedSceneRoot;
  const drive = globalThis.OpenClinXrVisemeDrive;
  drive.applyDialogueVisemeTimelineToRoot(root, { phonemeSequence: ["sil"], progress: 0.5,
    bakedCues: [{ phoneme: viseme, atSecond: 0, durationSeconds: 1, intensity: 1 }] });
  const tag = root.userData.openClinXrNamedVisemeDrive;
  let bonesTouched = 0;
  if (table) {
    bonesTouched = globalThis.OpenClinXrLipRounding.applyLipBoneRoundingToRoot(root, { ...(tag.weights || {}) }, table);
  }
  let teethWeight = null, teethTarget = null;
  root.traverse((o) => {
    if (teethWeight !== null || !o || !o.isSkinnedMesh) return;
    if (!/fitted_teeth/i.test(String(o.name || ""))) return;
    const dict = o.morphTargetDictionary || {};
    const inf = o.morphTargetInfluences || [];
    let best = null;
    for (const key of Object.keys(dict)) {
      const w = inf[dict[key]] || 0;
      if (best === null || w > best.w) best = { target: key, w };
    }
    teethWeight = best ? best.w : 0; teethTarget = best ? best.target : "";
  });
  return { weights: { ...(tag.weights || {}) }, jawOpenRadians: tag.jawOpenRadians, bonesTouched, teethWeight, teethTarget };
};
window.__probeMeasure = () => {
  const root = window.__openClinXrIsolatedSceneRoot;
  const body = findBodyMesh(root);
  const oris = orisDominant(body);
  let minX = null, maxX = null;
  for (const i of oris) {
    const p = posedWorld(body, i);
    if (!minX || p.x < minX.p.x) minX = { i, p };
    if (!maxX || p.x > maxX.p.x) maxX = { i, p };
  }
  const half = Math.max(Math.abs(minX.p.x), Math.abs(maxX.p.x));
  let upMid = null, loMid = null;
  for (const i of oris) {
    const p = posedWorld(body, i);
    if (Math.abs(p.x) > 0.1 * half) continue;
    if (!upMid || p.y > upMid.p.y) upMid = { i, p };
    if (!loMid || p.y < loMid.p.y) loMid = { i, p };
  }
  const L = projectEvidenceCamera({ x: minX.p.x, y: minX.p.y, z: minX.p.z });
  const R = projectEvidenceCamera({ x: maxX.p.x, y: maxX.p.y, z: maxX.p.z });
  const U = projectEvidenceCamera({ x: upMid.p.x, y: upMid.p.y, z: upMid.p.z });
  const D = projectEvidenceCamera({ x: loMid.p.x, y: loMid.p.y, z: loMid.p.z });
  const widthPx = Math.abs(R.x - L.x);
  const aperturePx = Math.abs(D.y - U.y);
  const span = R.x - L.x;
  const central = { x0: L.x + 0.15 * span, x1: R.x - 0.15 * span,
    y0: Math.min(U.y, D.y) - Math.max(8, 0.3 * aperturePx), y1: Math.max(U.y, D.y) + Math.max(8, 0.3 * aperturePx) };
  const W = L.W, H = L.H;
  const gl = window.document.getElementById("isolated-subject-capture-canvas").getContext("webgl2")
    || window.document.getElementById("isolated-subject-capture-canvas").getContext("webgl");
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const splitLib = globalThis.OpenClinXrToothSplit;
  const toBox = (b) => ({ x0: Math.max(0, Math.round(b.x0)), x1: Math.min(W - 1, Math.round(b.x1)),
    y0: Math.max(0, Math.round(H - 1 - b.y1)), y1: Math.min(H - 1, Math.round(H - 1 - b.y0)) });
  const centralCounts = splitLib.analyzeToothPixels(buf, W, H, toBox(central), true);
  return { landWidthPx: widthPx, landAperturePx: aperturePx,
    central: { upperTeethN: centralCounts.upperTeethN, lowerTeethN: centralCounts.lowerTeethN,
      mouthTeethN: centralCounts.mouthTeethN, lipGapPx: centralCounts.lipGapPx },
    png: window.document.getElementById("isolated-subject-capture-canvas").toDataURL("image/png") };
};
`;

function decodeTopDown(pngPath: string): { rgb: Uint8Array; w: number; h: number } {
  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", pngPath],
    { encoding: "utf8" },
  );
  const [W, H] = probe.trim().split(",").map(Number);
  if (!W || !H) throw new Error(`bad-png-dims:${pngPath}`);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  }) as Buffer;
  return { rgb: new Uint8Array(raw.buffer, raw.byteOffset, W * H * 3), w: W, h: H };
}

async function main(): Promise<void> {
  mkdirSync(path.join(OUT_DIR, "front"), { recursive: true });
  mkdirSync(path.join(OUT_DIR, "34"), { recursive: true });
  const wire = bundle(path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts"), "OpenClinXrVisemeDrive");
  const rounding = bundle(path.join(REPO, "packages/openclinxr/xr-dialogue/src/lip-bone-rounding.ts"), "OpenClinXrLipRounding");
  const split = bundle(path.join(HERE, "tooth-pixel-split.ts"), "OpenClinXrToothSplit");
  const three = bundle(path.join(HERE, "three-shim.js"), "THREE");
  const rows: Record<string, Record<string, unknown>> = {};
  let server: PortlessDevServer | undefined;
  await createLocalComputeServices().sceneCapture.withBrowser("lip-bone-probe", async (launched) => {
    try {
      server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180000, cwd: REPO });
      const browser = launched as HeadlessBrowser;
      for (const view of [
        { id: "front", spec: { focus: "mouth", view: "front" } },
        { id: "34", spec: { focus: "mouth", view: "three_quarter_left" } },
      ]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
        page.setDefaultTimeout(180000);
        const spec = { subjectId: "mpfb-peds-parent-aisha", subjectKind: "glb", bodyGlb: "/generated-humanoids/mpfb-peds-parent-aisha.glb", label: `lip probe ${view.id}`, ...view.spec };
        await page.goto(`${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null", null, { timeout: 180000 });
        const error = await page.evaluate("window.__openClinXrVisemeApplierError || ''");
        if (error) throw new Error(String(error));
        await page.addScriptTag({ content: wire });
        await page.addScriptTag({ content: rounding });
        await page.addScriptTag({ content: split });
        await page.addScriptTag({ content: three });
        await page.addScriptTag({ content: PAGE_JS });
        for (const row of ROWS) {
          const out = await page.evaluate((args: { viseme: string; table: BoneRow[] | null }) => {
            const g = globalThis as unknown as {
              __probePose: (v: string, t: BoneRow[] | null) => { weights: Record<string, number>; jawOpenRadians: number; bonesTouched: number; teethWeight: number; teethTarget: string };
              __probeMeasure: () => { landWidthPx: number; landAperturePx: number; central: { upperTeethN: number; lowerTeethN: number; mouthTeethN: number; lipGapPx: number }; png: string };
              __openClinXrIsolatedRenderFrame?: () => void;
              requestAnimationFrame(cb: () => void): number;
            };
            const posed = g.__probePose(args.viseme, args.table);
            g.__openClinXrIsolatedRenderFrame?.();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("requestAnimationFrame stalled")), 2000);
              g.requestAnimationFrame(() => {
                clearTimeout(timer);
                try {
                  resolve({ posed, measured: g.__probeMeasure() });
                } catch (e) { reject(e); }
              });
            });
          }, { viseme: row.viseme, table: row.table });
          const typed = out as { posed: { weights: Record<string, number>; jawOpenRadians: number; bonesTouched: number; teethWeight: number; teethTarget: string }; measured: { landWidthPx: number; landAperturePx: number; central: { upperTeethN: number; lowerTeethN: number; mouthTeethN: number; lipGapPx: number }; png: string } };
          const shot: string = typed.measured.png;
          const file = path.join(OUT_DIR, view.id, `${row.id}.png`);
          writeFileSync(file, Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
          const key = `${view.id}/${row.id}`;
          rows[key] = {
            viseme: row.viseme,
            table: row.table,
            bonesTouched: typed.posed.bonesTouched,
            jawRad: typed.posed.jawOpenRadians,
            landWidthPx: Math.round(typed.measured.landWidthPx * 10) / 10,
            upperPx: typed.measured.central.upperTeethN,
            lowerPx: typed.measured.central.lowerTeethN,
            lipGapPx: typed.measured.central.lipGapPx,
          };
          process.stdout.write(`probe ${key}: bones=${typed.posed.bonesTouched} landW=${typed.measured.landWidthPx.toFixed(1)} upper=${typed.measured.central.upperTeethN} lower=${typed.measured.central.lowerTeethN}\n`);
        }
        await page.close();
      }
    } finally {
      if (server) await stopPortlessDevServer(server.proc);
    }
  });
  // Pixel-measure every row with thresholds from the probe run's own sil.
  const restFront = decodeTopDown(path.join(OUT_DIR, "front/base-sil.png"));
  const rest34 = decodeTopDown(path.join(OUT_DIR, "34/base-sil.png"));
  const t = calibratePixelLipThresholds(restFront, rest34);
  for (const row of ROWS) {
    const f = rows[`front/${row.id}`] as Record<string, unknown>;
    const c = rows[`34/${row.id}`] as Record<string, unknown>;
    const frontImg = decodeTopDown(path.join(OUT_DIR, `front/${row.id}.png`));
    const view34Img = decodeTopDown(path.join(OUT_DIR, `34/${row.id}.png`));
    const fm = measurePixelLipFront(frontImg, t);
    const cm = measurePixelLipForward(view34Img, t);
    f["pixelOuterPx"] = fm.outerWidthPx;
    f["pixelApWPx"] = fm.apertureWidthPx;
    f["pixelApHPx"] = fm.apertureHeightPx;
    f["pixelHw"] = fm.hwRatio;
    f["pixelPhilBand"] = measurePhiltrumBand(frontImg);
    c["pixelLipX"] = cm.lipX;
    c["pixelLipY"] = cm.lipY;
    c["pixelAnchorX"] = cm.anchorX;
    c["pixelFwdPx"] = cm.forwardPx;
    c["pixelPhilX"] = measurePhiltrumSilhouette(view34Img, t);
  }
  const eFront = rows["front/base-E"] as { pixelOuterPx: number };
  const eFwd = rows["34/base-E"] as { pixelFwdPx: number };
  const baseOf = (viseme: string): string => `base-${viseme}`;
  const table = ROWS.map((row) => {
    const f = rows[`front/${row.id}`] as { pixelOuterPx: number; pixelApWPx: number; pixelHw: number; pixelPhilBand: number; upperPx: number; lowerPx: number; landWidthPx: number; bonesTouched: number };
    const c = rows[`34/${row.id}`] as { pixelFwdPx: number; pixelPhilX: number; pixelLipX: number; pixelLipY: number };
    const bf = rows[`front/${baseOf(row.viseme)}`] as { pixelOuterPx: number; pixelPhilBand: number };
    const bc = rows[`34/${baseOf(row.viseme)}`] as { pixelFwdPx: number; pixelPhilX: number; pixelLipX: number };
    const bones = row.table ? [...new Set(row.table.map((r) => `${r.bone}:${r.channel}:${r.fullMm}`))].join("+") : "(none)";
    return {
      id: row.id,
      bones,
      widthPx: f.pixelOuterPx,
      widthPctVsE: Math.round(((f.pixelOuterPx - eFront.pixelOuterPx) / eFront.pixelOuterPx) * 1000) / 10,
      widthDeltaVsBasePx: Math.round((f.pixelOuterPx - bf.pixelOuterPx) * 10) / 10,
      hwRatio: f.pixelHw,
      forwardPxVsE: c.pixelFwdPx - eFwd.pixelFwdPx,
      fwdDeltaVsBasePx: c.pixelFwdPx - bc.pixelFwdPx,
      lipXDeltaVsBasePx: c.pixelLipX - bc.pixelLipX,
      philBand: f.pixelPhilBand,
      philBandDeltaVsBase: Math.round((f.pixelPhilBand - bf.pixelPhilBand) * 10) / 10,
      philX: c.pixelPhilX,
      philXDeltaVsBasePx: Math.round((c.pixelPhilX - bc.pixelPhilX) * 10) / 10,
      lipY: c.pixelLipY,
      upperPx: f.upperPx,
      lowerPx: f.lowerPx,
      landWidthPx: f.landWidthPx,
      bonesTouched: f.bonesTouched,
    };
  });
  writeFileSync(path.join(OUT_DIR, "lip-bone-probe.json"), `${JSON.stringify({ thresholds: { darkT: t.darkT, redT: t.redT, gumT: t.gumT, bgT34: t.bgT34 }, rows, table }, null, 2)}\n`);
  process.stdout.write("wrote lip-bone-probe.json\n");
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
