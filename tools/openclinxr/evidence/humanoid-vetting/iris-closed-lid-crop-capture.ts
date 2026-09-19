/**
 * Isolated closed-lid eye crop for the slit-drive grade (2026-09-19).
 *
 * Loads ONE shipped MPFB GLB in an isolated three.js page (no room, no studio),
 * drives lid closure + lid-tightener slit morphs to 1.0 (the 9b6f76ddc path),
 * renders a front head still at native 1:1, and crops each eye by pasting pixels
 * (no resample). Parent grades the pixels; this script issues no verdict.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/humanoid-vetting/iris-closed-lid-crop-capture.ts \
 *     --glb apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb \
 *     --outDir tmp/iris-closed-lid-2026-09-19 \
 *     --slit 0.45
 *
 * --slit drives eye-left-slit / eye-right-slit; closure morphs stay at 1.0.
 */
import { createServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const REPO = process.cwd();
const COMMIT = "9b6f76ddc";
const SIZE = 1024;
const CROP = 256;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const GLB_ARG = arg("--glb", "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");
const OUT_DIR = arg("--outDir", "tmp/iris-closed-lid-2026-09-19");
const SLIT = Number.parseFloat(arg("--slit", "1.0"));
if (!Number.isFinite(SLIT)) throw new Error(`--slit must be a number, got ${arg("--slit", "1.0")}`);

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".bin": "application/octet-stream",
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

// Drive closure + slit to 1.0 on every mesh that carries them (the 9b6f76ddc path).
const CLOSURE_TARGETS = ["eye-left-closure", "eye-right-closure"];
const SLIT_TARGETS = ["eye-left-slit", "eye-right-slit"];
const SLIT_VALUE = ${SLIT};
const written = [];
for (const o of root.children) o.updateMatrixWorld?.(true);
root.traverse((o) => {
  if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
  for (const name of CLOSURE_TARGETS) {
    const idx = o.morphTargetDictionary[name];
    if (typeof idx !== "number") continue;
    o.morphTargetInfluences[idx] = 1.0;
    written.push({ mesh: o.name, name, influence: o.morphTargetInfluences[idx] });
  }
  for (const name of SLIT_TARGETS) {
    const idx = o.morphTargetDictionary[name];
    if (typeof idx !== "number") continue;
    o.morphTargetInfluences[idx] = SLIT_VALUE;
    written.push({ mesh: o.name, name, influence: o.morphTargetInfluences[idx] });
  }
});

// Frame the head: top of the whole-figure bbox, head centre ~0.13 m below the crown.
const whole = new THREE.Box3().setFromObject(root);
const crownY = whole.max.y;
const headY = crownY - 0.13;
const headZ = (whole.min.z + whole.max.z) / 2;
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
camera.position.set(0, headY + 0.01, headZ + 0.62);
camera.lookAt(0, headY, headZ);
camera.updateMatrixWorld(true);

// Eye anchors: the fitted eyelash strip spans both eyes at lid level;
// its bbox quarter points give L/R eye centres (no separate eye mesh ships).
let eyeBox = null;
root.traverse((o) => {
  if (o.isMesh && /eyelashes_01/.test(o.name)) eyeBox = new THREE.Box3().setFromObject(o);
});
if (!eyeBox) throw new Error("eyelash anchor mesh not found");
const ec = eyeBox.getCenter(new THREE.Vector3());
const ex = (eyeBox.max.x - eyeBox.min.x) / 4;
const anchors = [
  { id: "screen-left", point: new THREE.Vector3(ec.x - ex, ec.y, ec.z) },
  { id: "screen-right", point: new THREE.Vector3(ec.x + ex, ec.y, ec.z) },
];
const toPx = (v) => {
  const p = v.clone().project(camera);
  return { x: Math.round((p.x * 0.5 + 0.5) * ${SIZE}), y: Math.round((-p.y * 0.5 + 0.5) * ${SIZE}) };
};
const crops = anchors.map((a) => {
  const px = toPx(a.point);
  const half = ${CROP} / 2;
  // Lash strip sits above the lid line; shift the window down so the
  // closed lid lands near crop centre. Paste only, no resample.
  const cy = px.y + 56;
  return {
    id: a.id,
    cx: px.x, cy,
    x: Math.max(0, Math.min(${SIZE} - ${CROP}, px.x - half)),
    y: Math.max(0, Math.min(${SIZE} - ${CROP}, cy - half)),
    size: ${CROP},
  };
});

renderer.render(scene, camera);
const face = renderer.domElement.toDataURL("image/png");

// 1:1 crops: paste pixels, no resample.
const src = renderer.domElement;
const eyeImages = {};
for (const c of crops) {
  const cv = document.createElement("canvas");
  cv.width = c.size; cv.height = c.size;
  cv.getContext("2d").drawImage(src, c.x, c.y, c.size, c.size, 0, 0, c.size, c.size);
  eyeImages[c.id] = cv.toDataURL("image/png");
}

// Screen-right eye (larger x) is the eye on the viewer's left.
const viewerLeft = crops[0].cx < crops[1].cx ? crops[1] : crops[0];
const viewerRight = crops[0].cx < crops[1].cx ? crops[0] : crops[1];

window.__report = {
  written,
  crops,
  viewerLeftId: viewerLeft.id,
  viewerRightId: viewerRight.id,
  canvasSize: ${SIZE},
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  face,
  eyeImages,
};
window.__done = true;
</script></body></html>`;

async function main(): Promise<void> {
  const { server, port } = await startStatic();
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    const consoles: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); else consoles.push(`${m.type()}: ${m.text().slice(0, 120)}`); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      const handle = await page.waitForFunction(
        () => {
          const flag = (globalThis as unknown as { __done?: boolean }).__done;
          return flag === true ? flag : null;
        },
        null,
        { timeout: 120_000 },
      );
      await handle.jsonValue();
    } catch (err) {
      const seen = await page.evaluate(() => (globalThis as unknown as { __report?: unknown }).__report !== undefined ? "report-present" : "no-report");
      throw new Error(`capture page never finished (${seen}); pageerrors=[${errors.join(" | ").slice(0, 800)}] consoles=[${consoles.join(" | ").slice(0, 800)}]`);
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
    const report = await page.evaluate(() => (globalThis as unknown as { __report: unknown }).__report as {
      written: { mesh: string; name: string; influence: number }[];
      crops: { id: string; cx: number; cy: number; x: number; y: number; size: number }[];
      viewerLeftId: string;
      viewerRightId: string;
      canvasSize: number;
      renderer: string;
      face: string;
      eyeImages: Record<string, string>;
    });
    // 8 body meshes each carry the 4 eye targets: 32 writes, closure at 1.0, slit at SLIT.
    const badClosure = report.written.filter((w) => w.name.includes("closure") && w.influence !== 1);
    const badSlit = report.written.filter((w) => w.name.includes("slit") && w.influence !== SLIT);
    if (report.written.length !== 32 || badClosure.length > 0 || badSlit.length > 0) {
      throw new Error(`expected 32 morph writes (closure 1.0, slit ${SLIT}), got ${report.written.length} (${badClosure.length} closure off, ${badSlit.length} slit off): ${JSON.stringify(report.written).slice(0, 400)}`);
    }
    const outAbs = path.join(REPO, OUT_DIR);
    await mkdir(outAbs, { recursive: true });
    const save = async (name: string, dataUrl: string): Promise<string> => {
      const b64 = dataUrl.split(",", 2)[1]!;
      const p = path.join(outAbs, name);
      await writeFile(p, Buffer.from(b64, "base64"));
      return p;
    };
    const facePath = await save("face-native-1x.png", report.face);
    const leftPath = await save(
      "eye-viewer-left-native-1x.png",
      report.eyeImages[report.viewerLeftId]!,
    );
    const rightPath = await save(
      "eye-viewer-right-native-1x.png",
      report.eyeImages[report.viewerRightId]!,
    );
    const head = (await import("node:child_process")).execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim();
    const reportJson = {
      schemaVersion: "openclinxr.iris-closed-lid-crop.v1",
      glb: GLB_ARG,
      commit: head,
      slitDriveCommit: COMMIT,
      closure: 1.0,
      slit: SLIT,
      morphsWritten: report.written,
      renderer: report.renderer,
      canvasSize: report.canvasSize,
      devicePixelRatio: 1,
      crops: report.crops,
      viewerMapping: {
        viewerLeftPng: "eye-viewer-left-native-1x.png",
        viewerRightPng: "eye-viewer-right-native-1x.png",
      },
      claimScope: "closed-lid still + 1:1 eye crops after slit drive; pixel seal is for the parent to grade",
      notEvidenceFor: "lid-seal verdict, clinical realism, Quest readiness",
    };
    const reportPath = path.join(outAbs, "report.json");
    await writeFile(reportPath, JSON.stringify(reportJson, null, 2));
    console.log(`face: ${facePath}`);
    console.log(`left: ${leftPath}`);
    console.log(`right: ${rightPath}`);
    console.log(`report: ${reportPath}`);
    await browser.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
}

await main();
