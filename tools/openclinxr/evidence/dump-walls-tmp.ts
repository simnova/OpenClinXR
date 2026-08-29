import { chromium } from "playwright";
import {
  buildRoomCaptureUrl,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const EVAL = `(() => {
  const scene = window.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return null;
  scene.updateMatrixWorld(true);
  let roomRoot = null;
  scene.traverse(function (o) {
    if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
  });
  if (!roomRoot) return null;
  const worldOfLocal = function (e, x, y, z) {
    return [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]
    ];
  };
  const out = [];
  roomRoot.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const geom = o.geometry;
    const pos = geom && geom.attributes && geom.attributes.position;
    if (!pos) return;
    const e = o.matrixWorld && o.matrixWorld.elements;
    if (!e) return;
    const arr = pos.array;
    const count = pos.count;
    // sample every vertex, group into small summary: min/max world + a few sample vertices
    let min=[1e9,1e9,1e9], max=[-1e9,-1e9,-1e9];
    const samples=[];
    for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 12))) {
      const p = worldOfLocal(e, arr[i*3], arr[i*3+1], arr[i*3+2]);
      for (let c = 0; c < 3; c++) { if (p[c] < min[c]) min[c] = p[c]; if (p[c] > max[c]) max[c] = p[c]; }
      samples.push(p.map(v=>+v.toFixed(2)));
    }
    out.push({ name: o.name || "(unnamed)", verts: count, min: min.map(v=>+v.toFixed(2)), max: max.map(v=>+v.toFixed(2)), samples });
  });
  return out;
})()`;

async function main() {
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(buildRoomCaptureUrl(server.url, "ed_stroke_alert_handoff_v1", "scene-overview"), { waitUntil: "load", timeout: 180_000 });
      await waitForStationShell(page, 180_000);
      await waitForHumanoidAssetsLoaded(page, 180_000);
      const inv = await page.evaluate(EVAL);
      console.log(JSON.stringify(inv, null, 1));
    } finally {
      await page.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
