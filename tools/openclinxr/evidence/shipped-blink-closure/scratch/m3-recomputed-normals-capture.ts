/**
 * h1/M3: shipped blink take (closure 1.0 + slit 1.0) rendered twice — baseline
 * vs with normals recomputed from the morphed positions (CPU-baked morph
 * displacements, influences zeroed, computeVertexNormals). Evidence-only;
 * no GLB writes. Runs only because M2-raster put the dark pixels on
 * front-facing lid skin, which under shadowless N.L lighting implicates the
 * normal channel.
 *
 * Framing/lights/morph drive copied verbatim from
 * tools/openclinxr/evidence/realism-head/eyes/eye-sheet-capture.ts.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/shipped-blink-closure/scratch/m3-recomputed-normals-capture.ts \
 *     --shipped /abs/mpfb-ob-patient-aisha.glb --realism /abs/aisha-realism.glb \
 *     --out /abs/h1-dir
 */
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
const SHIPPED_ARG = arg("--shipped");
const REALISM_ARG = arg("--realism");
const OUT_DIR = arg("--out");
if (!SHIPPED_ARG) throw new Error("--shipped <path> is required");
if (!REALISM_ARG) throw new Error("--realism <path> is required");
if (!OUT_DIR) throw new Error("--out <dir> is required");
const SHIPPED_PATH: string = SHIPPED_ARG;
const REALISM_PATH: string = REALISM_ARG;
const OUT_PATH: string = OUT_DIR;

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
        if (url.pathname === "/shipped.glb") {
          file = path.isAbsolute(SHIPPED_PATH) ? SHIPPED_PATH : path.join(REPO, SHIPPED_PATH);
        } else if (url.pathname === "/realism.glb") {
          file = path.isAbsolute(REALISM_PATH) ? REALISM_PATH : path.join(REPO, REALISM_PATH);
        } else if (url.pathname.startsWith("/three/")) {
          file = path.join(REPO, "node_modules/three", url.pathname.slice("/three/".length));
        } else {
          res.writeHead(404);
          res.end("no");
          return;
        }
        const data = await readFile(file);
        const ext = path.extname(file);
        const mime = ext === ".glb" ? "model/gltf-binary" : "text/javascript";
        res.writeHead(200, { "content-type": mime });
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

async function shoot(url, hideGlobe, recomputeNormals) {
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

  let closureMeshes = 0, slitMeshes = 0;
  const hidden = [];
  const allNames = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    allNames.push(o.name);
    // Globe objects are the skinned eye meshes: shipped body meshlow-poly,
    // realism body meshhigh-poly (globe mesh on node 142; cornea nodes
    // 148/149 are orphans outside the default scene, so no three.js render
    // ever showed them). Brows/lashes contain neither token.
    const nm = (o.name || "").toLowerCase();
    if (hideGlobe && (nm.includes("meshlow-poly") || nm.includes("meshhigh-poly"))) {
      o.visible = false;
      hidden.push(o.name);
    }
    if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const [target, kind] of [["eye-left-closure","c"],["eye-right-closure","c"],["eye-left-slit","s"],["eye-right-slit","s"]]) {
      const idx = o.morphTargetDictionary[target];
      if (typeof idx !== "number") continue;
      o.morphTargetInfluences[idx] = 1.0;
      if (o.morphTargetInfluences[idx] !== 1.0) throw new Error("write did not read back: " + target);
      if (kind === "c") closureMeshes++; else slitMeshes++;
    }
  });
  if (closureMeshes === 0) throw new Error("no closure target found: " + url);
  if (hideGlobe && hidden.length === 0) throw new Error("hideGlobe set but no globe mesh hidden: " + url);
  let recomputed = 0;
  if (recomputeNormals) {
    // Evidence-only: bake the SAME closure+slit displacements into the base
    // positions on the CPU, drop the morph influences (positions and normals),
    // and recompute smooth normals from the morphed surface. No GLB write.
    root.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences || !o.geometry.morphAttributes) return;
      const pos = o.geometry.attributes.position;
      const mp = o.geometry.morphAttributes.position || [];
      const mn = o.geometry.morphAttributes.normal || [];
      const dict = o.morphTargetDictionary;
      const inf = o.morphTargetInfluences;
      const targets = ["eye-left-closure", "eye-right-closure", "eye-left-slit", "eye-right-slit"];
      let touched = false;
      const v = new THREE.Vector3();
      for (const t of targets) {
        const idx = dict[t];
        if (typeof idx !== "number" || !mp[idx]) continue;
        const w = inf[idx];
        if (w === 0) continue;
        const disp = mp[idx];
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(disp, i);
          pos.setXYZ(i, pos.getX(i) + v.x * w, pos.getY(i) + v.y * w, pos.getZ(i) + v.z * w);
        }
        touched = true;
      }
      if (!touched) return;
      pos.needsUpdate = true;
      for (let i = 0; i < inf.length; i++) inf[i] = 0;
      o.geometry.computeVertexNormals();
      recomputed++;
    });
    if (recomputed === 0) throw new Error("recomputeNormals set but no morphed mesh baked: " + url);
  }
  root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const cv = document.createElement("canvas");
  cv.width = ${SIZE}; cv.height = ${SIZE};
  cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  return { png: cv.toDataURL("image/png"), closureMeshes, slitMeshes, hidden, allNames, recomputed };
}

const takes = [
  { subject: "shipped", url: "/shipped.glb", hideGlobe: false, recomputeNormals: false },
  { subject: "shipped", url: "/shipped.glb", hideGlobe: false, recomputeNormals: true },
];
const views = [];
for (const t of takes) {
  const r = await shoot(t.url, t.hideGlobe, t.recomputeNormals);
  views.push({ subject: t.subject, hideGlobe: t.hideGlobe, recomputeNormals: t.recomputeNormals, ...r });
}
window.__report = { views: views.map((v) => ({ subject: v.subject, hideGlobe: v.hideGlobe, recomputeNormals: v.recomputeNormals, closureMeshes: v.closureMeshes, slitMeshes: v.slitMeshes, hidden: v.hidden, recomputed: v.recomputed, full: v.png })) };
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
    }).sceneCapture.withBrowser("shipped-blink-closure:m3", async (launched) => {
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
          () => (globalThis as unknown as { __done?: boolean }).__done === true,
          null,
          { timeout: 240_000 },
        );
        await handle.jsonValue();
      } catch {
        throw new Error(`m3 page never finished; pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
      }
      if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
      const report = await page.evaluate(
        () => (globalThis as unknown as { __report: unknown }).__report as {
          views: Array<{ subject: string; hideGlobe: boolean; recomputeNormals: boolean; closureMeshes: number; slitMeshes: number; hidden: string[]; recomputed: number; full: string }>;
        },
      );
      await mkdir(OUT_PATH, { recursive: true });
      for (const v of report.views) {
        const b64 = v.full.split(",", 2)[1];
        if (b64 === undefined) throw new Error(`m3 recompute=${v.recomputeNormals} data URL has no payload`);
        const name = v.recomputeNormals ? "m3-shipped-blink-recomputed-normals-full.png" : "m3-shipped-blink-baseline-full.png";
        await writeFile(path.join(OUT_PATH, name), Buffer.from(b64, "base64"));
      }
      await writeFile(
        path.join(OUT_PATH, "m3-record.json"),
        `${JSON.stringify(report.views.map((v) => ({ subject: v.subject, recomputeNormals: v.recomputeNormals, closureMeshes: v.closureMeshes, slitMeshes: v.slitMeshes, recomputed: v.recomputed })), null, 2)}\n`,
      );
      console.log(JSON.stringify(report.views.map((v) => ({ subject: v.subject, recomputeNormals: v.recomputeNormals, closureMeshes: v.closureMeshes, slitMeshes: v.slitMeshes, recomputed: v.recomputed })), null, 2));
    });
  } finally {
    server.close();
  }
}

await main();
