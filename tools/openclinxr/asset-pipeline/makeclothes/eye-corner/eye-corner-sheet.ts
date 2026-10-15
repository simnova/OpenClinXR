/**
 * Eye-corner fill sheet (tsk_c259331546dd74df): three.js natural + neon
 * renders proving the lid-loop-derived corner fill closes the canthus
 * wedges without covering the eye.
 *
 * Rig (eye3 natural, from realism-95 eye3/final eye3.json): ACESFilmic,
 * exposure 0.3762, hemi 0.3, key 3.0 warm az38/el20, fill 1.05 cool,
 * rim 0.5, RoomEnvironment PMREM intensity 0.9, background #18211d.
 * Camera fov 24, pivot at the eye midpoint (globe bbox centres), distance
 * set so a 0.25 m head slice fills the 1024 frame; yaw views orbit the
 * camera about the pivot (the cw1-protrusion instrument's orbit).
 *
 * Passes per bake (base, fill):
 *  - natural: front, yaw +-25, +-40, blink (closure 1.0 + slit 1.0)
 *  - neon: front, yaw +-25, +-40 with body pure blue, globe+cornea
 *    magenta, lash cyan, fill bright green, everything else hidden.
 *    Aperture per eye = lash-cyan bbox per image half; G2 = blue texels
 *    strictly inside the aperture (the globe-fit-report.json neonMethod).
 *  - blink-neon (fill bake only): body natural, lash cyan, fill magenta,
 *    rest hidden. CW2 = magenta texels in the eye band OUTSIDE the
 *    dilated blink lash bbox (must be 0).
 * G1 canthus crops come from the natural pass with the neon aperture of
 * the same view: medial third = inner canthus, lateral third = outer
 * canthus; bright = r>150 g>140 b>130 (the corner-assets manifest method).
 *
 * Usage:
 *   pnpm tsx tools/.../eye-corner/eye-corner-sheet.ts \
 *     --base /abs/eye3-final.glb --fill /abs/aisha-eye-corner-fill.glb \
 *     --out /Volumes/files/openclinxr-assets/store/eye-corner
 *
 * claimScope: stills + counts proving G1/G2/CW2 on pixels.
 * notEvidenceFor: clinical_validity, production_asset_readiness.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { chromium, type Page } from "../../../evidence/lib/slotted-playwright.js";

type HeadlessBrowser = {
  newPage(options?: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

const REPO = process.cwd();
const SIZE = 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const val = i >= 0 ? process.argv[i + 1] : undefined;
  return val === undefined || val === "" ? undefined : val;
}

const BASE_ARG = arg("--base");
const FILL_ARG = arg("--fill");
const OUT_DIR = arg("--out");
if (!BASE_ARG) throw new Error("--base <path> is required");
if (!FILL_ARG) throw new Error("--fill <path> is required");
if (!OUT_DIR) throw new Error("--out <dir> is required");
const BASE_PATH: string = BASE_ARG;
const FILL_PATH: string = FILL_ARG;
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
        if (url.pathname === "/base.glb") {
          file = path.isAbsolute(BASE_PATH) ? BASE_PATH : path.join(REPO, BASE_PATH);
        } else if (url.pathname === "/fill.glb") {
          file = path.isAbsolute(FILL_PATH) ? FILL_PATH : path.join(REPO, FILL_PATH);
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
renderer.toneMappingExposure = 0.3762;
const pmrem = new THREE.PMREMGenerator(renderer);
const ENV = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const UP = new THREE.Vector3(0, 1, 0);
const YAWS = { front: 0, "yaw25": 25, "yaw-25": -25, "yaw40": 40, "yaw-40": -40 };

function rigScene(root) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18211d);
  scene.environment = ENV;
  if ("environmentIntensity" in scene) scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.3));
  const key = new THREE.DirectionalLight(0xfff1e0, 3.0);
  key.position.set(1.1570650905313733, 2.245164432635987, 1.5453805810626071);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.05);
  fill.position.set(-1.2126163882632848, 1.9084205013185103, 1.6164829997520336);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, 2.846699365357728, -1.4676840857037077);
  scene.add(rim);
  scene.add(root);
  root.updateMatrixWorld(true);
  return scene;
}

function eyePivot(root) {
  // Midpoint of the per-side globe+cornea vertex means (mesh-local rest
  // positions through the node world matrix; mm-level exactness is more
  // than a camera pivot needs). Node names do not carry globe/cornea tags
  // (the globe node is mpfb_ob_patient_aisha_body_mesh.high-poly), so
  // match both and split sides by world x sign.
  const acc = { L: [], R: [] };
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const nm = (o.name || "").toLowerCase();
    if (!nm.includes("high-poly") && !nm.includes("cornea")) return;
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      (v.x < 0 ? acc.L : acc.R).push(v.x, v.y, v.z);
    }
  });
  if (!acc.L.length || !acc.R.length) throw new Error("eye pivot needs both sides");
  const mean = (a) => new THREE.Vector3(
    a.filter((_, i) => i % 3 === 0).reduce((s, x) => s + x, 0) / (a.length / 3),
    a.filter((_, i) => i % 3 === 1).reduce((s, x) => s + x, 0) / (a.length / 3),
    a.filter((_, i) => i % 3 === 2).reduce((s, x) => s + x, 0) / (a.length / 3));
  return mean(acc.L).add(mean(acc.R)).multiplyScalar(0.5);
}

function setMorph(root, name, weight) {
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
function resetMorphs(root, names) {
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
    for (const name of names) {
      const idx = o.morphTargetDictionary[name];
      if (typeof idx === "number") o.morphTargetInfluences[idx] = 0;
    }
  });
}

const MORPHS = ["eye-left-closure", "eye-right-closure", "eye-left-slit", "eye-right-slit"];

function neonize(root, mode) {
  // Node names carry the tags (the globe node is
  // mpfb_ob_patient_aisha_body_mesh.high-poly; mesh names do not survive
  // on Object3D). Fail-closed when an expected class paints nothing.
  // mode "mask": fill white, everything else black (unlit) — a
  // depth-correct visibility mask of the fill for the G1 tissue gate.
  const counts = { fill: 0, lash: 0, eye: 0, body: 0, black: 0 };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const nm = (o.name || "").toLowerCase();
    // Runtime mesh names (multi-prim bodies arrive split):
    //   body… mpfb_ob_patient_aisha_body001[_1..7] (prim 0 = skin)
    //   globe… mpfb_ob_patient_aisha_body_meshhigh-poly
    //   cornea… openclinxr_eye_cornea_high_poly_…
    const isFill = nm.includes("corner_fill");
    const isLash = nm.includes("eyelash");
    const isEye = nm.includes("high-poly") || nm.includes("cornea");
    const isBody = nm.startsWith("mpfb_ob_patient_aisha_body001");
    let color = null;
    if (isFill) {
      color = mode === "g2" ? 0x00ff00 : mode === "cw2" ? 0xff00ff : 0xffffff;
      counts.fill++;
    }
    else if (mode === "mask") { color = 0x000000; counts.black++; }
    else if (isLash) { color = 0x00ffff; counts.lash++; }
    else if (mode === "g2" && isEye) { color = 0xff00ff; counts.eye++; }
    else if (mode === "g2" && isBody) { color = 0x0000ff; counts.body++; }
    else if (mode === "cw2" && isBody) { counts.body++; return; } // natural body stays
    else { o.visible = false; return; }
    o.visible = true;
    o.material = new THREE.MeshBasicMaterial({ color });
  });
  if (mode === "g2" && (!counts.body || !counts.eye || !counts.lash)) {
    throw new Error("neon paint missed a class: " + JSON.stringify(counts));
  }
  if (mode === "cw2" && (!counts.fill || !counts.lash)) {
    throw new Error("cw2 paint missed a class: " + JSON.stringify(counts));
  }
  if (mode === "mask" && !counts.fill) {
    throw new Error("mask paint missed the fill: " + JSON.stringify(counts));
  }
}

function snap(renderer, scene, camera) {
  root_update(scene);
  renderer.render(scene, camera);
  const cv = document.createElement("canvas");
  cv.width = ${SIZE}; cv.height = ${SIZE};
  cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
  return cv;
}
function root_update(scene) { scene.updateMatrixWorld(true); }
function pixelsOf(cv) {
  return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
}
function isCyan(r, g, b) { return r < 80 && g > 200 && b > 200; }
function isBlue(r, g, b) { return r < 80 && g < 80 && b > 200; }
function isMagenta(r, g, b) { return r > 200 && g < 80 && b > 200; }
function isGreen(r, g, b) { return r < 80 && g > 200 && b < 80; }
function isBright(r, g, b) { return r > 150 && g > 140 && b > 130; }

function lashBoxes(img) {
  // per image half (left/right of x=512): bbox of cyan texels.
  const d = img.data, W = img.width, H = img.height;
  const out = {};
  for (const half of ["L", "R"]) {
    const x0 = half === "L" ? 0 : W / 2, x1 = half === "L" ? W / 2 : W;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, n = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (isCyan(d[i], d[i + 1], d[i + 2])) {
        n++;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
    }
    out[half] = n > 0 ? { x0: mnx, x1: mxx, y0: mny, y1: mxy, n } : null;
  }
  return out;
}
function blueInside(img, box) {
  const d = img.data, W = img.width;
  let n = 0;
  for (let y = box.y0 + 1; y < box.y1; y++) for (let x = box.x0 + 1; x < box.x1; x++) {
    const i = (y * W + x) * 4;
    if (isBlue(d[i], d[i + 1], d[i + 2])) n++;
  }
  return n;
}
function brightFrac(img, box) {
  const d = img.data, W = img.width;
  let b = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    const i = (y * W + x) * 4;
    n++;
    if (isBright(d[i], d[i + 1], d[i + 2])) b++;
  }
  return n ? b / n : 0;
}
function thirds(box, W) {
  // medial third (toward image centre x=W/2) = inner canthus; lateral = outer.
  const cx = W / 2;
  const w = box.x1 - box.x0 + 1;
  const t = Math.max(1, Math.floor(w / 3));
  let inner, outer;
  if ((box.x0 + box.x1) / 2 < cx) { inner = { x0: box.x1 - t + 1, x1: box.x1 }; outer = { x0: box.x0, x1: box.x0 + t - 1 }; }
  else { inner = { x0: box.x0, x1: box.x0 + t - 1 }; outer = { x0: box.x1 - t + 1, x1: box.x1 }; }
  inner.y0 = box.y0; inner.y1 = box.y1; outer.y0 = box.y0; outer.y1 = box.y1;
  return { inner, outer };
}
function magentaOutside(img, box, dil, band) {
  const d = img.data, W = img.width;
  let n = 0;
  for (let y = band.y0; y <= band.y1; y++) for (let x = band.x0; x <= band.x1; x++) {
    const i = (y * W + x) * 4;
    if (!isMagenta(d[i], d[i + 1], d[i + 2])) continue;
    if (box && x >= box.x0 - dil && x <= box.x1 + dil && y >= box.y0 - dil && y <= box.y1 + dil) continue;
    n++;
  }
  return n;
}
function cropOf(src, box) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.getContext("2d").drawImage(src, box.x0, box.y0, w, h, 0, 0, w, h);
  return cv;
}
function dataUrl(cv) { return cv.toDataURL("image/png"); }

async function shootBake(url, bakeId, wantCW2) {
  const out = { views: {} };
  const DIST = 0.59;
  const neonBoxes = {};
  const naturalImgs = {};
  for (const pass of ["neon", "natural"]) {
    // Pure segmentation colours must survive tone mapping exactly: the
    // neon pass renders unmapped, the natural pass with the eye3 ACES rig.
    if (pass === "neon") { renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1.0; }
    else { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.3762; }
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const scene = rigScene(root);
    const pivot = eyePivot(root);
    if (pass === "neon") neonize(root, "g2");
    for (const [id, deg] of Object.entries(YAWS)) {
      resetMorphs(root, MORPHS);
      root.updateMatrixWorld(true);
      const th = (deg * Math.PI) / 180;
      const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 20);
      camera.position.set(
        pivot.x + DIST * Math.sin(th),
        pivot.y + 0.01,
        pivot.z + DIST * Math.cos(th));
      camera.lookAt(pivot);
      camera.updateMatrixWorld(true);
      const cv = snap(renderer, scene, camera);
      const img = pixelsOf(cv);
      out.views[id] = out.views[id] || {};
      if (pass === "neon") {
        const boxes = lashBoxes(img);
        neonBoxes[id] = boxes;
        const counts = {};
        for (const half of ["L", "R"]) counts[half] = boxes[half] ? blueInside(img, boxes[half]) : null;
        out.views[id].neon = { full: dataUrl(cv), boxes };
        out.views[id].g2blue = counts;
      } else {
        // G1 canthus crops reuse this view's neon aperture (same camera,
        // same lashes): medial third = inner canthus, lateral = outer.
        const g1 = {};
        const crops = {};
        const boxes = neonBoxes[id];
        for (const half of ["L", "R"]) {
          if (!boxes || !boxes[half]) { g1[half] = null; crops[half] = null; continue; }
          const t = thirds(boxes[half], ${SIZE});
          g1[half] = { inner: brightFrac(img, t.inner), outer: brightFrac(img, t.outer) };
          crops[half] = dataUrl(cropOf(cv, boxes[half]));
        }
        out.views[id].natural = { full: dataUrl(cv) };
        out.views[id].g1 = g1;
        out.views[id].crops = crops;
        naturalImgs[id] = img;
      }
      resetMorphs(root, MORPHS);
    }
    if (pass === "natural") {
      resetMorphs(root, MORPHS);
      setMorph(root, "eye-left-closure", 1.0);
      setMorph(root, "eye-right-closure", 1.0);
      setMorph(root, "eye-left-slit", 1.0);
      setMorph(root, "eye-right-slit", 1.0);
      root.updateMatrixWorld(true);
      const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 20);
      camera.position.set(pivot.x, pivot.y + 0.01, pivot.z + DIST);
      camera.lookAt(pivot);
      camera.updateMatrixWorld(true);
      const cv = snap(renderer, scene, camera);
      // blink crops reuse the front aperture frame (the closed seam sits
      // inside the open aperture; graders check the seal, not colour).
      const img = pixelsOf(cv);
      const fb = neonBoxes["front"] || {};
      const crops = {};
      for (const half of ["L", "R"]) {
        crops[half] = fb[half] ? dataUrl(cropOf(cv, fb[half])) : null;
      }
      out.views["blink"] = { natural: { full: dataUrl(cv) }, g1: null, crops };
      resetMorphs(root, MORPHS);
    }
    scene.clear();
  }
  if (wantCW2) {
    // G1 tissue gate: white-fill visibility mask per yaw view; bright
    // fraction sampled over the mask in the same-view natural render.
    renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1.0;
    {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      const scene = rigScene(root);
      const pivot = eyePivot(root);
      neonize(root, "mask");
      out.mask = {};
      for (const [id, deg] of Object.entries(YAWS)) {
        resetMorphs(root, MORPHS);
        root.updateMatrixWorld(true);
        const th = (deg * Math.PI) / 180;
        const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 20);
        camera.position.set(
          pivot.x + DIST * Math.sin(th),
          pivot.y + 0.01,
          pivot.z + DIST * Math.cos(th));
        camera.lookAt(pivot);
        camera.updateMatrixWorld(true);
        const cv = snap(renderer, scene, camera);
        const mimg = pixelsOf(cv);
        const nimg = naturalImgs[id];
        const d = mimg.data, nd = nimg.data;
        let vis = 0, br = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) {
            vis++;
            if (isBright(nd[i], nd[i + 1], nd[i + 2])) br++;
          }
        }
        out.mask[id] = { visiblePx: vis, brightFrac: vis ? br / vis : 0 };
        out.views[id].mask = { full: dataUrl(cv) };
        resetMorphs(root, MORPHS);
      }
      scene.clear();
    }
    renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1.0;
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const scene = rigScene(root);
    const pivot = eyePivot(root);
    neonize(root, "cw2");
    setMorph(root, "eye-left-closure", 1.0);
    setMorph(root, "eye-right-closure", 1.0);
    setMorph(root, "eye-left-slit", 1.0);
    setMorph(root, "eye-right-slit", 1.0);
    root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 20);
    camera.position.set(pivot.x, pivot.y + 0.01, pivot.z + DIST);
    camera.lookAt(pivot);
    camera.updateMatrixWorld(true);
    const cv = snap(renderer, scene, camera);
    const img = pixelsOf(cv);
    const boxes = lashBoxes(img);
    const band = { x0: 0, x1: ${SIZE} - 1, y0: Math.floor(${SIZE} * 0.30), y1: Math.floor(${SIZE} * 0.62) };
    const per = {};
    for (const half of ["L", "R"]) {
      per[half] = { box: boxes[half], outside: boxes[half] ? magentaOutside(img, boxes[half], 8, band) : null };
    }
    // Union semantics (the card's "outside the closed lid line", singular
    // line): magenta in the band outside BOTH dilated lash boxes. Per-half
    // counts double-flag pixels that sit inside the other half's seam.
    let unionOutside = 0;
    {
      const d = img.data;
      for (let y = band.y0; y <= band.y1; y++) for (let x = band.x0; x <= band.x1; x++) {
        const i = (y * ${SIZE} + x) * 4;
        if (!isMagenta(d[i], d[i + 1], d[i + 2])) continue;
        const inL = boxes["L"] && x >= boxes["L"].x0 - 8 && x <= boxes["L"].x1 + 8 && y >= boxes["L"].y0 - 8 && y <= boxes["L"].y1 + 8;
        const inR = boxes["R"] && x >= boxes["R"].x0 - 8 && x <= boxes["R"].x1 + 8 && y >= boxes["R"].y0 - 8 && y <= boxes["R"].y1 + 8;
        if (!inL && !inR) unionOutside++;
      }
    }
    // total magenta in band (diagnostic: sealed blink hides the fill fully)
    let total = 0;
    {
      const d = img.data;
      for (let y = band.y0; y <= band.y1; y++) for (let x = band.x0; x <= band.x1; x++) {
        const i = (y * ${SIZE} + x) * 4;
        if (isMagenta(d[i], d[i + 1], d[i + 2])) total++;
      }
    }
    out.cw2 = { full: dataUrl(cv), per, bandMagenta: total, unionOutside };
    scene.clear();
  }
  return out;
}

const base = await shootBake("/base.glb", "base", false);
const fill = await shootBake("/fill.glb", "fill", true);

// contact sheet: rows = views(natural full base|fill) with eye crops.
const VIEWS = ["front", "yaw25", "yaw-25", "yaw40", "yaw-40", "blink"];
function imgOf(dataUrl) {
  return new Promise((resolve, rej) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
}
const CELL = 512, LABELH = 30;
const rows = [];
for (const v of VIEWS) {
  for (const [bake, rec] of [["base", base], ["fill", fill]]) {
    rows.push({ label: bake + " " + v + " natural", full: await imgOf(rec.views[v].natural.full) });
  }
}
const sheet = document.createElement("canvas");
sheet.width = CELL * 2; sheet.height = rows.length * (CELL + LABELH);
const g2 = sheet.getContext("2d");
g2.fillStyle = "#18211d";
g2.fillRect(0, 0, sheet.width, sheet.height);
function blit(img, dx, dy, dw, dh, label) {
  g2.fillStyle = "#0f1613";
  g2.fillRect(dx, dy, dw, LABELH);
  g2.fillStyle = "#e8f5ef";
  g2.font = "18px Menlo, Consolas, monospace";
  g2.fillText(label, dx + 10, dy + 21);
  const s = Math.min(dw / img.width, (dh - LABELH) / img.height);
  const w = img.width * s, h = img.height * s;
  g2.drawImage(img, dx + (dw - w) / 2, dy + LABELH + (dh - LABELH - h) / 2, w, h);
}
rows.forEach((r, i) => {
  const y = i * (CELL + LABELH);
  blit(r.full, 0, y, CELL * 2, CELL + LABELH, r.label);
});
window.__report = { base, fill, sheet: dataUrl(sheet) };
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
    }).sceneCapture.withBrowser("realism-head:eye-corner-sheet", async (launched) => {
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
        throw new Error(`eye-corner sheet page never finished; pageerrors=[${errors.join(" | ").slice(0, 800)}]`);
      }
      if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ").slice(0, 500)}`);
      const report = await page.evaluate(
        () => (globalThis as unknown as { __report: unknown }).__report as {
          base: {
            views: Record<string, {
              neon?: { full: string; boxes: Record<string, { x0: number; x1: number; y0: number; y1: number; n: number } | null> };
              natural: { full: string };
              g2blue?: Record<string, number | null>;
            }>;
          };
          fill: {
            views: Record<string, {
              neon?: { full: string; boxes: Record<string, { x0: number; x1: number; y0: number; y1: number; n: number } | null> };
              natural: { full: string };
              g2blue?: Record<string, number | null>;
            }>;
            cw2: { full: string; per: Record<string, { box: unknown; outside: number | null }>; bandMagenta: number };
          };
          sheet: string;
        },
      );
      await mkdir(OUT_PATH, { recursive: true });
      const VIEWS = ["front", "yaw25", "yaw-25", "yaw40", "yaw-40", "blink"];
      const record: Record<string, unknown> = { views: {}, g1: {}, crops: {}, cw2: null, renderer: "three.js natural + neon" };
      for (const [bake, rec] of [["base", report.base], ["fill", report.fill]] as const) {
        for (const v of VIEWS) {
          const nat = rec.views[v].natural.full.split(",", 2)[1];
          if (nat === undefined) throw new Error(`${bake}-${v} natural missing payload`);
          await writeFile(path.join(OUT_PATH, `eyecorner-natural-${bake}-${v}.png`), Buffer.from(nat, "base64"));
          const r = rec.views[v] as { crops?: Record<string, string | null>; g1?: unknown };
          for (const half of ["L", "R"]) {
            const crop = r.crops?.[half]?.split(",", 2)[1];
            if (crop === undefined || crop === null) throw new Error(`${bake}-${v}-${half} crop missing`);
            await writeFile(path.join(OUT_PATH, `eyecorner-crop-${bake}-${v}-${half}.png`), Buffer.from(crop, "base64"));
          }
          if (v !== "blink") {
            const neo = rec.views[v].neon?.full.split(",", 2)[1];
            if (neo === undefined) throw new Error(`${bake}-${v} neon missing payload`);
            await writeFile(path.join(OUT_PATH, `eyecorner-neon-${bake}-${v}.png`), Buffer.from(neo, "base64"));
          }
        }
        (record.views as Record<string, unknown>)[bake] = Object.fromEntries(
          Object.entries(rec.views).map(([v, r]) => [v, { g2blue: (r as { g2blue?: unknown }).g2blue ?? null }]),
        );
        (record.g1 as Record<string, unknown>)[bake] = Object.fromEntries(
          Object.entries(rec.views).map(([v, r]) => [v, (r as { g1?: unknown }).g1 ?? null]),
        );
      }
      const cw2png = report.fill.cw2.full.split(",", 2)[1];
      if (cw2png === undefined) throw new Error("cw2 missing payload");
      await writeFile(path.join(OUT_PATH, "eyecorner-blink-neon-fill.png"), Buffer.from(cw2png, "base64"));
      record.cw2 = {
        per: report.fill.cw2.per,
        bandMagenta: report.fill.cw2.bandMagenta,
        unionOutside: (report.fill.cw2 as { unionOutside?: unknown }).unionOutside ?? null,
      };
      const maskRec: Record<string, unknown> = {};
      for (const v of ["front", "yaw25", "yaw-25", "yaw40", "yaw-40"]) {
        const mfull = (report.fill.views[v] as { mask?: { full: string } }).mask?.full.split(",", 2)[1];
        if (mfull === undefined) throw new Error(`${v} mask missing payload`);
        await writeFile(path.join(OUT_PATH, `eyecorner-mask-fill-${v}.png`), Buffer.from(mfull, "base64"));
        maskRec[v] = (report.fill as unknown as { mask: Record<string, unknown> }).mask[v];
      }
      record.mask = maskRec;
      // apertures: neon lash boxes per bake per view (node-side needs them for crops/G1).
      const apertures: Record<string, unknown> = {};
      for (const [bake, rec] of [["base", report.base], ["fill", report.fill]] as const) {
        apertures[bake] = Object.fromEntries(
          Object.entries(rec.views)
            .filter(([v]) => v !== "blink")
            .map(([v, r]) => [v, (r as { neon?: { boxes: unknown } }).neon?.boxes ?? null]),
        );
      }
      record.apertures = apertures;
      const sheetB64 = report.sheet.split(",", 2)[1];
      if (sheetB64 === undefined) throw new Error("sheet missing payload");
      await writeFile(path.join(OUT_PATH, "eye-corner-sheet.png"), Buffer.from(sheetB64, "base64"));
      // sha256 of every written PNG for the derive-report assets table.
      const { createHash: ch } = await import("node:crypto");
      const { readdir, readFile: rf } = await import("node:fs/promises");
      const assets: Record<string, string> = {};
      for (const f of await readdir(OUT_PATH)) {
        if (!f.endsWith(".png")) continue;
        assets[f] = ch("sha256").update(await rf(path.join(OUT_PATH, f))).digest("hex");
      }
      record.pngSha256 = assets;
      record.baseSha256 = createHash("sha256").update(await readFile(BASE_PATH)).digest("hex");
      record.fillSha256 = createHash("sha256").update(await readFile(FILL_PATH)).digest("hex");
      await writeFile(path.join(OUT_PATH, "eye-corner-sheet-record.json"), `${JSON.stringify(record, null, 1)}\n`);
      console.log(JSON.stringify({ views: record.views, cw2: record.cw2 }, null, 1));
    });
  } finally {
    server.close();
  }
}

await main();
