/**
 * TEMPORARY DEBUG PROBE (delete before commit) — for ed_stroke, report per-candidate:
 * score, rejection REASON (door / wall-partition / per-triangle hit with hit point),
 * plus live panel/room facts and viewport luminance details.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  buildRoomCaptureUrl,
  readInfinigenRoomLiveFacts,
  reframeCameraForRoom,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const VIEWPORT = { width: 1440, height: 900 };
const REGION = { left: 0, top: 70 / 900, width: 1005 / 1440, height: 750 / 900 };

const EVAL = `(() => {
  const scene = window.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return null;
  scene.updateMatrixWorld(true);

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
  const grow = function (acc, box) {
    if (!box) return acc;
    if (!acc) return { min: box.min.slice(), max: box.max.slice() };
    for (let c = 0; c < 3; c++) {
      if (box.min[c] < acc.min[c]) acc.min[c] = box.min[c];
      if (box.max[c] > acc.max[c]) acc.max[c] = box.max[c];
    }
    return acc;
  };

  let roomRoot = null;
  scene.traverse(function (o) {
    if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
  });
  if (!roomRoot) return null;

  let interior = null, exterior = null;
  roomRoot.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const box = worldBoxOf(o);
    if (/exterior/i.test(o.name || "")) exterior = grow(exterior, box);
    else interior = grow(interior, box);
  });
  if (!interior) return null;

  let actors = null;
  scene.traverse(function (o) {
    if (!o.isSkinnedMesh) return;
    actors = grow(actors, worldBoxOf(o));
  });
  if (!actors) return null;

  const actorBoxes = [];
  scene.traverse(function (o) {
    if (!o.isSkinnedMesh) return;
    const box = worldBoxOf(o);
    if (box) actorBoxes.push(box);
  });

  const wallThickness = exterior ? Math.max(0, exterior.max[2] - interior.max[2]) : 0;
  const look = [
    (actors.min[0] + actors.max[0]) / 2,
    (actors.min[1] + actors.max[1]) / 2,
    (actors.min[2] + actors.max[2]) / 2
  ];
  const zEye = interior.max[2] - 2 * wallThickness;
  const xLeft = interior.min[0] + 2 * wallThickness;
  const xRight = interior.max[0] - 2 * wallThickness;
  const candidates = [
    [xLeft, zEye], [xRight, zEye], [(xLeft + xRight) / 2, zEye],
    [(xLeft + (xLeft + xRight) / 2) / 2, zEye], [((xLeft + xRight) / 2 + xRight) / 2, zEye]
  ];

  const nearestActorDistance = function (x, z) {
    let best = Infinity;
    for (let i = 0; i < actorBoxes.length; i++) {
      const b = actorBoxes[i];
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
      const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < best) best = d;
    }
    return best;
  };

  const worldOfLocal = function (e, x, y, z) {
    return [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]
    ];
  };
  const roomSurfaceKind = function (mesh) {
    let p = mesh;
    while (p && p !== roomRoot) {
      const m = /(wall|floor|ceiling|exterior)/i.exec(p.name || "");
      if (m) return m[1].toLowerCase();
      p = p.parent;
    }
    return null;
  };
  const wallPartitionBoxes = [];
  const surfaceTris = [];
  const triOrigins = [];
  roomRoot.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    if (o.visible === false) return;
    const kind = roomSurfaceKind(o);
    if (!kind) return;
    if (kind === "wall") {
      const box = worldBoxOf(o);
      if (!box) return;
      let containsCandidate = false;
      for (let ci = 0; ci < candidates.length; ci++) {
        const cx = candidates[ci][0], cy = actors.max[1], cz = candidates[ci][1];
        if (cx >= box.min[0] && cx <= box.max[0]
          && cy >= box.min[1] && cy <= box.max[1]
          && cz >= box.min[2] && cz <= box.max[2]) {
          containsCandidate = true;
          break;
        }
      }
      if (!containsCandidate) {
        wallPartitionBoxes.push({ box: box, name: o.name || (o.parent && o.parent.name) || "wall" });
        return;
      }
    }
    const geom = o.geometry;
    const pos = geom && geom.attributes && geom.attributes.position;
    const e = o.matrixWorld && o.matrixWorld.elements;
    if (!pos || !e) return;
    const arr = pos.array;
    const index = geom.index ? geom.index.array : null;
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index[t * 3] : t * 3;
      const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
      const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
      const a = worldOfLocal(e, arr[i0 * 3], arr[i0 * 3 + 1], arr[i0 * 3 + 2]);
      const b = worldOfLocal(e, arr[i1 * 3], arr[i1 * 3 + 1], arr[i1 * 3 + 2]);
      const c = worldOfLocal(e, arr[i2 * 3], arr[i2 * 3 + 1], arr[i2 * 3 + 2]);
      surfaceTris.push([a, b, c]);
      if (triOrigins.length < 200) triOrigins.push({ tri: t, a: a.map(v=>+v.toFixed(2)), name: o.name || "" });
    }
  });
  const doorBoxes = [];
  scene.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    if (o.visible === false) return;
    if (!/door_leaf|fixture-slot\.door/i.test(o.name || "")) return;
    const box = worldBoxOf(o);
    if (box) doorBoxes.push({ box: box, name: o.name || "" });
  });
  const lookRayHitsBoxes = function (ox, oy, oz, dx, dy, dz, boxes) {
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i].box;
      let tmin = 0, tmax = 1;
      let miss = false;
      for (let c = 0; c < 3 && !miss; c++) {
        const o = c === 0 ? ox : c === 1 ? oy : oz;
        const d = c === 0 ? dx : c === 1 ? dy : dz;
        const mn = b.min[c], mx = b.max[c];
        if (d > -1e-12 && d < 1e-12) {
          if (o < mn || o > mx) miss = true;
          continue;
        }
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmax < tmin) miss = true;
      }
      if (!miss && tmax > 1e-6 && tmin < 1) hits.push(boxes[i].name);
    }
    return hits;
  };
  const lookRayHitsTris = function (ox, oy, oz, dx, dy, dz, len) {
    let first = null;
    for (let i = 0; i < surfaceTris.length && !first; i++) {
      const a = surfaceTris[i][0], b = surfaceTris[i][1], c = surfaceTris[i][2];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const invDet = 1.0 / det;
      const tx = ox - a[0], ty = oy - a[1], tz = oz - a[2];
      const u = (tx * px + ty * py + tz * pz) * invDet;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * invDet;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      if (t > 1e-6 && t < len) {
        first = { t: +t.toFixed(4), hit: [ox + dx * t, oy + dy * t, oz + dz * t].map(v=>+v.toFixed(2)) };
      }
    }
    return first;
  };

  const rows = [];
  for (let i = 0; i < candidates.length; i++) {
    const cx = candidates[i][0], cz = candidates[i][1];
    const ox = cx, oy = actors.max[1], oz = cz;
    let dx = look[0] - ox, dy = look[1] - oy, dz = look[2] - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const reasons = [];
    if (len > 1e-6) {
      const doorHits = lookRayHitsBoxes(ox, oy, oz, dx, dy, dz, doorBoxes);
      if (doorHits.length > 0) reasons.push("door:" + doorHits.join(","));
      const partHits = lookRayHitsBoxes(ox, oy, oz, dx, dy, dz, wallPartitionBoxes);
      if (partHits.length > 0) reasons.push("partition:" + partHits.join(","));
      const triHit = lookRayHitsTris(ox, oy, oz, dx, dy, dz, len);
      if (triHit) reasons.push("tri@t=" + triHit.t + " hit=" + JSON.stringify(triHit.hit));
    }
    rows.push({
      x: +cx.toFixed(3), z: +cz.toFixed(3),
      score: +nearestActorDistance(cx, cz).toFixed(3),
      accepted: reasons.length === 0,
      reasons: reasons
    });
  }
  return {
    rows: rows,
    interiorMin: interior.min, interiorMax: interior.max,
    wallThickness: wallThickness,
    look: look.map(v=>+v.toFixed(3)),
    actorMaxY: actors.max[1],
    wallPartitions: wallPartitionBoxes.map(p => ({ name: p.name, box: { min: p.box.min.map(v=>+v.toFixed(2)), max: p.box.max.map(v=>+v.toFixed(2)) } })),
    doors: doorBoxes.map(p => ({ name: p.name, box: { min: p.box.min.map(v=>+v.toFixed(2)), max: p.box.max.map(v=>+v.toFixed(2)) } })),
    triCount: surfaceTris.length,
    triSample: triOrigins.slice(0, 12)
  };
})()`;

async function main(): Promise<void> {
  const station = "ed_stroke_alert_handoff_v1";
  const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? "2");
  const out = process.argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") ?? "/tmp/ed-stroke-debug.json";
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const results: unknown[] = [];
  try {
    for (let run = 1; run <= runs; run++) {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: VIEWPORT });
      try {
        await page.goto(buildRoomCaptureUrl(server.url, station, "scene-overview"), { waitUntil: "load", timeout: 180_000 });
        const live = await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        const note = await reframeCameraForRoom(page, live.environmentId);
        await page.waitForTimeout(1500);
        const shot = await page.screenshot({ fullPage: false });
        const lum = regionLuminance(shot, REGION);
        const facts = await readInfinigenRoomLiveFacts(page);
        const evalResult = await page.evaluate(EVAL);
        results.push({ run, note, lum: lum ? { median: lum.median, mean: lum.mean, sd: lum.sd, p90: lum.p90, nonBlackPct: lum.nonBlackPct } : null, facts, eval: evalResult });
        console.log("RUN", run, "median", lum?.median, "cam", note.slice(0, 90));
        console.log("  lum", lum ? { mean: +lum.mean.toFixed(1), p90: lum.p90, nonBlack: +lum.nonBlackPct.toFixed(1) } : null);
        console.log("  rows:", (evalResult as { rows: Array<{ x: number; z: number; score: number; accepted: boolean; reasons: string[] }> }).rows.map(r => `${r.x}:${r.score}${r.accepted ? "OK" : "(" + r.reasons.join("|") + ")"}`).join(" "));
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("wrote", out);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
