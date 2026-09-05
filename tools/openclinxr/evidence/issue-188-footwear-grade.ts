/**
 * #188 footwear grade — lit three.js contact sheet of lower legs/feet for all 7 humanoids.
 *
 * Named instrument: product three.js GLTFLoader via portless ui-xr (not a point cloud).
 * Camera framed on the bottom ~25% of each figure (feet + lower shins).
 *
 * claimScope: appearance grade artifact for orchestrator pixel review.
 * notEvidenceFor: clinical costume realism, production readiness.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { SHIPPED_HUMANOID_GLBS } from "./actor-footwear-presence.js";

const OUT_DIR = ".openclinxr/evidence/issue-188";
const OUT_PNG = path.join(OUT_DIR, "footwear-grade.png");
const CELL_W = 360;
const CELL_H = 420;
const COLS = 4;

async function main(): Promise<void> {
  const cwd = process.cwd();
  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    cwd,
    readyTimeoutMs: 180_000,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: CELL_W * COLS, height: CELL_H * 2 + 80 },
    });
    // Land on the Vite origin first so import maps resolve /node_modules/three.
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const glbUrls = SHIPPED_HUMANOID_GLBS.map(
      (name) => new URL(`generated-humanoids/${name}`, server.url).toString(),
    );
    const labels = SHIPPED_HUMANOID_GLBS.map((n) => n.replace(/\.glb$/, ""));

    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"/>
      <style>
        html,body{margin:0;background:#101816;color:#e8f5ef;font:14px/1.3 Menlo,Consolas,monospace}
        #sheet{display:grid;grid-template-columns:repeat(${COLS},${CELL_W}px);gap:0;width:${COLS * CELL_W}px}
        .cell{width:${CELL_W}px;height:${CELL_H}px;position:relative;background:#18211d;border:1px solid #24302b}
        .cell canvas{display:block;width:100%;height:100%}
        .lab{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;background:rgba(0,0,0,.55);font-size:11px}
        h1{margin:8px 12px;font-size:14px;font-weight:600}
      </style>
      <script type="importmap">
      {"imports":{
        "three":${JSON.stringify(new URL("node_modules/three/build/three.module.js", server.url).toString())},
        "three/addons/":${JSON.stringify(new URL("node_modules/three/examples/jsm/", server.url).toString())}
      }}
      </script>
      </head><body>
      <h1>#188 footwear-grade — lit three.js, lower legs / feet (all seven)</h1>
      <div id="sheet"></div>
      <script type="module">
      import * as THREE from 'three';
      import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
      const urls = ${JSON.stringify(glbUrls)};
      const labels = ${JSON.stringify(labels)};
      const sheet = browserPageDocument.getElementById('sheet');
      const loader = new GLTFLoader();
      const W = ${CELL_W}, H = ${CELL_H};

      async function renderOne(url, label) {
        const cell = browserPageDocument.createElement('div');
        cell.className = 'cell';
        const canvas = browserPageDocument.createElement('canvas');
        canvas.width = W; canvas.height = H;
        cell.appendChild(canvas);
        const lab = browserPageDocument.createElement('div');
        lab.className = 'lab';
        lab.textContent = label;
        cell.appendChild(lab);
        sheet.appendChild(cell);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(W, H, false);
        renderer.setClearColor(0x18211d);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xdceee6, 1.35));
        const key = new THREE.DirectionalLight(0xffffff, 2.1);
        key.position.set(2.4, 4.0, 3.2); scene.add(key);
        const fill = new THREE.DirectionalLight(0xb6d8ca, 1.0);
        fill.position.set(-2.8, 1.6, -1.8); scene.add(fill);
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshStandardMaterial({ color: 0x2a3a34, roughness: 0.92 }),
        );
        ground.rotation.x = -Math.PI / 2;
        scene.add(ground);

        const gltf = await loader.loadAsync(url);
        const root = gltf.scene;
        scene.add(root);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // Frame lower legs/feet: look at bottom 22% of body height.
        const footY = box.min.y + size.y * 0.08;
        const look = new THREE.Vector3(center.x, footY, center.z);
        const cam = new THREE.PerspectiveCamera(32, W / H, 0.01, 50);
        const dist = Math.max(size.x, size.z, size.y * 0.22) * 3.1;
        cam.position.set(look.x + dist * 0.55, look.y + dist * 0.35, look.z + dist * 0.95);
        cam.lookAt(look);
        renderer.render(scene, cam);
        return { label, ok: true, height: size.y };
      }

      const results = [];
      for (let i = 0; i < urls.length; i++) {
        try {
          results.push(await renderOne(urls[i], labels[i]));
        } catch (e) {
          results.push({ label: labels[i], ok: false, err: String(e) });
        }
      }
      browserPageWindow.__footwearGrade = { ready: true, results };
      </script></body></html>`,
      { waitUntil: "load" },
    );
    // Surface module errors instead of a silent 180s hang.
    page.on("pageerror", (err) => console.error("[pageerror]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[console.error]", msg.text());
    });

    await page.waitForFunction(
      () => Boolean((browserPageWindow as unknown as { __footwearGrade?: { ready?: boolean } }).__footwearGrade?.ready),
      null,
      { timeout: 180_000 },
    );
    const report = await page.evaluate(
      () => (browserPageWindow as unknown as { __footwearGrade: { results: unknown[] } }).__footwearGrade,
    );
    mkdirSync(path.join(cwd, OUT_DIR), { recursive: true });
    const outAbs = path.join(cwd, OUT_PNG);
    await page.locator("body").screenshot({ path: outAbs, type: "png" });
    writeFileSync(
      path.join(cwd, OUT_DIR, "footwear-grade-meta.json"),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), report, out: OUT_PNG }, null, 2)}\n`,
    );
    console.log("footwear-grade written", outAbs, "bytes", (await import("node:fs")).statSync(outAbs).size);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
