/**
 * Lash blink sheet (lashcards): open vs closed front + upper-lid crops.
 *
 * Loads the BAKED lashcards GLB (T2+A3: lash prim carries the 6
 * closure/slit/opened-up targets) in an isolated three.js page (no room, no
 * studio), renders a front head still with lids OPEN (all closure at 0) and
 * with blink CLOSED (eye-left/right-closure at 1.0 on every mesh carrying
 * them, body + lash), crops a full-width upper-lid band around the lash line
 * from each (paste 1:1, no resample), and composes lash-sheet.png in-page:
 *   row A (1280x280):  open upper-lid crop
 *   row B (1280x280):  closed upper-lid crop
 *   row C (640+640 x 560): open front full | closed front full
 *
 * Fail-closed: the lash mesh (/eyelash/i) must accept the L+R closure writes
 * at 1.0, else the page throws and no sheet is written.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash-sheet-capture.ts \
 *     --glb .openclinxr/realism-spike/lashcards/aisha-lash-blink.glb
 *
 * claimScope: open/closed stills proving the fitted lash strip moves with the
 * lid. notEvidenceFor: clinical_validity, production_asset_readiness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { chromium, type Page } from "../../../evidence/lib/slotted-playwright.js";

type HeadlessBrowser = {
  newPage(options?: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

const REPO = process.cwd();
const SIZE = 1280;
const BAND_H = 280;
const SHEET_W = 1280;
const SHEET_H = BAND_H * 2 + 560;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  const val = i >= 0 ? process.argv[i + 1] : undefined;
  return val === undefined || val === "" ? fallback : val;
}

const GLB_ARG = arg("--glb", ".openclinxr/realism-spike/lashcards/aisha-lash-blink.glb");
const OUT_PNG = path.join(
  REPO,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash-sheet.png",
);

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
          file = path.join(REPO, GLB_ARG);
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
scene.background = new THREE.Color(0x111111);
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

// Frame the head: top of the whole-figure bbox, head centre ~0.13 m below the crown.
const whole = new THREE.Box3().setFromObject(root);
const crownY = whole.max.y;
const headY = crownY - 0.13;
const headZ = (whole.min.z + whole.max.z) / 2;
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
camera.position.set(0, headY + 0.01, headZ + 0.62);
camera.lookAt(0, headY, headZ);
camera.updateMatrixWorld(true);

const CLOSURE = ["eye-left-closure", "eye-right-closure"];
function drive(weight) {
  const written = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const name of CLOSURE) {
      const idx = o.morphTargetDictionary[name];
      if (typeof idx !== "number") continue;
      o.morphTargetInfluences[idx] = weight;
      written.push({ mesh: o.name, name, influence: o.morphTargetInfluences[idx] });
    }
  });
  return written;
}
function lashBox() {
  let box = null;
  root.traverse((o) => {
    if (o.isMesh && /eyelash/i.test(o.name)) {
      const b = new THREE.Box3().setFromObject(o);
      box = box ? box.union(b) : b;
    }
  });
  return box;
}
function bandFromLash() {
  const box = lashBox();
  if (!box) throw new Error("lash anchor mesh (/eyelash/i) not found");
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    pts.push({ x: Math.round((p.x * 0.5 + 0.5) * ${SIZE}), y: Math.round((-p.y * 0.5 + 0.5) * ${SIZE}) });
  }
  const cy = Math.round((Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2);
  const y = Math.max(0, Math.min(${SIZE} - ${BAND_H}, cy - ${BAND_H} / 2));
  return { x: 0, y, w: ${SIZE}, h: ${BAND_H}, lashCy: cy };
}
function cropOf(src, band) {
  const cv = document.createElement("canvas");
  cv.width = band.w; cv.height = band.h;
  cv.getContext("2d").drawImage(src, band.x, band.y, band.w, band.h, 0, 0, band.w, band.h);
  return cv;
}

// OPEN: all closure at 0.
const openWritten = drive(0);
renderer.render(scene, camera);
const openFull = document.createElement("canvas");
openFull.width = ${SIZE}; openFull.height = ${SIZE};
openFull.getContext("2d").drawImage(renderer.domElement, 0, 0);
const openBand = bandFromLash();
const openCrop = cropOf(openFull, openBand);

// CLOSED: blink shut.
const closedWritten = drive(1.0);
renderer.render(scene, camera);
const closedFull = document.createElement("canvas");
closedFull.width = ${SIZE}; closedFull.height = ${SIZE};
closedFull.getContext("2d").drawImage(renderer.domElement, 0, 0);
const closedBand = bandFromLash();
const closedCrop = cropOf(closedFull, closedBand);

// Fail-closed: the lash strip itself must carry both closure targets at 1.0.
const lashClosed = closedWritten.filter((w) => /eyelash/i.test(w.mesh));
if (lashClosed.length < 2 || lashClosed.some((w) => w.influence !== 1)) {
  throw new Error("lash mesh did not accept L+R closure at 1.0: " + JSON.stringify(lashClosed));
}

// Compose the sheet in-page: open crop / closed crop / open full | closed full.
const sheet = document.createElement("canvas");
sheet.width = ${SHEET_W}; sheet.height = ${SHEET_H};
const g = sheet.getContext("2d");
g.fillStyle = "#111111";
g.fillRect(0, 0, sheet.width, sheet.height);
g.drawImage(openCrop, 0, 0);
g.drawImage(closedCrop, 0, ${BAND_H});
g.drawImage(openFull, 0, 0, ${SIZE}, ${SIZE}, 0, ${BAND_H} * 2, 640, 560);
g.drawImage(closedFull, 0, 0, ${SIZE}, ${SIZE}, 640, ${BAND_H} * 2, 640, 560);
g.fillStyle = "#ffffff";
g.font = "28px sans-serif";
g.fillText("OPEN", 16, 36);
g.fillText("CLOSED blink", 16, ${BAND_H} + 36);
g.fillText("OPEN front", 16, ${BAND_H} * 2 + 40);
g.fillText("CLOSED front", 656, ${BAND_H} * 2 + 40);

window.__report = {
  lashClosedWrites: lashClosed,
  bodyClosedWrites: closedWritten.length - lashClosed.length,
  openBand,
  closedBand,
  sheetW: sheet.width,
  sheetH: sheet.height,
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  sheet: sheet.toDataURL("image/png"),
};
window.__done = true;
</script></body></html>`;

async function main(): Promise<void> {
  const { server, port } = await startStatic();
  try {
  await createLocalComputeServices({
    browserLaunch: chromium.launch.bind(chromium, {
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    }),
  }).sceneCapture.withBrowser("lashcards:lash-sheet", async (launched) => {
    const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      const handle = await page.waitForFunction(
        () => {
          const flag = (globalThis as unknown as { __done?: boolean }).__done;
          return flag === true ? flag : null;
        },
        null,
        { timeout: 180_000 },
      );
      await handle.jsonValue();
    } catch {
      const seen = await page.evaluate(() => (globalThis as unknown as { __report?: unknown }).__report !== undefined ? "report-present" : "no-report");
      throw new Error(`lash sheet page never finished (${seen}); pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
    const report = await page.evaluate(() => (globalThis as unknown as { __report: unknown }).__report as {
      lashClosedWrites: { mesh: string; name: string; influence: number }[];
      bodyClosedWrites: number;
      openBand: unknown;
      closedBand: unknown;
      sheetW: number;
      sheetH: number;
      renderer: string;
      sheet: string;
    });
    if (report.sheetW !== SHEET_W || report.sheetH !== SHEET_H) {
      throw new Error(`sheet is ${report.sheetW}x${report.sheetH}, want ${SHEET_W}x${SHEET_H}`);
    }
    await mkdir(path.dirname(OUT_PNG), { recursive: true });
    const sheetB64 = report.sheet.split(",", 2)[1];
    if (sheetB64 === undefined) throw new Error("sheet data URL has no payload");
    await writeFile(OUT_PNG, Buffer.from(sheetB64, "base64"));
    console.log(JSON.stringify({
      sheet: path.relative(REPO, OUT_PNG),
      sheetSize: `${report.sheetW}x${report.sheetH}`,
      lashClosedWrites: report.lashClosedWrites,
      bodyClosedWrites: report.bodyClosedWrites,
      openBand: report.openBand,
      closedBand: report.closedBand,
      renderer: report.renderer,
    }, null, 2));
  });
  } finally {
    server.close();
  }
}

await main();
