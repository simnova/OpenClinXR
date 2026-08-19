/**
 * issue-289 — body-part hiding reaches the live scene but the skin still renders.
 *
 * Chain: #285 shipped the hide mask predicate (body_param_stage.apply_body_hide_
 * material_region paints an alpha-0 material on poking faces), #287 re-baked both
 * library bodies through it and verified the shipped bytes carry
 * `openclinxr_hidden_*` materials (alphaMode MASK, baseColorAlpha 0). The runtime
 * (ui-xr three.js) loads the same GLB and the hidden materials are present with
 * alphaTest 0.5 / opacity 0 / transparent false — yet a 6× crop of the parent
 * torso still shows flank skin patches and the ragged waist hem unchanged.
 *
 * THE CAUSE IS NOT DETERMINED. This module is the first measurement: per primitive
 * of the loaded body, dump the material name, alphaTest, opacity, transparent,
 * triangle count, and whether any of that primitive's faces are in the poking set
 * (the signed-clearance predicate's poking faces, computed on the shipped GLB in
 * the SAME concatenated frame the #285/#287 evidence tests use).
 *
 * It also runs a DECISIVE RENDER TEST in the live page: each body primitive is
 * rendered alone, close-framed, to an offscreen canvas against a distinct clear
 * colour, and the number of non-clear pixels is counted. A hidden primitive that
 * renders ~0 pixels IS being discarded by the renderer; one that renders thousands
 * is NOT — that is the renderer-finding branch, a different slice.
 *
 * claimScope: whether the shipped body-part hiding (alpha-0 MASK material) is
 * honoured by the ui-xr renderer for the two body classes in the peds scenario.
 * notEvidenceFor: garment aesthetics/quality, clinical wardrobe, Quest readiness,
 * cloth physics, animation deformation.
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import { PEDS_ASTHMA_SCENARIO_ID, resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import { ROOM_CAPTURE_MODE, buildRoomCaptureUrl, waitForStationShell } from "./ui-xr-environment-room-capture.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const EVIDENCE_DIR_289 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-289");
export const PRE_FIX_PATH_289 = path.join(EVIDENCE_DIR_289, "pre-fix.json");

export const CANDIDATES_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates");
export const COVERAGE_MODULE = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/garment_coverage.py");

const POKE_EPSILON_M = 0.002;
const HIDE_EPSILON_M = 0.005;

const BODY_CLASS_GLBS: Record<string, string> = {
  adult_lean_female: "body-param-adult_lean_female-library.glb",
  adult_heavy_male: "body-param-adult_heavy_male-library.glb",
};

export type Slot = "upper" | "lower";

/** File-side: one basemesh primitive read from the shipped GLB. */
export type FilePrimitiveRow = {
  bodyClassId: string;
  meshName: string;
  primIndex: number;
  materialName: string;
  alphaMode: string | null;
  baseColorAlpha: number | null;
  triangles: number;
  startFace: number;
  endFace: number;
  pokingFacesBySlot: Record<Slot, number>;
  hiddenFacesBySlot: Record<Slot, number>;
};

/** Live-side: one mesh object under an actor root in __openClinXrDebugScene. */
export type LiveMeshRow = {
  scenarioId: string;
  actorId: string;
  meshName: string;
  materialName: string;
  alphaTest: number;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  frustumCulled: boolean;
  triangles: number;
};

export type RenderDiscardRow = {
  actorId: string;
  meshName: string;
  materialName: string;
  nonClearPixels: number;
  controlSkinPixels: number;
  verdict: "discarded" | "renders";
  /** opacity=1 control: same mesh re-rendered with opacity forced to 1. */
  controlOpacity1Pixels: number;
  /** whole-scene pixel delta with hidden primitives visible vs invisible. */
  sceneDeltaPixels: number;
};

/** The joined per-primitive row the issue asks for. */
export type JoinedRow = {
  bodyClassId: string;
  actorId: string;
  meshName: string;
  materialName: string;
  alphaTest: number;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  triangles: number;
  isHiddenMaterial: boolean;
  pokingFaces: Record<Slot, number>;
  hiddenFaces: Record<Slot, number>;
  pokesOnThisPrimitive: boolean;
};

export type Issue289PrefixReport = {
  schemaVersion: "openclinxr.issue-289.pre-fix.v1";
  measuredAt: string;
  scenarioId: string;
  filePrimitives: FilePrimitiveRow[];
  liveScene: LiveMeshRow[];
  joined: JoinedRow[];
  renderDiscard: RenderDiscardRow[];
  /** Skin faces inside a garment's claim region that remain visible (not hidden by the mask). */
  visibleSkinInClaimRegion: Array<{
    bodyClassId: string;
    slot: Slot;
    regionFaceCount: number;
    hiddenFaceCount: number;
    pokingFaceCount: number;
    /** Faces with NO garment surface within the 8 cm search radius — genuinely uncovered skin. */
    noGarmentNearbyFaceCount: number;
    /** Faces with clearance >= hide epsilon and a garment in front — NOT visible behind the garment. */
    garmentInFrontFaceCount: number;
    visibleFaceCount: number;
  }>;
  summary: {
    pokesOnHiddenPrimitive: boolean;
    discardHonouredByRenderer: boolean | null;
    wholeSceneDeltaPixels: number | null;
    headline: string;
  };
  claimScope: string;
  notEvidenceFor: string[];
};

type MeshGeom = { position: number[]; indices: number[]; triangles: number };

function meshGeom(mesh: {
  listPrimitives: () => Array<{
    getAttribute: (name: string) => { getCount: () => number; getElement: (i: number, t: number[]) => void } | null;
    getIndices: () => { getCount: () => number; getScalar: (i: number) => number } | null;
  }>;
}): MeshGeom {
  const position: number[] = [];
  const indices: number[] = [];
  let triangles = 0;
  const tmp = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    const base = position.length / 3;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, tmp);
      position.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
    const idx = prim.getIndices();
    if (idx) {
      for (let i = 0; i < idx.getCount(); i += 1) indices.push(idx.getScalar(i) + base);
      triangles += Math.floor(idx.getCount() / 3);
    } else {
      for (let i = 0; i < pos.getCount(); i += 1) indices.push(i);
      triangles += Math.floor(pos.getCount() / 3);
    }
  }
  return { position, indices, triangles };
}

/** Run the shared signed-clearance predicate: per-face poke (< 0.002) + hide (< 0.005) index sets. */
async function runPredicate(
  body: MeshGeom,
  garment: MeshGeom,
  bandLo: number,
  bandHi: number,
  label: string,
  tmpDir: string,
): Promise<{ pokingFaceIndices: number[]; hiddenFaceIndices: number[]; regionFaceCount: number; noGarmentNearbyFaceCount: number; garmentInFrontFaceCount: number }> {
  const bodyPath = path.join(tmpDir, `body-${label}.json`);
  const garmentPath = path.join(tmpDir, `garment-${label}.json`);
  const outPath = path.join(tmpDir, `out-${label}.json`);
  await Promise.all([
    writeFile(bodyPath, JSON.stringify({ position: body.position, indices: body.indices })),
    writeFile(garmentPath, JSON.stringify({ position: garment.position, indices: garment.indices })),
  ]);
  const driver = `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(path.dirname(COVERAGE_MODULE))})
import garment_coverage as gc
def load(p):
    d = json.load(open(p))
    return np.asarray(d["position"], dtype=float).reshape(-1, 3), np.asarray(d["indices"], dtype=np.int64).reshape(-1, 3)
bv, bf = load(${JSON.stringify(bodyPath)})
gv, gf = load(${JSON.stringify(garmentPath)})
clearance, fidx, _fv, _n = gc._region_signed_clearance_samples(
    bv, bf, gv, gf, ${bandLo}, ${bandHi}, max_search_m=gc.SIGNED_SEARCH_M,
)
per_face = clearance.reshape(len(fidx), 3).min(axis=1)
poking = fidx[per_face < ${POKE_EPSILON_M}]
hidden = fidx[per_face < ${HIDE_EPSILON_M}]
no_nearby = fidx[np.isnan(per_face)]
in_front = fidx[per_face >= ${HIDE_EPSILON_M}]
json.dump({
  "regionFaceCount": int(len(fidx)),
  "pokingFaceIndices": [int(i) for i in poking],
  "hiddenFaceIndices": [int(i) for i in hidden],
  "noGarmentNearbyFaceCount": int(len(no_nearby)),
  "garmentInFrontFaceCount": int(len(in_front)),
}, open(${JSON.stringify(outPath)}, "w"))
print("OK")
`;
  const scriptPath = path.join(tmpDir, `driver-${label}.py`);
  await writeFile(scriptPath, driver);
  await execFileAsync("python3", [scriptPath], { timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(await readFile(outPath, "utf8")) as {
    regionFaceCount: number;
    pokingFaceIndices: number[];
    hiddenFaceIndices: number[];
    noGarmentNearbyFaceCount: number;
    garmentInFrontFaceCount: number;
  };
  return raw;
}

function bounds(position: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

async function analyzeBodyFile(bodyClassId: string, tmpDir: string): Promise<{ rows: FilePrimitiveRow[]; byMaterial: Map<string, { pokingFacesBySlot: Record<Slot, number>; hiddenFacesBySlot: Record<Slot, number> }>; regionBySlot: Partial<Record<Slot, { regionFaceCount: number; noGarmentNearbyFaceCount: number; garmentInFrontFaceCount: number }>> }> {
  const io = new NodeIO();
  const glbPath = path.join(CANDIDATES_DIR, BODY_CLASS_GLBS[bodyClassId]!);
  if (!existsSync(glbPath)) throw new Error(`issue-289: missing shipped GLB ${glbPath}`);
  const doc = await io.read(glbPath);
  const bodyMesh = doc.getRoot().listMeshes().find((m) => /basemesh/i.test(m.getName() || ""));
  if (!bodyMesh) throw new Error(`issue-289: no basemesh in ${BODY_CLASS_GLBS[bodyClassId]}`);

  // Per-primitive ranges in the concatenated face frame.
  const primMeta: Array<{ triangles: number; startFace: number; materialName: string; alphaMode: string | null; baseColorAlpha: number | null }> = [];
  let offset = 0;
  for (const prim of bodyMesh.listPrimitives()) {
    const idx = prim.getIndices();
    const tris = idx ? Math.floor(idx.getCount() / 3) : Math.floor((prim.getAttribute("POSITION")?.getCount() ?? 0) / 3);
    const mat = prim.getMaterial();
    primMeta.push({
      triangles: tris,
      startFace: offset,
      materialName: mat?.getName() || "(none)",
      alphaMode: mat?.getAlphaMode() ?? null,
      baseColorAlpha: mat ? Number(mat.getBaseColorFactor()?.[3] ?? 1) : null,
    });
    offset += tris;
  }
  const body = meshGeom(bodyMesh);

  // Per garment: poking/hidden face indices (concatenated frame), full garment-extent band.
  const slotResults: Record<Slot, { pokingSet: Set<number>; hiddenSet: Set<number> }> = {
    upper: { pokingSet: new Set(), hiddenSet: new Set() },
    lower: { pokingSet: new Set(), hiddenSet: new Set() },
  };
  const regionBySlot: Partial<Record<Slot, { regionFaceCount: number; noGarmentNearbyFaceCount: number; garmentInFrontFaceCount: number }>> = {};
  for (const gm of doc.getRoot().listMeshes()) {
    const gname = gm.getName() || "";
    if (/basemesh|footwear|scalp/i.test(gname)) continue;
    const garment = meshGeom(gm);
    const b = bounds(garment.position);
    const slot: Slot = /pants|trouser/i.test(gname) ? "lower" : "upper";
    const res = await runPredicate(body, garment, b.min[1], b.max[1], `${bodyClassId}-${slot}`, tmpDir);
    slotResults[slot] = {
      pokingSet: new Set(res.pokingFaceIndices),
      hiddenSet: new Set(res.hiddenFaceIndices),
    };
    regionBySlot[slot] = {
      regionFaceCount: res.regionFaceCount,
      noGarmentNearbyFaceCount: res.noGarmentNearbyFaceCount,
      garmentInFrontFaceCount: res.garmentInFrontFaceCount,
    };
  }

  const rows: FilePrimitiveRow[] = [];
  const byMaterial = new Map<string, { pokingFacesBySlot: Record<Slot, number>; hiddenFacesBySlot: Record<Slot, number> }>();
  for (let i = 0; i < primMeta.length; i += 1) {
    const p = primMeta[i]!;
    const pokingFacesBySlot: Record<Slot, number> = { upper: 0, lower: 0 };
    const hiddenFacesBySlot: Record<Slot, number> = { upper: 0, lower: 0 };
    for (const slot of ["upper", "lower"] as const) {
      for (let f = p.startFace; f < p.startFace + p.triangles; f += 1) {
        if (slotResults[slot].pokingSet.has(f)) pokingFacesBySlot[slot] += 1;
        if (slotResults[slot].hiddenSet.has(f)) hiddenFacesBySlot[slot] += 1;
      }
    }
    rows.push({
      bodyClassId,
      meshName: bodyMesh.getName() || "",
      primIndex: i,
      materialName: p.materialName,
      alphaMode: p.alphaMode,
      baseColorAlpha: p.baseColorAlpha,
      triangles: p.triangles,
      startFace: p.startFace,
      endFace: p.startFace + p.triangles,
      pokingFacesBySlot,
      hiddenFacesBySlot,
    });
    byMaterial.set(p.materialName, { pokingFacesBySlot, hiddenFacesBySlot });
  }
  return { rows, byMaterial, regionBySlot };
}

async function waitForAssetsAndFrames(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    ({ needSkinned }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrSceneAssetEvidence?: { pendingCount?: number; loadedCount?: number; failedCount?: number };
        __openClinXrDebugScene?: { traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      const assets = win.__openClinXrSceneAssetEvidence;
      const pending = assets?.pendingCount ?? 1;
      const loaded = assets?.loadedCount ?? 0;
      const failed = assets?.failedCount ?? 0;
      if (frames < 6 || pending > 0) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((o) => { if (o.isSkinnedMesh) skinned += 1; });
      return skinned >= needSkinned && loaded + failed > 0;
    },
    { needSkinned: 2 },
    { timeout: timeoutMs },
  );
}

async function dumpLiveMeshes(page: Page, actorIds: readonly string[]): Promise<LiveMeshRow[]> {
  const actorIdsJson = JSON.stringify([...actorIds]);
  const raw = (await page.evaluate(`(() => {
    const wanted = new Set(${actorIdsJson});
    const scene = window.__openClinXrDebugScene;
    const rows = [];
    if (!scene || !scene.traverse) return rows;
    function actorIdOf(o) {
      let cur = o;
      while (cur) {
        if (cur.userData && typeof cur.userData.openClinXrActorId === "string" && cur.userData.openClinXrActorId.length > 0) {
          return cur.userData.openClinXrActorId;
        }
        cur = cur.parent;
      }
      return null;
    }
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const aid = actorIdOf(o);
      if (!aid || !wanted.has(aid)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      let tris = 0;
      if (o.geometry && o.geometry.index) tris = Math.floor(o.geometry.index.count / 3);
      else if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        tris = Math.floor(o.geometry.attributes.position.count / 3);
      }
      rows.push({
        actorId: aid,
        meshName: o.name || "",
        materialName: m && m.name ? String(m.name) : "",
        alphaTest: m && typeof m.alphaTest === "number" ? m.alphaTest : null,
        opacity: m && typeof m.opacity === "number" ? m.opacity : null,
        transparent: m ? Boolean(m.transparent) : null,
        visible: o.visible !== false,
        frustumCulled: Boolean(o.frustumCulled),
        triangles: tris,
      });
    });
    return rows;
  })()`)) as Array<Record<string, unknown>>;
  return (raw ?? []).map((r) => ({
    scenarioId: PEDS_ASTHMA_SCENARIO_ID,
    actorId: String(r.actorId ?? ""),
    meshName: String(r.meshName ?? ""),
    materialName: String(r.materialName ?? ""),
    alphaTest: Number(r.alphaTest ?? 0),
    opacity: Number(r.opacity ?? 1),
    transparent: Boolean(r.transparent),
    visible: Boolean(r.visible),
    frustumCulled: Boolean(r.frustumCulled),
    triangles: Number(r.triangles ?? 0),
  }));
}

/**
 * Decisive render test, in-page. Three checks, all synchronously against the live
 * scene (no animation drift between renders):
 *
 *   1. per-mesh render: each body primitive alone against a magenta clear colour,
 *      whole-figure framed → non-clear pixel count. ~0 ⇒ the renderer discards
 *      that material; thousands ⇒ it does not.
 *   2. opacity=1 control: the FIRST hidden primitive per actor is re-rendered with
 *      material.opacity temporarily forced to 1. If that renders thousands of
 *      pixels in the same framing, the mesh IS in frame and visible — proving a
 *      ~0 result at opacity 0 is discard, not framing.
 *   3. whole-scene delta: the full scene is rendered twice with the hidden
 *      primitives visible vs invisible (same camera, synchronous). If the pixel
 *      counts are identical, the hidden primitives contribute nothing to the
 *      frame a learner sees.
 */
async function runRenderDiscardTest(page: Page, actorIds: readonly string[]): Promise<RenderDiscardRow[]> {
  const actorIdsJson = JSON.stringify([...actorIds]);
  return page.evaluate(`(() => {
    const THREE = window.__issue289THREE;
    if (!THREE) return { error: "no THREE" };
    const scene = window.__openClinXrDebugScene;
    const wanted = new Set(${actorIdsJson});
    if (!scene || !scene.traverse) return { error: "no scene" };
    const targets = [];
    function actorIdOf(o) {
      let cur = o;
      while (cur) {
        if (cur.userData && typeof cur.userData.openClinXrActorId === "string" && cur.userData.openClinXrActorId.length > 0) {
          return cur.userData.openClinXrActorId;
        }
        cur = cur.parent;
      }
      return null;
    }
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const aid = actorIdOf(o);
      if (!aid || !wanted.has(aid)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const matName = m && m.name ? String(m.name) : "";
      if (/basemesh/.test(o.name || "") || /openclinxr_hidden_/.test(matName)) {
        targets.push(o);
      }
    });
    if (targets.length === 0) return { error: "no body meshes", targets: 0 };

    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    renderer.setClearColor(0xff00ff, 1);
    const savedBackground = scene.background;
    const savedFog = scene.fog;
    scene.background = null;
    scene.fog = null;
    const out = [];

    // Save EVERY object's visible flag so the probe can be restored exactly.
    const savedAll = [];
    scene.traverse(function (o) { savedAll.push({ o, v: o.visible }); });

    function visibleChain(obj) {
      let cur = obj;
      while (cur) { cur.visible = true; cur = cur.parent; }
    }
    function countNonClear() {
      const gl = renderer.getContext();
      const px = new Uint8Array(512 * 512 * 4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < 512 * 512; i++) {
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
        if (Math.abs(r - 255) > 24 || Math.abs(g - 0) > 24 || Math.abs(b - 255) > 24) n++;
      }
      return n;
    }
    function actorRootOf(target) {
      let actorRoot = target;
      while (actorRoot.parent && !(actorRoot.userData && actorRoot.userData.openClinXrActorId)) {
        actorRoot = actorRoot.parent;
      }
      return actorRoot;
    }
    function figureCamFor(actorRoot) {
      const rootBox = new THREE.Box3().setFromObject(actorRoot);
      const center = rootBox.getCenter(new THREE.Vector3());
      const size = rootBox.getSize(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
      const dist = Math.max(size.x, size.y, size.z) * 1.3 + 0.6;
      cam.position.set(center.x + dist * 0.7, center.y + dist * 0.05, center.z + dist * 0.72);
      cam.lookAt(center);
      return cam;
    }
    function hideAllBut(target) {
      scene.traverse(function (o) {
        if (o === target) return;
        if (o.visible !== undefined) o.visible = false;
      });
      visibleChain(target);
      target.visible = true;
    }

    // per-mesh renders
    for (const target of targets) {
      hideAllBut(target);
      const cam = figureCamFor(actorRootOf(target));
      renderer.render(scene, cam);
      const nonClearPixels = countNonClear();
      const m = Array.isArray(target.material) ? target.material[0] : target.material;
      out.push({
        actorId: actorIdOf(target),
        meshName: target.name || "",
        materialName: m && m.name ? String(m.name) : "",
        nonClearPixels,
        controlOpacity1Pixels: null,
        sceneDeltaPixels: null,
      });
    }

    // opacity=1 control: first hidden mesh per actor must render thousands of px.
    // Wide framing so the whole figure (incl. the lower region) is in frame.
    function wideFigureCamFor(actorRoot) {
      const rootBox = new THREE.Box3().setFromObject(actorRoot);
      const center = rootBox.getCenter(new THREE.Vector3());
      const size = rootBox.getSize(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
      const dist = Math.max(size.x, size.y, size.z) * 1.6 + 1.0;
      cam.position.set(center.x + dist * 0.6, center.y + dist * 0.1, center.z + dist * 0.8);
      cam.lookAt(center);
      return cam;
    }
    for (const actorId of ${actorIdsJson}) {
      const hiddenTargets = targets.filter(function (t) {
        const aid = actorIdOf(t);
        const m = Array.isArray(t.material) ? t.material[0] : t.material;
        return aid === actorId && m && /openclinxr_hidden_/.test(m.name || "");
      });
      for (const t of hiddenTargets) {
        const m = Array.isArray(t.material) ? t.material[0] : t.material;
        const savedOpacity = m.opacity;
        m.opacity = 1;
        m.needsUpdate = true;
        hideAllBut(t);
        const cam = wideFigureCamFor(actorRootOf(t));
        renderer.render(scene, cam);
        const controlOpacity1Pixels = countNonClear();
        m.opacity = savedOpacity;
        m.needsUpdate = true;
        const row = out.find(function (r) { return r.actorId === actorId && r.meshName === t.name; });
        if (row) row.controlOpacity1Pixels = controlOpacity1Pixels;
      }
    }

    // whole-scene delta: hidden primitives visible vs invisible, same camera
    scene.traverse(function (o) { o.visible = savedAll.find(function (s) { return s.o === o; }).v; });
    const hiddenSet = new Set(targets.filter(function (t) {
      const m = Array.isArray(t.material) ? t.material[0] : t.material;
      return m && /openclinxr_hidden_/.test(m.name || "");
    }));
    const parentRoot = actorRootOf(targets.filter(function (t) {
      const m = Array.isArray(t.material) ? t.material[0] : t.material;
      return /openclinxr_hidden_/.test(m.name || "");
    })[0] || targets[0]);
    const cam = figureCamFor(parentRoot);
    renderer.render(scene, cam);
    const sceneWithHidden = countNonClear();
    for (const h of hiddenSet) h.visible = false;
    renderer.render(scene, cam);
    const sceneWithoutHidden = countNonClear();
    const sceneDeltaPixels = sceneWithHidden - sceneWithoutHidden;
    for (const h of hiddenSet) h.visible = true;
    for (const r of out) r.sceneDeltaPixels = sceneDeltaPixels;

    // restore everything
    for (const s of savedAll) s.o.visible = s.v;
    scene.background = savedBackground;
    scene.fog = savedFog;
    renderer.dispose();
    return { rows: out, sceneWithHidden, sceneWithoutHidden };
  })()`).then((res: unknown) => {
    const r = res as { rows?: Array<Record<string, unknown>>; sceneWithHidden?: number; sceneWithoutHidden?: number; error?: string };
    if (r.error || !r.rows) return [];
    return r.rows.map((row) => ({
      actorId: String(row.actorId ?? ""),
      meshName: String(row.meshName ?? ""),
      materialName: String(row.materialName ?? ""),
      nonClearPixels: Number(row.nonClearPixels ?? 0),
      controlSkinPixels: Number(row.controlOpacity1Pixels ?? 0),
      verdict: (Number(row.nonClearPixels ?? 0) <= 2 ? "discarded" : "renders") as "discarded" | "renders",
      controlOpacity1Pixels: Number(row.controlOpacity1Pixels ?? 0),
      sceneDeltaPixels: Number(row.sceneDeltaPixels ?? 0),
    }));
  });
}

export async function inspectIssue289RuntimeHide(input?: {
  baseUrl?: string;
  outputPath?: string;
}): Promise<Issue289PrefixReport> {
  const scenarioId = PEDS_ASTHMA_SCENARIO_ID;
  const cast = resolveScenarioActorCast(scenarioId);
  const libraryActors = cast.filter((c) => /body-param-.*-library\.glb/i.test(c.assetPath));
  const actorByBodyClass: Record<string, string> = {};
  for (const c of libraryActors) {
    if (/lean_female/i.test(c.assetPath)) actorByBodyClass["adult_lean_female"] = c.actorId;
    if (/heavy_male/i.test(c.assetPath)) actorByBodyClass["adult_heavy_male"] = c.actorId;
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "issue-289-hide-"));
  const filePrimitives: FilePrimitiveRow[] = [];
  const byMaterial = new Map<string, { pokingFacesBySlot: Record<Slot, number>; hiddenFacesBySlot: Record<Slot, number> }>();
  const fileRegionBySlot = new Map<string, Partial<Record<Slot, { regionFaceCount: number; noGarmentNearbyFaceCount: number; garmentInFrontFaceCount: number }>>>();
  try {
    for (const bodyClassId of Object.keys(BODY_CLASS_GLBS)) {
      const res = await analyzeBodyFile(bodyClassId, tmpDir);
      filePrimitives.push(...res.rows);
      for (const [mat, v] of res.byMaterial) byMaterial.set(mat, v);
      fileRegionBySlot.set(bodyClassId, res.regionBySlot);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  const baseUrl = input?.baseUrl ?? await (async () => {
    ownedServer = true;
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    return server.url;
  })();

  let liveScene: LiveMeshRow[] = [];
  let renderDiscard: RenderDiscardRow[] = [];
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForAssetsAndFrames(page, 180_000);
        await page.waitForTimeout(1200); // settled load — #85 mid-load class
        await page.evaluate(`(async () => {
          const m = await import('/node_modules/.vite/deps/three.js');
          window.__issue289THREE = m;
          return typeof m.WebGLRenderer;
        })()`).catch(() => undefined);
        const wantedActors = Object.values(actorByBodyClass).filter(Boolean);
        liveScene = await dumpLiveMeshes(page, wantedActors);
        renderDiscard = await runRenderDiscardTest(page, wantedActors);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try { await stopPortlessDevServer(server.proc); } catch { /* ignore */ }
    }
  }

  // Join live rows to file-side poking membership by material name.
  const joined: JoinedRow[] = liveScene.map((live) => {
    const fp = byMaterial.get(live.materialName);
    const pokingFaces: Record<Slot, number> = fp
      ? fp.pokingFacesBySlot
      : { upper: 0, lower: 0 };
    const hiddenFaces: Record<Slot, number> = fp
      ? fp.hiddenFacesBySlot
      : { upper: 0, lower: 0 };
    const isHiddenMaterial = /^openclinxr_hidden_/i.test(live.materialName);
    const pokesOnThisPrimitive = pokingFaces.upper > 0 || pokingFaces.lower > 0;
    return {
      bodyClassId:
        Object.entries(actorByBodyClass).find(([, aid]) => aid === live.actorId)?.[0] ?? "",
      actorId: live.actorId,
      meshName: live.meshName,
      materialName: live.materialName,
      alphaTest: live.alphaTest,
      opacity: live.opacity,
      transparent: live.transparent,
      visible: live.visible,
      triangles: live.triangles,
      isHiddenMaterial,
      pokingFaces,
      hiddenFaces,
      pokesOnThisPrimitive,
    };
  });

  const hiddenRows = joined.filter((r) => r.isHiddenMaterial && r.triangles > 0);
  const pokesOnHiddenPrimitive = hiddenRows.some((r) => r.pokesOnThisPrimitive);
  const hiddenRender = renderDiscard.filter((r) => /openclinxr_hidden_/.test(r.materialName));
  // The renderer honours the discard when every hidden primitive renders ~0 pixels
  // at opacity 0, AND per body class at least one hidden primitive renders a solid
  // pixel mass (>= 500 px) with opacity forced to 1 — proving visibility of the
  // mesh in the same framing, so ~0 at opacity 0 is discard, not framing/culling.
  const hiddenAtOpacity0 = hiddenRender.every((r) => r.nonClearPixels <= 50);
  const bodiesWithVisibleControl = new Set(
    hiddenRender.filter((r) => r.controlOpacity1Pixels >= 500).map((r) => r.actorId),
  );
  const hiddenActorIds = new Set(hiddenRender.map((r) => r.actorId));
  const discardHonoured = hiddenRender.length > 0
    && hiddenAtOpacity0
    && [...hiddenActorIds].every((aid) => bodiesWithVisibleControl.has(aid));
  const sceneDeltaRow = hiddenRender[0];

  // Visible skin inside the garment's claim region: region faces not painted hidden.
  // The mask deliberately leaves these visible (garment-not-reach faces are NOT in
  // the hide set by design) — they are the ragged-hem / edge class the pixel captures
  // show, not a runtime failure.
  const visibleSkinInClaimRegion: Issue289PrefixReport["visibleSkinInClaimRegion"] = [];
  const hiddenByBodySlot = new Map<string, Record<Slot, { hidden: number; poking: number }>>();
  for (const fp of filePrimitives) {
    const key = `${fp.bodyClassId}`;
    const entry = hiddenByBodySlot.get(key) ?? { upper: { hidden: 0, poking: 0 }, lower: { hidden: 0, poking: 0 } };
    for (const slot of ["upper", "lower"] as const) {
      entry[slot].hidden += fp.hiddenFacesBySlot[slot];
      entry[slot].poking += fp.pokingFacesBySlot[slot];
    }
    hiddenByBodySlot.set(key, entry);
  }
  for (const [bodyClassId, entry] of hiddenByBodySlot) {
    for (const slot of ["upper", "lower"] as const) {
      const region = fileRegionBySlot.get(bodyClassId)?.[slot];
      const regionFaceCount = region?.regionFaceCount ?? 0;
      const hiddenFaceCount = entry[slot].hidden;
      const pokingFaceCount = entry[slot].poking;
      visibleSkinInClaimRegion.push({
        bodyClassId,
        slot,
        regionFaceCount,
        hiddenFaceCount,
        pokingFaceCount,
        noGarmentNearbyFaceCount: region?.noGarmentNearbyFaceCount ?? 0,
        garmentInFrontFaceCount: region?.garmentInFrontFaceCount ?? 0,
        visibleFaceCount: Math.max(0, regionFaceCount - hiddenFaceCount),
      });
    }
  }

  const summary = {
    pokesOnHiddenPrimitive,
    discardHonouredByRenderer: discardHonoured,
    wholeSceneDeltaPixels: sceneDeltaRow?.sceneDeltaPixels ?? null,
    headline:
      pokesOnHiddenPrimitive && discardHonoured === false
        ? "poking faces ARE on the hidden primitive and the renderer does NOT discard them — renderer finding"
        : pokesOnHiddenPrimitive && discardHonoured === true
          ? "poking faces are on the hidden primitive AND the renderer discards them — visible skin must be a non-poking class (or the capture predates the re-bake)"
          : pokesOnHiddenPrimitive
            ? "poking faces are on the hidden primitive; discard status not measured"
            : "poking faces are NOT on the hidden primitive — factory/asset misalignment",
  };

  const report: Issue289PrefixReport = {
    schemaVersion: "openclinxr.issue-289.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    scenarioId,
    filePrimitives,
    liveScene,
    joined,
    renderDiscard,
    visibleSkinInClaimRegion,
    summary,
    claimScope: "whether shipped body-part hiding (alpha-0 MASK) is honoured by the ui-xr renderer, per body primitive",
    notEvidenceFor: [
      "garment_aesthetics_or_quality",
      "clinical_wardrobe",
      "quest_readiness",
      "learner_readiness",
      "cloth_physics_or_deformation",
    ],
  };
  return report;
}

export async function writeIssue289Prefix(input?: { baseUrl?: string; outputPath?: string }): Promise<string> {
  const report = await inspectIssue289RuntimeHide(input);
  const outputPath = input?.outputPath ?? PRE_FIX_PATH_289;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`issue-289: wrote ${outputPath}\n`);
  process.stdout.write(`  headline: ${report.summary.headline}\n`);
  for (const r of report.joined.filter((x) => x.isHiddenMaterial || x.pokesOnThisPrimitive)) {
    process.stdout.write(
      `  ${r.actorId} ${r.meshName} mat=${r.materialName} alphaTest=${r.alphaTest} opacity=${r.opacity} `
      + `transparent=${r.transparent} tris=${r.triangles} pokes=[u${r.pokingFaces.upper}/l${r.pokingFaces.lower}] pokesOnThis=${r.pokesOnThisPrimitive}\n`,
    );
  }
  for (const r of report.renderDiscard) {
    process.stdout.write(
      `  RENDER ${r.actorId} ${r.meshName} mat=${r.materialName} nonClearPixels=${r.nonClearPixels} `
      + `opacity1Ctrl=${r.controlOpacity1Pixels} sceneDelta=${r.sceneDeltaPixels} => ${r.verdict}\n`,
    );
  }
  return outputPath;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("issue-289-runtime-hide.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const outFlag = args.find((a) => a.startsWith("--out="));
  writeIssue289Prefix({
    outputPath: outFlag ? outFlag.slice("--out=".length) : PRE_FIX_PATH_289,
  }).catch((err: unknown) => {
    console.error(`issue-289-runtime-hide: FAILED ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
