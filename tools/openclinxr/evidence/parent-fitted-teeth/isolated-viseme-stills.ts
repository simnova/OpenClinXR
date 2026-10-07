/**
 * Isolated viseme stills + landmark-derived mouth corners (viseme-eval slice).
 *
 * Renders each of the 15 OVR visemes at weight 1.0 ALONE through the runtime's
 * own applier (applyDialogueVisemeTimelineToRoot with a single baked cue, so
 * lip weights, teeth gain, and jaw are exactly what the runtime applies),
 * in the mouth-front view and a three-quarter view, and measures per still:
 * jaw radians, teeth px in a landmark-derived central ROI, lip aperture and
 * corner-to-corner width from projected oris-joint landmarks.
 *
 * Corner landmarks: body verts whose DOMINANT skinning joint is an
 * orbicularis-oris bone (lip tissue by rig, same rule as the mouth-focus
 * derivation); commissures = extreme-x pair, mid-lip = extreme-y pair near
 * the midline. Projection uses the page's own pack camera (fov/position/
 * target from the isolated-subject evidence) on the square capture canvas.
 * No runtime tuning: this tool only poses and measures.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/isolated-viseme-stills.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath as fileUrlToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import type { Page } from "../lib/slotted-playwright.js";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };

const HERE = path.dirname(fileUrlToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const OUT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");

export const ISOLATED_VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"] as const;

type ViewSpec = { id: string; spec: Record<string, unknown>; stills: boolean };

const VIEW_SPECS: ViewSpec[] = [
  { id: "front", spec: { focus: "mouth", view: "front" }, stills: true },
  { id: "34", spec: { focus: "mouth", view: "three_quarter_left" }, stills: true },
  { id: "default", spec: { focus: "head" }, stills: false },
];

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function bundle(source: string, globalName: string, extra: readonly string[] = []): string {
  const output = path.join(tmpdir(), `isolated-stills-${globalName}-${process.pid}.js`);
  execFileSync(esbuildBin(), [source, "--bundle", "--format=iife", `--global-name=${globalName}`, "--platform=browser",
    `--alias:@openclinxr/asset-registry=${path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts")}`,
    `--outfile=${output}`, ...extra,
  ], { stdio: "inherit" });
  const result = readFileSync(output, "utf8");
  rmSync(output, { force: true });
  return result;
}

const LANDMARK_JS = `
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
function landmarkSet() {
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
  return { minX, maxX, upMid, loMid };
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
  const box = ev.focusRegion && ev.focusRegion.boundsMeters;
  const center = box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 } : null;
  let residual = null;
  if (center) {
    const c = new THREE.Vector3(center.x, center.y, center.z).project(camera);
    residual = Math.hypot((c.x * 0.5 + 0.5) * W - W / 2, (1 - (c.y * 0.5 + 0.5)) * H - H / 2);
  }
  return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H, W, H, residual };
}
window.__stillPose = (viseme) => {
  const root = window.__openClinXrIsolatedSceneRoot;
  const drive = globalThis.OpenClinXrVisemeDrive;
  drive.applyDialogueVisemeTimelineToRoot(root, { phonemeSequence: ["sil"], progress: 0.5,
    bakedCues: [{ phoneme: viseme, atSecond: 0, durationSeconds: 1, intensity: 1 }] });
  const tag = root.userData.openClinXrNamedVisemeDrive;
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
  return { weights: { ...(tag.weights || {}) }, jawOpenRadians: tag.jawOpenRadians, jawFraction: tag.jawFraction,
    activeTargetName: tag.activeTargetName, teethWeight, teethTarget };
};
window.__stillMeasure = () => {
  const lm = landmarkSet();
  const L = projectEvidenceCamera({ x: lm.minX.p.x, y: lm.minX.p.y, z: lm.minX.p.z });
  const R = projectEvidenceCamera({ x: lm.maxX.p.x, y: lm.maxX.p.y, z: lm.maxX.p.z });
  const U = projectEvidenceCamera({ x: lm.upMid.p.x, y: lm.upMid.p.y, z: lm.upMid.p.z });
  const D = projectEvidenceCamera({ x: lm.loMid.p.x, y: lm.loMid.p.y, z: lm.loMid.p.z });
  const W = L.W, H = L.H;
  const widthPx = Math.abs(R.x - L.x);
  const aperturePx = Math.abs(D.y - U.y);
  const span = R.x - L.x;
  const central = { x0: L.x + 0.15 * span, x1: R.x - 0.15 * span,
    y0: Math.min(U.y, D.y) - Math.max(8, 0.3 * aperturePx), y1: Math.max(U.y, D.y) + Math.max(8, 0.3 * aperturePx) };
  const gl = window.document.getElementById("isolated-subject-capture-canvas").getContext("webgl2")
    || window.document.getElementById("isolated-subject-capture-canvas").getContext("webgl");
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const splitLib = globalThis.OpenClinXrToothSplit;
  const toBox = (b) => ({ x0: Math.max(0, Math.round(b.x0)), x1: Math.min(W - 1, Math.round(b.x1)),
    y0: Math.max(0, Math.round(H - 1 - b.y1)), y1: Math.min(H - 1, Math.round(H - 1 - b.y0)) });
  const centralCounts = splitLib.analyzeToothPixels(buf, W, H, toBox(central), true);
  const legacyCounts = splitLib.analyzeToothPixels(buf, W, H,
    { x0: 520, x1: 520 + 240, y0: 454, y1: 454 + 180 }, false);
  return { corners: { lx: L.x, rx: R.x }, widthPx, aperturePx, residual: L.residual, W, H,
    centralBox: { x0: central.x0, x1: central.x1, y0: central.y0, y1: central.y1 },
    central: { upperTeethN: centralCounts.upperTeethN, lowerTeethN: centralCounts.lowerTeethN,
      mouthTeethN: centralCounts.mouthTeethN, lipGapPx: centralCounts.lipGapPx },
    legacyWindow: { mouthTeethN: legacyCounts.mouthTeethN, lipGapPx: legacyCounts.lipGapPx, n: legacyCounts.n },
    png: window.document.getElementById("isolated-subject-capture-canvas").toDataURL("image/png") };
};
`;

type StillRow = {
  viseme: string; target: string; weight: number; jawRad: number; jawFraction: number;
  teethTarget: string; teethWeight: number; corners: { lx: number; rx: number };
  widthPx: number; aperturePx: number; cameraResidualPx: number;
  centralBox: { x0: number; x1: number; y0: number; y1: number };
  upperPx: number; lowerPx: number; mouthPx: number; lipGapPx: number;
  legacyMouthPx: number; legacyLipGapPx: number;
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const wire = bundle(path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts"), "OpenClinXrVisemeDrive");
  const split = bundle(path.join(HERE, "tooth-pixel-split.ts"), "OpenClinXrToothSplit");
  const three = bundle(path.join(HERE, "three-shim.js"), "THREE");
  const report: Record<string, { canvas: { w: number; h: number }; cameraResidualPx: number; stills: StillRow[] }> = {};
  const corners: Record<string, unknown> = {};
  let server: PortlessDevServer | undefined;
  await createLocalComputeServices().sceneCapture.withBrowser("isolated-viseme-stills", async (launched) => {
    try {
      server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180000, cwd: REPO });
      const browser = launched as HeadlessBrowser;
      for (const view of VIEW_SPECS) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
        page.setDefaultTimeout(180000);
        const spec = { subjectId: "mpfb-peds-parent-aisha", subjectKind: "glb", bodyGlb: "/generated-humanoids/mpfb-peds-parent-aisha.glb", label: `isolated visemes ${view.id}`, ...view.spec };
        await page.goto(`${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null", null, { timeout: 180000 });
        const error = await page.evaluate("window.__openClinXrVisemeApplierError || ''");
        if (error) throw new Error(String(error));
        await page.addScriptTag({ content: wire });
        await page.addScriptTag({ content: split });
        await page.addScriptTag({ content: three });
        await page.addScriptTag({ content: LANDMARK_JS });
        if (!view.stills) {
          // Head-focus probe carries no pack camera on some builds; record
          // null instead of failing the whole run (front/34 stills + raw
          // report must survive a missing head-focus frame).
          try {
            const probe = await page.evaluate(() => {
              const g = globalThis as unknown as { __stillMeasure: () => { corners: { lx: number; rx: number }; W: number; H: number; residual: number | null } };
              const m = g.__stillMeasure();
              return { corners: m.corners, W: m.W, H: m.H, residual: m.residual };
            });
            corners[view.id] = probe;
          } catch (probeError) {
            corners[view.id] = { error: String(probeError) };
          }
          await page.close();
          continue;
        }
        const rows: StillRow[] = [];
        for (const viseme of ISOLATED_VISEMES) {
          const row = await page.evaluate((name: string) => {
            const g = globalThis as unknown as {
              __stillPose: (v: string) => { weights: Record<string, number>; jawOpenRadians: number; jawFraction: number; activeTargetName: string; teethWeight: number; teethTarget: string };
              __stillMeasure: () => { corners: { lx: number; rx: number }; widthPx: number; aperturePx: number; residual: number | null; W: number; H: number; centralBox: { x0: number; x1: number; y0: number; y1: number }; central: { upperTeethN: number; lowerTeethN: number; mouthTeethN: number; lipGapPx: number }; legacyWindow: { mouthTeethN: number; lipGapPx: number; n: number } };
              __openClinXrIsolatedRenderFrame?: () => void;
              requestAnimationFrame(cb: () => void): number;
            };
            const posed = g.__stillPose(name);
            g.__openClinXrIsolatedRenderFrame?.();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("requestAnimationFrame stalled")), 2000);
              g.requestAnimationFrame(() => {
                clearTimeout(timer);
                try {
                  resolve({ posed, measured: g.__stillMeasure() });
                } catch (e) { reject(e); }
              });
            });
          }, viseme);
          const typed = row as { posed: { weights: Record<string, number>; jawOpenRadians: number; jawFraction: number; activeTargetName: string; teethWeight: number; teethTarget: string }; measured: { corners: { lx: number; rx: number }; widthPx: number; aperturePx: number; residual: number | null; W: number; H: number; centralBox: { x0: number; x1: number; y0: number; y1: number }; central: { upperTeethN: number; lowerTeethN: number; mouthTeethN: number; lipGapPx: number }; legacyWindow: { mouthTeethN: number; lipGapPx: number; n: number }; png: string } };
          const weights = typed.posed.weights;
          const top = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
          const want = viseme === "sil" ? "viseme_sil" : `viseme_${viseme}`;
          if (!top || top[0] !== want || top[1] !== 1) {
            throw new Error(`isolated ${viseme}: expected ${want}=1, got ${top ? `${top[0]}=${top[1]}` : "(empty)"} active=${typed.posed.activeTargetName}`);
          }
          if (Object.values(weights).some((w) => w !== 0 && w !== 1)) throw new Error(`isolated ${viseme}: non-binary weights`);
          const m = typed.measured;
          const frameDir = path.join(OUT_DIR, `isolated-${view.id}`);
          mkdirSync(frameDir, { recursive: true });
          const shot = typed.measured.png;
          writeFileSync(path.join(frameDir, `${viseme}.png`), Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
          rows.push({
            viseme, target: want, weight: 1,
            jawRad: Math.round(typed.posed.jawOpenRadians * 1e6) / 1e6,
            jawFraction: Math.round(typed.posed.jawFraction * 1000) / 1000,
            teethTarget: typed.posed.teethTarget, teethWeight: Math.round(typed.posed.teethWeight * 1000) / 1000,
            corners: { lx: Math.round(m.corners.lx * 10) / 10, rx: Math.round(m.corners.rx * 10) / 10 },
            widthPx: Math.round(m.widthPx * 10) / 10, aperturePx: Math.round(m.aperturePx * 10) / 10,
            cameraResidualPx: m.residual === null ? -1 : Math.round(m.residual * 10) / 10,
            centralBox: { x0: Math.round(m.centralBox.x0 * 10) / 10, x1: Math.round(m.centralBox.x1 * 10) / 10, y0: Math.round(m.centralBox.y0 * 10) / 10, y1: Math.round(m.centralBox.y1 * 10) / 10 },
            upperPx: m.central.upperTeethN ?? 0, lowerPx: m.central.lowerTeethN ?? 0,
            mouthPx: m.central.mouthTeethN, lipGapPx: m.central.lipGapPx,
            legacyMouthPx: m.legacyWindow.mouthTeethN, legacyLipGapPx: m.legacyWindow.lipGapPx,
          });
          process.stdout.write(`isolated ${view.id} ${viseme}: jaw=${typed.posed.jawOpenRadians.toFixed(4)} teeth=${typed.posed.teethTarget}:${typed.posed.teethWeight} upper=${m.central.upperTeethN} lower=${m.central.lowerTeethN} aperture=${m.widthPx === 0 ? 0 : m.aperturePx.toFixed(1)}\n`);
        }
        report[view.id] = { canvas: { w: 0, h: 0 }, cameraResidualPx: 0, stills: rows };
        await page.close();
      }
    } finally {
      if (server) await stopPortlessDevServer(server.proc);
    }
  });
  void corners;
  writeFileSync(path.join(OUT_DIR, "isolated.raw.json"), `${JSON.stringify({ views: report, corners }, null, 2)}\n`);
  process.stdout.write("wrote isolated.raw.json\n");
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileUrlToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
