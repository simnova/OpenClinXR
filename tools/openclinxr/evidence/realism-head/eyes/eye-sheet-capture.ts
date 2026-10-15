/**
 * Eyes gaze-blink sheet (tsk_e4befac3ff1b06da): four 1280 three.js portraits
 * each of the realism head and the shipped control, plus eye-band crops.
 *
 * Views per GLB: front (rest), yaw +25 (eye bones rotateOnWorldAxis +0.4363
 * rad, the shipped gaze-drives-eyes.ts:64 mechanism), yaw -25 (-0.4363 rad),
 * blink closed (eye-*-closure 1.0 + eye-*-slit 1.0, the public-loop pair from
 * blink-drives-slit). Every view fail-closes when a named bone/target is
 * missing or a write does not read back.
 *
 * Gaze drive source (never invented here):
 * - rotateOnWorldAxis(worldUp, yaw), gaze-drives-eyes.ts:54-66
 * - lateral-dominance threshold 2:1 from
 *   gaze-moves-the-iris-sideways-at-runtime.test.ts:105 (measured 5.6:1 good,
 *   0.65:1 legacy control)
 * Blink drive source:
 * - eye-*-closure at influence 1.0 seals the aperture (negative crossing,
 *   actors-blink-with-their-eyelids.test.ts:26-35: aisha 7.63 -> -1.92 mm)
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/realism-head/eyes/eye-sheet-capture.ts \
 *     --realism /abs/path/aisha-realism.glb --control /abs/path/control.glb \
 *     --out /abs/path/out-dir
 *
 * claimScope: stills proving gaze moves the iris sideways and blink closes
 *   the lids (with lashes) on the realism head vs control. Pixel grade is the
 *   orchestrator's (D12).
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
const YAW_25_RAD = 0.43633;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const val = i >= 0 ? process.argv[i + 1] : undefined;
  return val === undefined || val === "" ? undefined : val;
}

const REALISM_ARG = arg("--realism");
const CONTROL_ARG = arg("--control");
const OUT_DIR = arg("--out");
if (!REALISM_ARG) throw new Error("--realism <path> is required");
if (!CONTROL_ARG) throw new Error("--control <path> is required");
if (!OUT_DIR) throw new Error("--out <dir> is required");
const REALISM_PATH: string = REALISM_ARG;
const CONTROL_PATH: string = CONTROL_ARG;
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
        if (url.pathname === "/realism.glb") {
          file = path.isAbsolute(REALISM_PATH) ? REALISM_PATH : path.join(REPO, REALISM_PATH);
        } else if (url.pathname === "/control.glb") {
          file = path.isAbsolute(CONTROL_PATH) ? CONTROL_PATH : path.join(REPO, CONTROL_PATH);
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

const UP = new THREE.Vector3(0, 1, 0);
const YAW = ${YAW_25_RAD};

async function shootSubject(url, takes) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18211d);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 1.9, 1.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdde4ff, 0.7);
  fill.position.set(-0.8, 1.5, 1.0);
  scene.add(fill);
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

  function setMorph(name, weight) {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      const idx = o.morphTargetDictionary[name];
      if (typeof idx !== "number") return;
      o.morphTargetInfluences[idx] = weight;
      if (o.morphTargetInfluences[idx] !== weight) throw new Error("write did not read back: " + name);
      n++;
    });
    if (n === 0) throw new Error("named target missing on every mesh: " + name);
    return n;
  }
  function gazeYaw(rad) {
    const touched = [];
    for (const nm of ["eyeL", "eyeR"]) {
      const bone = root.getObjectByName(nm);
      if (!bone) throw new Error("eye bone missing: " + nm);
      const rest = REST.get(nm);
      if (!rest) throw new Error("rest orientation missing: " + nm);
      bone.quaternion.copy(rest);
      bone.rotation.setFromQuaternion(bone.quaternion);
      bone.rotateOnWorldAxis(UP, rad);
      bone.rotation.setFromQuaternion(bone.quaternion);
      touched.push(nm);
    }
    root.updateMatrixWorld(true);
    return touched;
  }
  function resetAll(driven) {
    root.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      for (const name of driven) {
        const idx = o.morphTargetDictionary[name];
        if (typeof idx === "number") o.morphTargetInfluences[idx] = 0;
      }
    });
  }
  function snap() {
    root.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const cv = document.createElement("canvas");
    cv.width = ${SIZE}; cv.height = ${SIZE};
    cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
    return cv;
  }

  const driven = new Set();
  function mark(name, n) { driven.add(name); return n; }
  // Rest orientations: gaze takes compose from rest, never from the previous
  // take (a yaw-minus rendered from a yaw-plus state would show rest while
  // the record claims -25deg).
  const REST = new Map();
  for (const nm of ["eyeL", "eyeR"]) {
    const bone = root.getObjectByName(nm);
    if (!bone) throw new Error("eye bone missing: " + nm);
    REST.set(nm, bone.quaternion.clone());
  }
  const views = [];
  for (const take of takes) {
    resetAll(driven);
    driven.clear();
    for (const [nm, q] of REST) {
      const bone = root.getObjectByName(nm);
      bone.quaternion.copy(q);
      bone.rotation.setFromQuaternion(bone.quaternion);
    }
    root.updateMatrixWorld(true);
    let writes;
    if (take.id === "front") {
      writes = { bonesTouched: [], yawRad: 0 };
    } else if (take.id === "yaw-plus-25" || take.id === "yaw-minus-25") {
      const rad = take.id === "yaw-plus-25" ? YAW : -YAW;
      writes = { bonesTouched: gazeYaw(rad), yawRad: rad };
    } else if (take.id === "blink") {
      writes = {
        closureMeshes: mark("eye-left-closure", setMorph("eye-left-closure", 1.0))
          + mark("eye-right-closure", setMorph("eye-right-closure", 1.0)),
        slitMeshes: mark("eye-left-slit", setMorph("eye-left-slit", 1.0))
          + mark("eye-right-slit", setMorph("eye-right-slit", 1.0)),
      };
    }
    root.updateMatrixWorld(true);
    views.push({ id: take.id, label: take.label, full: snap(), writes });
    resetAll(driven);
    driven.clear();
  }
  return views;
}

const TAKES = [
  { id: "front", label: "front rest" },
  { id: "yaw-plus-25", label: "gaze yaw +25deg (0.4363 rad)" },
  { id: "yaw-minus-25", label: "gaze yaw -25deg (-0.4363 rad)" },
  { id: "blink", label: "blink closed (closure 1.0 + slit 1.0)" },
];
const realismViews = await shootSubject("/realism.glb", TAKES);
const controlViews = await shootSubject("/control.glb", TAKES);

// Sheet: 8 rows x (full 640 | eye crop). Eye band fractions of the 1280
// frame, stated in the node-side record: both eyes through the full lid
// opening.
const EYE = { x0: 0.30, x1: 0.70, y0: 0.47, y1: 0.60 };
const CELL = 640, LABELH = 44;
const rows = [
  ...realismViews.map((v) => ({ ...v, subject: "realism" })),
  ...controlViews.map((v) => ({ ...v, subject: "control" })),
];
const sheet = document.createElement("canvas");
sheet.width = CELL * 2; sheet.height = rows.length * (CELL + LABELH);
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
rows.forEach((v, i) => {
  const y = i * (CELL + LABELH);
  blit(v.full, 0, y, CELL, CELL + LABELH, v.subject + " " + v.label + " full");
  blit(cropOf(v.full, EYE), CELL, y, CELL, CELL + LABELH, v.subject + " " + v.id + " eyes x.30-.70 y.47-.60");
});

function dataUrl(cv) { return cv.toDataURL("image/png"); }
window.__report = {
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  eyeBand: EYE,
  renderSize: ${SIZE},
  yawRad: YAW,
  views: rows.map((v) => ({ subject: v.subject, id: v.id, label: v.label, writes: v.writes, full: dataUrl(v.full) })),
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
    }).sceneCapture.withBrowser("realism-head:eyes-sheet", async (launched) => {
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
        throw new Error(`eyes sheet page never finished; pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
      }
      if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
      const report = await page.evaluate(
        () => (globalThis as unknown as { __report: unknown }).__report as {
          renderer: string;
          eyeBand: unknown;
          renderSize: number;
          yawRad: number;
          views: Array<{ subject: string; id: string; label: string; writes: unknown; full: string }>;
          sheet: string;
        },
      );
      await mkdir(OUT_PATH, { recursive: true });
      for (const v of report.views) {
        const b64 = v.full.split(",", 2)[1];
        if (b64 === undefined) throw new Error(`${v.subject}-${v.id} full data URL has no payload`);
        await writeFile(path.join(OUT_PATH, `eyes-${v.subject}-${v.id}-full.png`), Buffer.from(b64, "base64"));
      }
      const sheetB64 = report.sheet.split(",", 2)[1];
      if (sheetB64 === undefined) throw new Error("sheet data URL has no payload");
      await writeFile(path.join(OUT_PATH, "gaze-blink-sheet.png"), Buffer.from(sheetB64, "base64"));
      const record = {
        realismSha256: createHash("sha256")
          .update(await readFile(path.isAbsolute(REALISM_PATH) ? REALISM_PATH : path.join(REPO, REALISM_PATH)))
          .digest("hex"),
        controlSha256: createHash("sha256")
          .update(await readFile(path.isAbsolute(CONTROL_PATH) ? CONTROL_PATH : path.join(REPO, CONTROL_PATH)))
          .digest("hex"),
        renderSize: report.renderSize,
        eyeBand: report.eyeBand,
        yawRad: report.yawRad,
        renderer: report.renderer,
        views: report.views.map((v) => ({ subject: v.subject, id: v.id, label: v.label, writes: v.writes })),
      };
      await writeFile(path.join(OUT_PATH, "eyes-sheet-record.json"), `${JSON.stringify(record, null, 2)}\n`);
      console.log(JSON.stringify({ ...record, views: record.views }, null, 2));
    });
  } finally {
    server.close();
  }
}

await main();
