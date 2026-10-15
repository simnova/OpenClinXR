/**
 * Shell yaw sheet (shellrebind2): yaw-pair + front + blink-closed stills.
 *
 * Loads the BOUND shell GLB (shell + tearline carry the six lid morphs) in an
 * isolated three.js page (no room, no studio) and renders 1280 stills:
 * front open, yaw +25 open, yaw -25 open, front blink-closed
 * (eye-left/right-closure at 1.0 on every mesh carrying them: body + shell +
 * tearline). Composes shadow-yaw-sheet.png (yaw+25 | yaw-25, 2560x1280).
 *
 * Fail-closed: the shell and tearline meshes must each accept the L+R
 * closure writes at 1.0, else the page throws and no PNG is written.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/realism-head/shell/shell-sheet-capture.ts \
 *     --glb /abs/path/aisha-shell-b2b3.glb --out /abs/path/out-dir
 *
 * claimScope: yaw-pair stills proving the lid-bound shell/tearline stills.
 * notEvidenceFor: clinical_validity, production_asset_readiness.
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

const GLB_ARG = arg("--glb");
const OUT_DIR = arg("--out");
if (!GLB_ARG) throw new Error("--glb <path> is required");
if (!OUT_DIR) throw new Error("--out <dir> is required");
const GLB_PATH: string = GLB_ARG;
const OUT_PATH: string = OUT_DIR;
// Baseline (pre-bind) GLBs legitimately carry no shell/tearline: --baseline
// renders the same stills but skips the lid-bind write assertion.
const BASELINE = process.argv.includes("--baseline");
// Same-GLB control: --hide-shell renders the bound GLB with the shell and
// tearline hidden, isolating the shell's own pixels from any rebake drift.
const HIDE_SHELL = process.argv.includes("--hide-shell");
// --shell-only: hide every mesh except shell/tearline (visibility probe).
const SHELL_ONLY = process.argv.includes("--shell-only");
// --shell-globe-only: hide every mesh except shell/tearline + eye globes
// (depth-conflict bisect: shell-only draws; full scene shows zero delta).
const SHELL_GLOBE_ONLY = process.argv.includes("--shell-globe-only");

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
function snap(yawDeg) {
  root.rotation.y = yawDeg * Math.PI / 180;
  root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const cv = document.createElement("canvas");
  cv.width = ${SIZE}; cv.height = ${SIZE};
  cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  return cv;
}

// Visibility flags apply BEFORE any still renders (open, yaw, closed).
const BASELINE_FLAG = ${BASELINE};
const HIDE_SHELL_FLAG = ${HIDE_SHELL};
const SHELL_ONLY_FLAG = ${SHELL_ONLY};
const SHELL_GLOBE_ONLY_FLAG = ${SHELL_GLOBE_ONLY};
if (HIDE_SHELL_FLAG) {
  root.traverse((o) => {
    if (o.isMesh && /occlusion_shell|tearline/i.test(o.name)) o.visible = false;
  });
  root.updateMatrixWorld(true);
  const hiddenCount = [];
  root.traverse((o) => {
    if (o.isMesh && o.visible === false) hiddenCount.push(o.name);
  });
  window.__hidden = hiddenCount;
}
// OPEN stills: all closure at 0.
drive(0);
const frontOpen = snap(0);
const yawP25 = snap(25);
const yawM25 = snap(-25);

// CLOSED: blink shut (body + shell + tearline).
const closedWritten = drive(1.0);
const frontClosed = snap(0);

// Fail-closed: shell and tearline must each carry both closure targets at 1.0
// (skipped with --baseline: the pre-bind GLB has no shell by design).
if (SHELL_GLOBE_ONLY_FLAG) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.visible = /occlusion_shell|tearline|high-poly/i.test(o.name);
    }
  });
  root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const bisCv = document.createElement("canvas");
  bisCv.width = ${SIZE}; bisCv.height = ${SIZE};
  bisCv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  const bpx = bisCv.getContext("2d").getImageData(0, 0, ${SIZE}, ${SIZE}).data;
  let bNonBg = 0;
  for (let i = 0; i < bpx.length; i += 4) {
    if (Math.abs(bpx[i] - 0x18) > 2 || Math.abs(bpx[i + 1] - 0x21) > 2 || Math.abs(bpx[i + 2] - 0x1d) > 2) bNonBg++;
  }
  window.__probe = { bisect: "shell+globes", nonBgPixels: bNonBg, shot: bisCv.toDataURL("image/png") };
  window.__done = true;
} else if (SHELL_ONLY_FLAG) {
  const info = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const keep = /occlusion_shell|tearline/i.test(o.name);
    o.visible = keep;
    if (keep) {
      const m = o.material;
      info.push({
        mesh: o.name,
        matType: m.type,
        transparent: m.transparent,
        opacity: m.opacity,
        vertexColors: m.vertexColors,
        side: m.side,
        depthTest: m.depthTest,
        depthWrite: m.depthWrite,
        morphTargets: o.morphTargetDictionary ? Object.keys(o.morphTargetDictionary) : null,
        geoAttrs: Object.keys(o.geometry.attributes),
        vertCount: o.geometry.attributes.position.count,
      });
    }
  });
  root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const probeCv = document.createElement("canvas");
  probeCv.width = ${SIZE}; probeCv.height = ${SIZE};
  probeCv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  const px = probeCv.getContext("2d").getImageData(0, 0, ${SIZE}, ${SIZE}).data;
  let nonBg = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - 0x18) > 2 || Math.abs(px[i + 1] - 0x21) > 2 || Math.abs(px[i + 2] - 0x1d) > 2) nonBg++;
  }
  window.__probe = { shellOnlyInfo: info, nonBgPixels: nonBg, shot: probeCv.toDataURL("image/png") };
  window.__done = true;
} else {
for (const re of [/occlusion_shell/, /tearline/]) {
  const got = closedWritten.filter((w) => re.test(w.mesh));
  if (!BASELINE_FLAG && (got.length < 2 || got.some((w) => w.influence !== 1))) {
    throw new Error("lid-bound mesh did not accept L+R closure at 1.0 (" + re + "): " + JSON.stringify(got));
  }
}

// Yaw-pair sheet: yaw+25 | yaw-25.
const sheet = document.createElement("canvas");
sheet.width = ${SIZE} * 2; sheet.height = ${SIZE};
const g = sheet.getContext("2d");
g.fillStyle = "#18211d";
g.fillRect(0, 0, sheet.width, sheet.height);
g.drawImage(yawP25, 0, 0);
g.drawImage(yawM25, ${SIZE}, 0);

function dataUrl(cv) { return cv.toDataURL("image/png"); }
window.__report = {
  shellClosedWrites: closedWritten.filter((w) => /occlusion_shell/.test(w.mesh)),
  tearClosedWrites: closedWritten.filter((w) => /tearline/.test(w.mesh)),
  bodyClosedWrites: closedWritten.length
    - closedWritten.filter((w) => /occlusion_shell|tearline/.test(w.mesh)).length,
  renderer: renderer.getContext().getParameter(renderer.getContext().VERSION),
  frontOpen: dataUrl(frontOpen),
  yawP25: dataUrl(yawP25),
  yawM25: dataUrl(yawM25),
  frontClosed: dataUrl(frontClosed),
  sheet: dataUrl(sheet),
  hidden: (window.__hidden ?? null),
};
window.__done = true;
} // end non-probe path
</script></body></html>`;

type Shot = { name: string; dataUrl: string };

async function main(): Promise<void> {
  const { server, port } = await startStatic();
  try {
    // Browser launch goes through the compute-services facade
    // (sceneCapture.withBrowser), never a direct chromium.launch: the
    // direct-compute-launch freeze counts direct sites. browserLaunch
    // injection keeps the exact launch flags, so the render stays
    // bit-identical; the launch itself runs inside the facade.
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("realism-head:shell-sheet", async (launched) => {
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
      throw new Error(`shell sheet page never finished (${seen}); pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
    const probe = await page.evaluate(() => (globalThis as unknown as { __probe?: unknown }).__probe as
      { shellOnlyInfo: unknown; nonBgPixels: number; shot: string } | undefined);
    if (probe) {
      await mkdir(OUT_PATH, { recursive: true });
      const b64 = probe.shot.split(",", 2)[1];
      if (b64 === undefined) throw new Error("probe shot data URL has no payload");
      await writeFile(path.join(OUT_PATH, "shell-only-probe.png"), Buffer.from(b64, "base64"));
      console.log(JSON.stringify({ probe: { shellOnlyInfo: probe.shellOnlyInfo, nonBgPixels: probe.nonBgPixels } }, null, 2));
      return;
    }
    const report = await page.evaluate(() => (globalThis as unknown as { __report: unknown }).__report as {
      shellClosedWrites: unknown[];
      tearClosedWrites: unknown[];
      bodyClosedWrites: number;
      renderer: string;
      hidden: unknown;
      frontOpen: string;
      yawP25: string;
      yawM25: string;
      frontClosed: string;
      sheet: string;
    });
    await mkdir(OUT_PATH, { recursive: true });
    const shots: Shot[] = [
      { name: "shell-fixed-front.png", dataUrl: report.frontOpen },
      { name: "shell-fixed-yaw25.png", dataUrl: report.yawP25 },
      { name: "shell-fixed-yaw-25.png", dataUrl: report.yawM25 },
      { name: "shell-fixed-closed.png", dataUrl: report.frontClosed },
      { name: "shadow-yaw-sheet.png", dataUrl: report.sheet },
    ];
    for (const s of shots) {
      const b64 = s.dataUrl.split(",", 2)[1];
      if (b64 === undefined) throw new Error(`${s.name} data URL has no payload`);
      await writeFile(path.join(OUT_PATH, s.name), Buffer.from(b64, "base64"));
    }
    console.log(JSON.stringify({
      out: OUT_PATH,
      renderSize: SIZE,
      hidden: report.hidden ?? null,
      shellClosedWrites: report.shellClosedWrites,
      tearClosedWrites: report.tearClosedWrites,
      bodyClosedWrites: report.bodyClosedWrites,
      renderer: report.renderer,
    }, null, 2));
    });
  } finally {
    server.close();
  }
}

await main();
