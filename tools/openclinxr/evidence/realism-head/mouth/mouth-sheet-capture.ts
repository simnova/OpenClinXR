/**
 * Mouth viseme-emotion sheet (tsk_667587349a455eec): five 1280 three.js
 * portraits of the realism head plus mouth + brow-band crops.
 *
 * Views: viseme_aa (+jaw aperture), viseme_PP, viseme_sil, reassured
 * (runtime-faithful weights), brow concern (full-scale AU1+AU4x0.45).
 * Drives morphs by dictionary name on the live mesh graph and rotates the
 * bone named `jaw` about local X; every view fail-closes when a named
 * target is missing or a write does not read back.
 *
 * Weight sources (never invented here):
 * - jaw aperture JAW_OPEN_TEETH_CLEAR_RADIANS (viseme-timeline-drive.ts:91)
 * - reassured row {0.08,0.18,0.18} (actor-turn-plan-consumption.ts:71),
 *   applied per face-rig.ts:407-422 (mouth-open +w*0.18, brow group,
 *   cheek group, mouth-corner-puller 0.5 at :421)
 * - concern anatomy AU1 bilateral + AU4 at 0.45 (face-rig.ts:339-352 note)
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/realism-head/mouth/mouth-sheet-capture.ts \
 *     --glb /abs/path/aisha-realism.glb --out /abs/path/out-dir
 *
 * claimScope: stills proving the realism head drives visemes, jaw, and the
 *   emotion morph set. The pixel grade is the orchestrator's (D12).
 * notEvidenceFor: clinical_validity, production_asset_readiness.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { chromium, type Page } from "../../lib/slotted-playwright.js";

type HeadlessBrowser = {
  newPage(options?: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

const REPO = process.cwd();
const SIZE = 1280;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const val = i >= 0 ? process.argv[i + 1] : undefined;
  return val === undefined || val === "" ? undefined : val;
}

const GLB_ARG = arg("--glb");
const OUT_DIR = arg("--out");
if (!GLB_ARG) throw new Error("--glb <path> is required");
if (!OUT_DIR) throw new Error("--out <dir> is required");
const GLB_PATH: string = GLB_ARG;
const OUT_PATH: string = OUT_DIR;

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".html": "text/html",
};

function startStatic(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(PAGE_HTML);
          return;
        }
        let file: string;
        if (url.pathname === "/subject.glb") {
          file = path.isAbsolute(GLB_PATH) ? GLB_PATH : path.join(REPO, GLB_PATH);
        } else if (url.pathname.startsWith("/three/")) {
          file = path.join(REPO, "node_modules/three", url.pathname.slice("/three/".length));
        } else {
          res.writeHead(404);
          res.end("no");
          return;
        }
        const data = await readFile(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
        res.end(data);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

const PAGE_HTML = `<!doctype html><html><body style="margin:0">
<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${SIZE}, ${SIZE}, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x18211d);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.6, 1.9, 1.4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdde4ff, 0.7);
fill.position.set(-0.8, 1.5, 1.0);
scene.add(fill);

const gltf = await new GLTFLoader().loadAsync("/subject.glb");
const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);

const whole = new THREE.Box3().setFromObject(root);
const crownY = whole.max.y;
const headY = crownY - 0.13;
const headZ = (whole.min.z + whole.max.z) / 2;
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
camera.position.set(0, headY + 0.01, headZ + 0.62);
camera.lookAt(0, headY, headZ);
camera.updateMatrixWorld(true);

const DRIVEN = new Set();
function setMorph(name, weight) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    const idx = o.morphTargetDictionary[name];
    if (typeof idx !== "number") return;
    o.morphTargetInfluences[idx] = weight;
    DRIVEN.add(name);
    if (o.morphTargetInfluences[idx] !== weight) throw new Error("write did not read back: " + name);
    n++;
  });
  if (n === 0) throw new Error("named target missing on every mesh: " + name);
  return n;
}
let jawRestX = null;
function setJaw(rad) {
  const jaw = root.getObjectByName("jaw");
  if (!jaw) throw new Error("bone jaw missing");
  if (jawRestX === null) jawRestX = jaw.rotation.x;
  jaw.rotation.x = jawRestX + rad;
  root.updateMatrixWorld(true);
  return jaw.rotation.x;
}
function resetAll() {
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const name of DRIVEN) {
      const idx = o.morphTargetDictionary[name];
      if (typeof idx === "number") o.morphTargetInfluences[idx] = 0;
    }
  });
  DRIVEN.clear();
  setJaw(0);
}
function snap() {
  root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const cv = document.createElement("canvas");
  cv.width = ${SIZE}; cv.height = ${SIZE};
  cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  return cv;
}

const JAW_AA = 0.15086; // viseme-timeline-drive.ts:91
const views = [];
function shoot(id, label, drive) {
  resetAll();
  const writes = drive();
  const full = snap();
  views.push({ id, label, full, writes });
}

// 1. viseme_aa at full weight plus the full teeth-clearing jaw aperture.
shoot("aa", "viseme_aa + jaw 0.15086", () => {
  const w = [setMorph("viseme_aa", 1.0)];
  const jx = setJaw(JAW_AA);
  return { viseme_aa_meshes: w[0], jawRotationX: jx };
});
// 2. bilabial closure.
shoot("pp", "viseme_PP", () => ({ viseme_PP_meshes: setMorph("viseme_PP", 1.0) }));
// 3. silence.
shoot("sil", "viseme_sil", () => ({ viseme_sil_meshes: setMorph("viseme_sil", 1.0) }));
// 4. reassured, runtime-faithful (face-rig.ts:407-422 on the 0.08/0.18/0.18 row).
shoot("reassured", "reassured (AU12 0.5)", () => {
  const out = {};
  out["mouth-open"] = setMorph("mouth-open", 0.014);
  out["inner-up L+R"] = setMorph("eyebrows-left-inner-up", 0.18) + setMorph("eyebrows-right-inner-up", 0.18);
  out["down L+R"] = setMorph("eyebrows-left-down", 0.081) + setMorph("eyebrows-right-down", 0.081);
  out["slit L+R"] = setMorph("eye-left-slit", 0.153) + setMorph("eye-right-slit", 0.153);
  out["mouth-corner-puller"] = setMorph("mouth-corner-puller", 0.5);
  return out;
});
// 5. brow concern at full scale (AU1 bilateral + AU4 at 0.45).
shoot("brow", "brow concern full", () => {
  const out = {};
  out["inner-up L+R"] = setMorph("eyebrows-left-inner-up", 1.0) + setMorph("eyebrows-right-inner-up", 1.0);
  out["down L+R"] = setMorph("eyebrows-left-down", 0.45) + setMorph("eyebrows-right-down", 0.45);
  return out;
});

// Sheet: 5 rows x (full 640 | mouth crop | brow crop). Crop bands are
// fractions of the 1280 frame, stated in the node-side record.
const MOUTH = { x0: 0.30, x1: 0.70, y0: 0.60, y1: 0.82 };
const BROWBAND = { x0: 0.30, x1: 0.70, y0: 0.40, y1: 0.54 };
const CELL = 640, LABELH = 44;
const sheet = document.createElement("canvas");
sheet.width = CELL * 3; sheet.height = views.length * (CELL + LABELH);
const g = sheet.getContext("2d");
g.fillStyle = "#18211d";
g.fillRect(0, 0, sheet.width, sheet.height);
function cropOf(src, band) {
  const sx = band.x0 * ${SIZE}, sy = band.y0 * ${SIZE};
  const sw = (band.x1 - band.x0) * ${SIZE}, sh = (band.y1 - band.y0) * ${SIZE};
  const cv = document.createElement("canvas");
  cv.width = sw; cv.height = sh;
  cv.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return cv;
}
function blit(img, dx, dy, dw, dh, label) {
  g.fillStyle = "#0f1613";
  g.fillRect(dx, dy, dw, LABELH);
  g.fillStyle = "#e8f5ef";
  g.font = "20px Menlo, Consolas, monospace";
  g.fillText(label, dx + 12, dy + 29);
  const iw = img.width, ih = img.height;
  const s = Math.min(dw / iw, (dh - LABELH) / ih);
  const w = iw * s, h = ih * s;
  g.drawImage(img, dx + (dw - w) / 2, dy + LABELH + (dh - LABELH - h) / 2, w, h);
}
views.forEach((v, i) => {
  const y = i * (CELL + LABELH);
  blit(v.full, 0, y, CELL, CELL + LABELH, v.label + " full");
  blit(cropOf(v.full, MOUTH), CELL, y, CELL, CELL + LABELH, v.id + " mouth x.30-.70 y.60-.82");
  blit(cropOf(v.full, BROWBAND), CELL * 2, y, CELL, CELL + LABELH, v.id + " brow x.30-.70 y.40-.54");
});

function dataUrl(cv) { return cv.toDataURL("image/png"); }
window.__report = {
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  mouthBand: MOUTH,
  browBand: BROWBAND,
  renderSize: ${SIZE},
  views: views.map((v) => ({ id: v.id, label: v.label, writes: v.writes, full: dataUrl(v.full) })),
  sheet: dataUrl(sheet),
};
window.__done = true;
</script></body></html>`;

async function main(): Promise<void> {
  const { server, port } = await startStatic();
  try {
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("realism-head:mouth-sheet", async (launched) => {
      const page = await (launched as HeadlessBrowser).newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 300));
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      try {
        const handle = await page.waitForFunction(
          () => {
            const flag = (globalThis as unknown as { __done?: boolean }).__done;
            return flag === true ? flag : null;
          },
          null,
          { timeout: 240_000 },
        );
        await handle.jsonValue();
      } catch {
        throw new Error(`mouth sheet page never finished; pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
      }
      if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
      const report = await page.evaluate(
        () => (globalThis as unknown as { __report: unknown }).__report as {
          renderer: string;
          mouthBand: unknown;
          browBand: unknown;
          renderSize: number;
          views: Array<{ id: string; label: string; writes: unknown; full: string }>;
          sheet: string;
        },
      );
      await mkdir(OUT_PATH, { recursive: true });
      for (const v of report.views) {
        const b64 = v.full.split(",", 2)[1];
        if (b64 === undefined) throw new Error(`${v.id} full data URL has no payload`);
        await writeFile(path.join(OUT_PATH, `mouth-${v.id}-full.png`), Buffer.from(b64, "base64"));
      }
      const sheetB64 = report.sheet.split(",", 2)[1];
      if (sheetB64 === undefined) throw new Error("sheet data URL has no payload");
      await writeFile(path.join(OUT_PATH, "viseme-emotion-sheet.png"), Buffer.from(sheetB64, "base64"));
      const glbAbs = path.isAbsolute(GLB_PATH) ? GLB_PATH : path.join(REPO, GLB_PATH);
      const record = {
        glbSha256: createHash("sha256").update(await readFile(glbAbs)).digest("hex"),
        renderSize: report.renderSize,
        mouthBand: report.mouthBand,
        browBand: report.browBand,
        renderer: report.renderer,
        views: report.views.map((v) => ({ id: v.id, label: v.label, writes: v.writes })),
      };
      await writeFile(path.join(OUT_PATH, "mouth-sheet-record.json"), `${JSON.stringify(record, null, 2)}\n`);
      console.log(JSON.stringify(record, null, 2));
    });
  } finally {
    server.close();
  }
}

await main();
