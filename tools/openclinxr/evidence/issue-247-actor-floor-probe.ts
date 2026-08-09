/**
 * #247 first measurement probe — ED stroke station floor contact.
 *
 * Text-only worker discipline: this probe writes `.openclinxr/evidence/issue-247/pre-fix.json`
 * BEFORE any product edit. It boots the running ui-xr scene (same portless dev server the
 * contract uses), measures for each actor:
 *   1. y0 exactly as actor-floor-contact computes it (stride-sampled skinned world bounds)
 *   2. exact minimum skinned vertex world Y (stride = 1)
 *   3. the world Y of every surface directly beneath the actor's foot XZ
 * plus camera transform and resolved GLB URLs, and a known-good control station.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { spawnPortlessDevServer } from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const EVIDENCE_DIR = ".openclinxr/evidence/issue-247";
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");

/** Same evaluate body shape the contract probe uses, extended with exact scan + surfaces + camera. */
const EVALUATE_BODY = `(() => {
  const win = window;
  const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
  const scene = win.__openClinXrDebugScene;
  const params = new URLSearchParams(window.location.search);
  let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
  if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
      typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
    scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
  }
  if (!scene || typeof scene.traverse !== "function") {
    return { scenarioId: scenarioId, actors: [], error: "no debug scene" };
  }

  let cameraInfo = null;
  scene.traverse(function (o) {
    if (o.isCamera && !cameraInfo) {
      const q = o.quaternion;
      cameraInfo = {
        fov: o.fov, aspect: o.aspect, near: o.near, far: o.far,
        position: { x: o.position.x, y: o.position.y, z: o.position.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        framing: (o.userData && o.userData.openClinXrCameraFraming) || null,
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

  function skinnedWorldBounds(mesh, strideArg) {
    if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
    if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
    const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return null;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    const skeleton = mesh.skeleton;
    const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
    const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let footX = null, footZ = null;
    const stride = strideArg || Math.max(1, Math.floor(pos.count / 4000));

    if (skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse) {
      const bones = skeleton.bones;
      const inverses = skeleton.boneInverses;
      for (let i = 0; i < pos.count; i += stride) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const bound = mulMat4Vec3(bindMatrix, vx, vy, vz);
        let sx = 0, sy = 0, sz = 0;
        for (let k = 0; k < 4; k++) {
          const weight = k === 0 ? skinWeight.getX(i) : k === 1 ? skinWeight.getY(i) : k === 2 ? skinWeight.getZ(i) : (skinWeight.getW ? skinWeight.getW(i) : 0);
          if (weight === 0) continue;
          const boneIdx = k === 0 ? skinIndex.getX(i) : k === 1 ? skinIndex.getY(i) : k === 2 ? skinIndex.getZ(i) : (skinIndex.getW ? skinIndex.getW(i) : 0);
          const bone = bones[boneIdx];
          const inv = inverses[boneIdx];
          if (!bone || !bone.matrixWorld || !bone.matrixWorld.elements || !inv || !inv.elements) continue;
          const boneMat = mulMat4(bone.matrixWorld.elements, inv.elements);
          const p = mulMat4Vec3(boneMat, bound[0], bound[1], bound[2]);
          sx += p[0] * weight;
          sy += p[1] * weight;
          sz += p[2] * weight;
        }
        const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
        const weightSum = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + (skinWeight.getW ? skinWeight.getW(i) : 0);
        let finalX, finalY, finalZ;
        if (weightSum > 1e-6) {
          const f = mesh.matrixWorld && mesh.matrixWorld.elements
            ? mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2])
            : invP;
          finalX = f[0]; finalY = f[1]; finalZ = f[2];
        } else {
          const f = mesh.matrixWorld && mesh.matrixWorld.elements
            ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
            : [vx, vy, vz];
          finalX = f[0]; finalY = f[1]; finalZ = f[2];
        }
        if (finalY < minY) { minY = finalY; footX = finalX; footZ = finalZ; }
        if (finalY > maxY) maxY = finalY;
        if (finalX < minX) minX = finalX;
        if (finalX > maxX) maxX = finalX;
        if (finalZ < minZ) minZ = finalZ;
        if (finalZ > maxZ) maxZ = finalZ;
      }
    } else {
      for (let i = 0; i < pos.count; i += stride) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const f = mesh.matrixWorld && mesh.matrixWorld.elements
          ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
          : [vx, vy, vz];
        if (f[1] < minY) { minY = f[1]; footX = f[0]; footZ = f[2]; }
        if (f[1] > maxY) maxY = f[1];
        if (f[0] < minX) minX = f[0];
        if (f[0] > maxX) maxX = f[0];
        if (f[2] < minZ) minZ = f[2];
        if (f[2] > maxZ) maxZ = f[2];
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    return { minY: minY, maxY: maxY, height: maxY - minY, minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, footX: footX, footZ: footZ };
  }

  function nonSkinnedWorldAABB(mesh) {
    const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return null;
    if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const stride = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const f = mesh.matrixWorld && mesh.matrixWorld.elements
        ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
        : [vx, vy, vz];
      if (f[0] < minX) minX = f[0];
      if (f[0] > maxX) maxX = f[0];
      if (f[1] < minY) minY = f[1];
      if (f[1] > maxY) maxY = f[1];
      if (f[2] < minZ) minZ = f[2];
      if (f[2] > maxZ) maxZ = f[2];
    }
    if (!Number.isFinite(minY)) return null;
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  // Tagged actor roots — exactly the contract's selection.
  const tagged = [];
  scene.traverse(function (object) {
    const posture = object.userData && object.userData.openClinXrActorPosture;
    if (posture === "standing" || posture === "seated" || posture === "supine") {
      tagged.push(object);
    }
  });
  const humanoidRoots = tagged.filter(function (root) {
    let hasTaggedDescendant = false;
    if (typeof root.traverse === "function") {
      root.traverse(function (child) {
        if (child === root) return;
        const p = child.userData && child.userData.openClinXrActorPosture;
        if (p === "standing" || p === "seated" || p === "supine") hasTaggedDescendant = true;
      });
    }
    return !hasTaggedDescendant;
  });

  function resolveActorId(root, index) {
    if (root.userData && typeof root.userData.openClinXrActorId === "string" && root.userData.openClinXrActorId.length > 0) {
      return root.userData.openClinXrActorId;
    }
    let p = root.parent;
    let depth = 0;
    while (p && depth < 6) {
      const name = p.name || "";
      if (name.indexOf("patient") >= 0 || name.indexOf("Patient") >= 0 || name.indexOf("robert") >= 0 || name.indexOf("Robert") >= 0) return "patient_primary";
      if (name.indexOf("nurse") >= 0 || name.indexOf("Nurse") >= 0 || name.indexOf("maria") >= 0 || name.indexOf("Maria") >= 0) return "clinical_team";
      if (name.indexOf("spouse") >= 0 || name.indexOf("Spouse") >= 0 || name.indexOf("family") >= 0 || name.indexOf("anna") >= 0 || name.indexOf("Anna") >= 0) return "family_or_observer";
      if (p.userData && typeof p.userData.openClinXrSlotKind === "string" && p.userData.openClinXrSlotKind.length > 0) return p.userData.openClinXrSlotKind;
      p = p.parent;
      depth++;
    }
    return (root.name && root.name.length > 0) ? root.name : ("actor_" + index);
  }

  function worldPosition(obj) {
    if (typeof obj.updateMatrixWorld === "function") obj.updateMatrixWorld(true);
    const e = obj.matrixWorld && obj.matrixWorld.elements;
    if (!e) return null;
    return { x: e[12], y: e[13], z: e[14] };
  }

  function isIdentity4(m) {
    if (!m) return null;
    const e = m.elements;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = e[r * 4 + c];
        const expected = r === c ? 1 : 0;
        if (Math.abs(v - expected) > 1e-6) return false;
      }
    }
    return true;
  }

  const actors = [];
  for (let r = 0; r < humanoidRoots.length; r++) {
    const root = humanoidRoots[r];
    const posture = root.userData.openClinXrActorPosture;
    const resolvedId = resolveActorId(root, r);
    const rawSlotId = root.userData && typeof root.userData.openClinXrActorId === "string" ? root.userData.openClinXrActorId : "";
    let hasStagedActorId = typeof rawSlotId === "string" && rawSlotId.length > 0;
    if (!hasStagedActorId) {
      let p = root.parent;
      let depth = 0;
      while (p && depth < 6) {
        if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) {
          hasStagedActorId = true;
          break;
        }
        p = p.parent;
        depth++;
      }
    }
    if (!hasStagedActorId) continue;

    if (typeof root.updateMatrixWorld === "function") root.updateMatrixWorld(true);
    const slotPos = worldPosition(root);
    const skinnedMeshes = [];
    let any = false;
    const contract = { minY: Infinity, maxY: -Infinity, footX: null, footZ: null };
    const exact = { minY: Infinity, maxY: -Infinity, footX: null, footZ: null };
    if (typeof root.traverse === "function") {
      root.traverse(function (object) {
        if (!object.isSkinnedMesh) return;
        const bContract = skinnedWorldBounds(object, 0);
        const bExact = skinnedWorldBounds(object, 1);
        any = true;
        if (bContract) {
          if (bContract.minY < contract.minY) { contract.minY = bContract.minY; contract.footX = bContract.footX; contract.footZ = bContract.footZ; }
          if (bContract.maxY > contract.maxY) contract.maxY = bContract.maxY;
        }
        if (bExact) {
          if (bExact.minY < exact.minY) { exact.minY = bExact.minY; exact.footX = bExact.footX; exact.footZ = bExact.footZ; }
          if (bExact.maxY > exact.maxY) exact.maxY = bExact.maxY;
        }
        let parentChain = [];
        let pp = object.parent;
        let d = 0;
        while (pp && d < 4) { parentChain.push(pp.name || "(unnamed)"); pp = pp.parent; d++; }
        skinnedMeshes.push({
          name: object.name || "(unnamed)",
          vertexCount: (object.geometry && object.geometry.attributes && object.geometry.attributes.position) ? object.geometry.attributes.position.count : 0,
          worldPos: worldPosition(object),
          bindMatrixIdentity: isIdentity4(object.bindMatrix),
          bindMatrixTranslation: object.bindMatrix ? (function () { const e = object.bindMatrix.elements; return { x: e[12], y: e[13], z: e[14] }; })() : null,
          meshWorldY: object.matrixWorld ? object.matrixWorld.elements[13] : null,
          contractMinY: bContract ? bContract.minY : null,
          exactMinY: bExact ? bExact.minY : null,
          parentChain: parentChain,
        });
      });
      if (!any) {
        root.traverse(function (object) {
          if (!object.geometry || !object.geometry.attributes || !object.geometry.attributes.position) return;
          const bContract = skinnedWorldBounds(object, 0);
          const bExact = skinnedWorldBounds(object, 1);
          any = true;
          if (bContract) {
            if (bContract.minY < contract.minY) { contract.minY = bContract.minY; contract.footX = bContract.footX; contract.footZ = bContract.footZ; }
            if (bContract.maxY > contract.maxY) contract.maxY = bContract.maxY;
          }
          if (bExact) {
            if (bExact.minY < exact.minY) { exact.minY = bExact.minY; exact.footX = bExact.footX; exact.footZ = bExact.footZ; }
            if (bExact.maxY > exact.maxY) exact.maxY = bExact.maxY;
          }
          skinnedMeshes.push({ name: object.name || "(unnamed)", vertexCount: object.geometry.attributes.position.count, worldPos: worldPosition(object), bindMatrixIdentity: null, bindMatrixTranslation: null, meshWorldY: object.matrixWorld ? object.matrixWorld.elements[13] : null, contractMinY: bContract ? bContract.minY : null, exactMinY: bExact ? bExact.minY : null, parentChain: [] });
        });
      }
    }
    if (!any) continue;

    // Surfaces beneath the actor's lowest vertex (XZ containment + world maxY band).
    const surfaces = [];
    const fx = exact.footX, fz = exact.footZ;
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) return;
      const ab = nonSkinnedWorldAABB(o);
      if (!ab) return;
      const containsX = fx !== null && fx >= ab.minX - 1e-4 && fx <= ab.maxX + 1e-4;
      const containsZ = fz !== null && fz >= ab.minZ - 1e-4 && fz <= ab.maxZ + 1e-4;
      if (containsX && containsZ && ab.maxY > -0.5 && ab.maxY < 1.5 && ab.minY < 1.0) {
        surfaces.push({
          name: o.name || "(unnamed)",
          minY: Number(ab.minY.toFixed(4)),
          maxY: Number(ab.maxY.toFixed(4)),
          visible: o.visible,
          materialColor: (o.material && o.material.color) ? "#" + o.material.color.getHexString() : null,
        });
      }
    });
    surfaces.sort(function (a, b) { return b.maxY - a.maxY; });

    actors.push({
      actorId: resolvedId,
      posture: posture,
      framesAdvanced: framesAdvanced,
      y0Contract: any && Number.isFinite(contract.minY) ? Number(contract.minY.toFixed(4)) : null,
      y0Exact: any && Number.isFinite(exact.minY) ? Number(exact.minY.toFixed(4)) : null,
      highestVertexY: any && Number.isFinite(exact.maxY) ? Number(exact.maxY.toFixed(4)) : null,
      meshHeightMeters: any && Number.isFinite(exact.maxY) && Number.isFinite(exact.minY) ? Number((exact.maxY - exact.minY).toFixed(4)) : null,
      footWorld: { x: fx !== null ? Number(fx.toFixed(4)) : null, z: fz !== null ? Number(fz.toFixed(4)) : null },
      slotWorldPos: slotPos,
      effectiveVerticalOffset: (root.userData && root.userData.openClinXrEffectiveVerticalOffsetMeters) ?? null,
      requestedVerticalOffset: (root.userData && root.userData.openClinXrRequestedVerticalOffsetMeters) ?? null,
      slotKind: (root.userData && root.userData.openClinXrSlotKind) || null,
      floorStandingFrame: (root.userData && root.userData.openClinXrFloorStandingFrame) ?? null,
      skinnedMeshes: skinnedMeshes,
      surfacesBeneath: surfaces,
    });
  }

  // Resolved GLB URLs the page actually fetched.
  const glbUrls = [];
  try {
    const entries = performance.getEntriesByType("resource") || [];
    for (const e of entries) {
      if (typeof e.name === "string" && e.name.indexOf(".glb") >= 0) glbUrls.push(e.name);
    }
  } catch (err) { /* ignore */ }

  return {
    scenarioId: scenarioId,
    actors: actors,
    camera: cameraInfo,
    glbUrls: glbUrls,
    framesAdvanced: framesAdvanced,
  };
})()`;

async function measureStation(page: import("playwright").Page, baseUrl: string, scenarioId: string): Promise<unknown> {
  const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
  process.stdout.write(`probe: goto ${scenarioId}\n`);
  await page.goto(url, { waitUntil: "load", timeout: 180_000 });
  await waitForStationShell(page, 180_000);
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: { traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => { if (object.isSkinnedMesh) skinned += 1; });
      return skinned >= 1;
    },
    { minFrames: 8 },
    { timeout: 180_000 },
  );
  await page.waitForTimeout(900);
  return page.evaluate(EVALUATE_BODY);
}

async function main(): Promise<void> {
  const scenarioIds = ["ed_stroke_alert_handoff_v1", "ed_chest_pain_priority_v1", "psych_suicidal_ideation_safety_v1"];
  const headSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const treeDirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;

  let server: import("./lib/portless-server.js").PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const stations: unknown[] = [];
        for (const sid of scenarioIds) {
          const report = await measureStation(page, server.url, sid);
          stations.push(report);
          process.stdout.write(`probe: ${sid} -> ${JSON.stringify((report as { actors: unknown[] }).actors.map((a) => (a as { actorId: string; y0Contract: number | null; y0Exact: number | null; surfacesBeneath: unknown[] }).actorId + " y0Contract=" + String((a as { y0Contract: number | null }).y0Contract) + " y0Exact=" + String((a as { y0Exact: number | null }).y0Exact) + " surfaces=" + String((a as { surfacesBeneath: unknown[] }).surfacesBeneath.length)))}\n`);
        }
        await mkdir(EVIDENCE_DIR, { recursive: true });
        const payload = {
          schemaVersion: "openclinxr.issue-247.actor-floor-first-measurement.v1",
          kind: "issue_247_actor_floor_first_measurement",
          label: "pre-fix",
          measuredAgainstCommit: headSha,
          treeDirty,
          measuredAt: new Date().toISOString(),
          methodology: [
            "y0Contract: actor-floor-contact stride-sampled skinned world bounds (identical math to readLivePostureGeometryFromPage)",
            "y0Exact: same skinning math, stride=1 over every skinned vertex",
            "surfacesBeneath: world AABBs of non-skinned meshes containing the actor's lowest-vertex XZ, top Y in (-0.5, 1.5)",
          ],
          claimScope: [
            "live_skinned_mesh_world_min_y_vs_floor_surface_top_y_for_ed_stroke_alert_handoff_v1_and_controls",
          ],
          notEvidenceFor: [
            "posture_quality",
            "wardrobe",
            "clinical_plausibility",
            "quest_readiness",
            "pixel_grade_of_capture",
          ],
          stations,
        };
        await writeFile(PRE_FIX_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        process.stdout.write(`probe: wrote ${PRE_FIX_PATH}\n`);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

if (process.argv[1]?.endsWith("issue-247-actor-floor-probe.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
