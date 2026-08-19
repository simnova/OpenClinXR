/**
 * #247 pixel discriminator — does the capture actually show a gap under the feet?
 *
 * Takes the same screenshot the orchestrator graded (same URL, camera, viewport),
 * then samples pixel patches at each actor's projected foot-bottom and below it.
 * Text-only worker: pixel VALUES, not image reading.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const require = createRequire(import.meta.url);
// sharp is CJS and ships no types resolvable from this depth; runtime-only usage.
const sharp = require("sharp") as (input: string | Buffer) => {
  raw: () => { toBuffer: (opts?: { resolveWithObject?: boolean }) => Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> };
};

const EVIDENCE_DIR = ".openclinxr/evidence/issue-247";

const EVAL = `(() => {
  const win = window;
  const scene = win.__openClinXrDebugScene;
  const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
  if (!scene) return { error: "no scene" };
  let cameraInfo = null;
  scene.traverse(function (o) {
    if (o.isCamera && !cameraInfo) {
      const q = o.quaternion;
      cameraInfo = {
        fov: o.fov, aspect: o.aspect,
        position: { x: o.position.x, y: o.position.y, z: o.position.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      };
    }
  });
  function mulMat4Vec3(e, x, y, z) {
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    return [
      (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    ];
  }
  // Same skinning as the contract probe, stride=1 exact.
  function exactMinY(root) {
    let minY = Infinity, minX = null, minZ = null;
    root.traverse(function (mesh) {
      if (!mesh.isSkinnedMesh) return;
      if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
      if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos) return;
      const skinIndex = mesh.geometry.attributes.skinIndex;
      const skinWeight = mesh.geometry.attributes.skinWeight;
      const skeleton = mesh.skeleton;
      const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
      const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
      if (!(skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse)) return;
      const bones = skeleton.bones;
      const inverses = skeleton.boneInverses;
      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const bound = mulMat4Vec3(bindMatrix, vx, vy, vz);
        let sx = 0, sy = 0, sz = 0;
        for (let k = 0; k < 4; k++) {
          const weight = k === 0 ? skinWeight.getX(i) : k === 1 ? skinWeight.getY(i) : k === 2 ? skinWeight.getZ(i) : (skinWeight.getW ? skinWeight.getW(i) : 0);
          if (weight === 0) continue;
          const boneIdx = k === 0 ? skinIndex.getX(i) : k === 1 ? skinIndex.getY(i) : k === 2 ? skinIndex.getZ(i) : (skinIndex.getW ? skinIndex.getW(i) : 0);
          const bone = bones[boneIdx];
          const inv = inverses[boneIdx];
          if (!bone || !bone.matrixWorld || !bone.matrixWorld.elements || !inv || !inv.elements) continue;
          const bm = mulMat4Vec3(mulMat4(bone.matrixWorld.elements, inv.elements), bound[0], bound[1], bound[2]);
          sx += bm[0] * weight; sy += bm[1] * weight; sz += bm[2] * weight;
        }
        const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
        const f = mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2]);
        if (f[1] < minY) { minY = f[1]; minX = f[0]; minZ = f[2]; }
      }
    });
    if (!Number.isFinite(minY)) return null;
    return { y: minY, x: minX, z: minZ };
  }
  function mulMat4(ae, be) {
    const te = new Float64Array(16);
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return te;
  }
  const actors = [];
  scene.traverse(function (o) {
    const posture = o.userData && o.userData.openClinXrActorPosture;
    if (posture !== "standing" && posture !== "seated" && posture !== "supine") return;
    let hasStaged = false;
    let p = o;
    let depth = 0;
    while (p && depth < 6) {
      if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) { hasStaged = true; break; }
      p = p.parent; depth++;
    }
    if (!hasStaged) return;
    if (typeof o.updateMatrixWorld === "function") o.updateMatrixWorld(true);
    const actorId = (o.userData && o.userData.openClinXrActorId) || o.name || "unknown";
    const foot = exactMinY(o);
    if (!foot) return;
    actors.push({ actorId, posture, foot });
  });
  return { camera: cameraInfo, actors, framesAdvanced };
})()`;

type Foot = { y: number; x: number; z: number };

function project(world: { x: number; y: number; z: number }, cam: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; fov: number; aspect: number }, width: number, height: number): { px: number; py: number } | null {
  const { x, y, z } = world;
  const px0 = cam.position.x, py0 = cam.position.y, pz0 = cam.position.z;
  // world -> camera: translate then inverse-rotate
  const dx = x - px0, dy = y - py0, dz = z - pz0;
  const q = cam.quaternion;
  // inverse quaternion (conjugate) rotation of the offset vector
  const qvx = -q.x, qvy = -q.y, qvz = -q.z, qw = q.w;
  const vx = dx, vy = dy, vz = dz;
  // qv x v
  const c1x = qvy * vz - qvz * vy;
  const c1y = qvz * vx - qvx * vz;
  const c1z = qvx * vy - qvy * vx;
  // qv x v + w*qv
  const c2x = c1x + qw * qvx;
  const c2y = c1y + qw * qvy;
  const c2z = c1z + qw * qvz;
  // qv x c2
  const c3x = qvy * c2z - qvz * c2y;
  const c3y = qvz * c2x - qvx * c2z;
  const c3z = qvx * c2y - qvy * c2x;
  const cx = vx + 2 * c3x;
  const cy = vy + 2 * c3y;
  const cz = vz + 2 * c3z;
  if (cz >= -0.01) return null; // behind camera
  const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
  const ndcX = (f / cam.aspect) * (cx / -cz);
  const ndcY = f * (cy / -cz);
  return {
    px: (ndcX * 0.5 + 0.5) * width,
    py: (1 - (ndcY * 0.5 + 0.5)) * height,
  };
}

async function main(): Promise<void> {
  const scenarioId = "ed_stroke_alert_handoff_v1";
  const width = 1440, height = 900;
  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        const url = buildRoomCaptureUrl(server.url, scenarioId, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await page.waitForFunction(
          ({ minFrames: need }) => {
            const win = window as unknown as {
              __openClinXrFrameStats?: { framesObserved?: number };
              __openClinXrDebugScene?: { traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void };
            };
            if ((win.__openClinXrFrameStats?.framesObserved ?? 0) < need) return false;
            let skinned = 0;
            win.__openClinXrDebugScene?.traverse?.((object) => { if (object.isSkinnedMesh) skinned += 1; });
            return skinned >= 1;
          },
          { minFrames: 8 },
          { timeout: 180_000 },
        );
        await page.waitForTimeout(1200);
        const data = (await page.evaluate(EVAL)) as {
          camera: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; fov: number; aspect: number };
          actors: { actorId: string; posture: string; foot: Foot }[];
          framesAdvanced: number;
        };
        const pngPath = path.join(EVIDENCE_DIR, "ed-stroke-station-issue247.png");
        await page.screenshot({ path: pngPath, type: "png" });
        const raw = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true });
        const { data: pixels, info } = raw;
        const channels = info.channels;
        const sample = (px: number, py: number, half = 3): { r: number; g: number; b: number } | null => {
          const cx = Math.round(px), cy = Math.round(py);
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const x = cx + dx, y = cy + dy;
              if (x < 0 || x >= info.width || y < 0 || y >= info.height) continue;
              const i = (y * info.width + x) * channels;
              r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
            }
          }
          if (n === 0) return null;
          return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
        };

        console.log(`camera:`, JSON.stringify(data.camera));
        console.log(`framesAdvanced: ${data.framesAdvanced}`);
        for (const a of data.actors) {
          const foot = a.foot;
          const proj = project({ x: foot.x, y: foot.y, z: foot.z }, data.camera, width, height);
          const floorBelow = project({ x: foot.x, y: 0, z: foot.z }, data.camera, width, height);
          if (!proj || !floorBelow) {
            console.log(`${a.actorId}: foot world (${foot.x.toFixed(3)}, ${foot.y.toFixed(3)}, ${foot.z.toFixed(3)}) NOT VISIBLE (behind camera)`);
            continue;
          }
          console.log(`${a.actorId} (${a.posture}): foot world y=${foot.y.toFixed(4)} at (${foot.x.toFixed(3)}, ${foot.z.toFixed(3)})`);
          console.log(`  screen foot-bottom px=${proj.px.toFixed(1)} py=${proj.py.toFixed(1)}; floor@y=0 same XZ px=${floorBelow.px.toFixed(1)} py=${floorBelow.py.toFixed(1)}`);
          console.log(`  screen gap foot->floor = ${(floorBelow.py - proj.py).toFixed(1)} px`);
          for (const dy of [0, 6, 14, 28, 60, 100]) {
            const s = sample(proj.px, proj.py + dy);
            console.log(`  pixel @foot+${dy}px: ${s ? `rgb(${s.r},${s.g},${s.b})` : "OOB"}`);
          }
        }
        // Reference patches: floor at a clear point in front of the camera (x=0.5,y=0,z=2.0), background top-right.
        const floorRef = project({ x: 0.5, y: 0, z: 2.0 }, data.camera, width, height);
        if (floorRef) {
          const s = sample(floorRef.px, floorRef.py);
          console.log(`floor reference @(0.5,0,2.0) px=${floorRef.px.toFixed(1)},${floorRef.py.toFixed(1)}: ${s ? `rgb(${s.r},${s.g},${s.b})` : "OOB"}`);
        }
        const bgRef = sample(width * 0.85, height * 0.12);
        console.log(`background reference (top-right): ${bgRef ? `rgb(${bgRef.r},${bgRef.g},${bgRef.b})` : "OOB"}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (server) {
      try { await stopPortlessDevServer(server.proc); } catch { /* ignore */ }
    }
  }
}

if (process.argv[1]?.endsWith("issue-247-pixel-probe.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
