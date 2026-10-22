/**
 * G6 in-human sheet: full-head bake with the geometric anterior segment,
 * three.js product-rig analogue of the room-0.5 + quad@(1,8,6) recipe.
 *
 * Scene: RoomEnvironment PMREM at environmentIntensity 0.5 (room veil) +
 * key DirectionalLight from eye-local (1,8,6) (the quad) + ACES. Eye
 * materials (g6_*) get envMapIntensity 0.6, the F-proof ON value.
 * Takes: front, yaw +/-25deg (eye.L/eye.R bones, the shipped gaze
 * mechanism), blink (closure+slit 1.0). Fail-closes on missing bones/targets.
 *
 * Usage:
 *   pnpm tsx tools/.../eyes/geometric-eye-g6-sheet-capture.ts \
 *     --head /abs/path/geometric-eye-g6-head.glb --out /abs/path/out-dir
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { chromium } from "../../lib/slotted-playwright.js";

const REPO = process.cwd();
const SIZE = 1280;
const YAW_25_RAD = 0.43633;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v === undefined || v === "" ? undefined : v;
}
const HEAD_PATH: string = arg("--head") ?? "";
const OUT_DIR: string = arg("--out") ?? "";
if (!HEAD_PATH || !OUT_DIR) throw new Error("--head and --out required");

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
        if (url.pathname === "/head.glb") {
          file = path.isAbsolute(HEAD_PATH) ? HEAD_PATH : path.join(REPO, HEAD_PATH);
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
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${SIZE}, ${SIZE}, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const UP = new THREE.Vector3(0, 1, 0);
const YAW = ${YAW_25_RAD};
const QUAD = new THREE.Vector3(1, 8, 6).normalize();

async function shoot(url, takes) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161c);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5; // room-0.5 veil
  const quad = new THREE.DirectionalLight(0xffffff, 2.4);
  quad.position.copy(QUAD).multiplyScalar(3.0);
  scene.add(quad);
  scene.add(quad.target);
  scene.add(root);
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  root.traverse((o) => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.name && m.name.startsWith("g6_")) m.envMapIntensity = 0.6;
      }
    }
  });
  root.updateMatrixWorld(true);

  const whole = new THREE.Box3().setFromObject(root);
  const crownY = whole.max.y;
  const headY = crownY - 0.20;
  const headZ = (whole.min.z + whole.max.z) / 2;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 30);
  camera.position.set(0, headY + 0.02, headZ + 0.85);
  camera.lookAt(0, headY, headZ);
  camera.updateMatrixWorld(true);
  quad.target.position.set(0, headY, headZ);
  quad.target.updateMatrixWorld(true);

  function setMorph(name, weight) {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      const idx = o.morphTargetDictionary[name];
      if (typeof idx === "number") {
        o.morphTargetInfluences[idx] = weight;
        if (o.morphTargetInfluences[idx] !== weight) throw new Error("write did not read back: " + name);
        n++;
      }
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
        closureMeshes: (setMorph("eye-left-closure", 1.0) + setMorph("eye-right-closure", 1.0)),
        slitMeshes: (setMorph("eye-left-slit", 1.0) + setMorph("eye-right-slit", 1.0)),
      };
      for (const n of ["eye-left-closure","eye-right-closure","eye-left-slit","eye-right-slit"]) driven.add(n);
    }
    root.updateMatrixWorld(true);
    views.push({ id: take.id, writes, full: snap().toDataURL("image/png") });
    resetAll(driven);
    driven.clear();
  }
  return views;
}
const TAKES = [
  { id: "front" }, { id: "yaw-plus-25" }, { id: "yaw-minus-25" }, { id: "blink" },
];
const views = await shoot("/head.glb", TAKES);
window.__report = {
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  renderSize: ${SIZE},
  yawRad: YAW,
  views,
};
window.__done = true;
</script></body></html>`;

async function main(): Promise<void> {
  const { server, port } = await startStatic();
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
    page.on("requestfailed", (r) => errors.push("reqfail: " + r.url().slice(0, 120) + " " + (r.failure()?.errorText ?? "")));
    await page.goto("http://127.0.0.1:" + port + "/");
    try {
      await page.waitForFunction("window.__done === true", undefined, { timeout: 240000 });
    } catch (e) {
      try {
        const state = await page.evaluate("({ done: window.__done ?? null })");
        errors.push("state: " + JSON.stringify(state));
      } catch (e2) { errors.push("no-eval: " + String(e2).slice(0, 300)); }
      throw new Error("capture timeout; " + errors.join(" | ").slice(0, 3000));
    }
    const report = await page.evaluate("window.__report");
    await browser.close();
    const fatal = errors.filter((e) => e.startsWith("pageerror:") || e.startsWith("reqfail:") || e.startsWith("no-eval:") || e.startsWith("state:"));
    if (fatal.length) throw new Error("page errors: " + fatal.join(" | ").slice(0, 2000));
    await mkdir(OUT_DIR, { recursive: true });
    const meta: Record<string, unknown> = {
      renderer: report.renderer,
      renderSize: report.renderSize,
      yawRad: report.yawRad,
      recipe: "RoomEnvironment PMREM environmentIntensity 0.5 + quad DirectionalLight 2.4 from (1,8,6)*3 + ACES, g6_* envMapIntensity 0.6",
      views: [],
    };
    for (const v of report.views as Array<{ id: string; writes: unknown; full: string }>) {
      const b64 = (v.full as string).split(",")[1];
      await writeFile(path.join(OUT_DIR, "g6-threejs-" + v.id + ".png"), Buffer.from(b64, "base64"));
      (meta.views as Array<unknown>).push({ id: v.id, writes: v.writes });
    }
    await writeFile(path.join(OUT_DIR, "g6-threejs-meta.json"), JSON.stringify(meta, null, 1));
    console.log("wrote", OUT_DIR);
  } finally {
    server.close();
  }
}
main();
