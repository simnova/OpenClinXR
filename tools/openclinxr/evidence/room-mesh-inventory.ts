/**
 * TEMPORARY DEBUG PROBE (delete before commit) — inventory EVERY mesh under
 * openclinxr.station-environment.infinigen-room: name, ancestor names up to roomRoot,
 * triangle count, world bounds, visible. Identifies what pollutes the camera's
 * per-triangle occlusion test.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  buildRoomCaptureUrl,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const VIEWPORT = { width: 1440, height: 900 };

const EVAL = `(() => {
  const scene = window.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return null;
  scene.updateMatrixWorld(true);
  let roomRoot = null;
  scene.traverse(function (o) {
    if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
  });
  if (!roomRoot) return null;

  const worldBoxOf = function (obj) {
    const geom = obj.geometry;
    if (!geom) return null;
    if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const e = obj.matrixWorld && obj.matrixWorld.elements;
    if (!bb || !e) return null;
    const xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
    let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      const x = xs[i], y = ys[j], z = zs[k];
      const p = [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14]
      ];
      for (let c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
    }
    return isFinite(a[0]) ? { min: a, max: b } : null;
  };

  const out = [];
  roomRoot.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const geom = o.geometry;
    const pos = geom && geom.attributes && geom.attributes.position;
    const arr = pos ? pos.array : null;
    const triCount = arr ? Math.floor(arr.length / 9) : 0;
    const ancestors = [];
    let p = o.parent;
    while (p && p !== roomRoot && ancestors.length < 5) {
      ancestors.push(p.name || "(unnamed)");
      p = p.parent;
    }
    out.push({
      name: o.name || "(unnamed)",
      visible: o.visible !== false,
      kind: (o.name || "").match(/wall|floor|ceiling|exterior/i)?.[0] || "",
      ancestors: ancestors,
      tris: triCount,
      box: worldBoxOf(o) ? { min: worldBoxOf(o).min.map(v=>+v.toFixed(2)), max: worldBoxOf(o).max.map(v=>+v.toFixed(2)) } : null
    });
  });
  return out;
})()`;

async function main(): Promise<void> {
  const station = process.argv.find((a) => a.startsWith("--station="))?.split("=")[1] ?? "ed_stroke_alert_handoff_v1";
  const out = process.argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") ?? "/tmp/room-inventory.json";
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(buildRoomCaptureUrl(server.url, station, "scene-overview"), { waitUntil: "load", timeout: 180_000 });
      await waitForStationShell(page, 180_000);
      await waitForHumanoidAssetsLoaded(page, 180_000);
      const inv = await page.evaluate(EVAL);
      writeFileSync(out, JSON.stringify(inv, null, 2));
      console.log(JSON.stringify(inv, null, 1).slice(0, 6000));
    } finally {
      await page.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
