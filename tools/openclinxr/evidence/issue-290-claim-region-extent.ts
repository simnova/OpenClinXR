/**
 * issue-290 — the garment claim region is internally consistent (#289); measure
 * whether the claim is the right SIZE.
 *
 * #289 proved every face inside each garment's claim region is hidden or behind
 * cloth (`noGarmentNearby = 0`, four body/slot pairs). This module measures the
 * region's EXTENT on the same shipped library GLBs and publishes the table —
 * no target extent, no threshold change (standing rule: a numeric threshold does
 * not enter a contract until it has been run against the population and published).
 *
 * Per body class x slot (upper/lower), using the SAME shared pure-numpy predicate
 * the factory gate imports (`garment_coverage.py`, driven exactly as the evidence
 * module `garment-covers-its-region.ts` drives it):
 *
 *   1. the claim region's vertical band and per-slice lateral footprint, in
 *      body-height fractions (region = band x the garment's own silhouette —
 *      the issue-283 corrected claim);
 *   2. the body-surface faces IMMEDIATELY OUTSIDE each boundary (above band,
 *      below band, lateral past the silhouette) with count + height/lateral
 *      position in body-height fractions;
 *   3. which of those outside faces the DEFAULT CAPTURE CAMERA sees — a geometric
 *      visibility test at the live scene-overview camera: in frustum, front-facing,
 *      and not occluded by ANY skinned humanoid triangle in the scene (all three
 *      peds actors, each transformed by its live world placement matrix).
 *
 * The heavy computation runs in the python driver
 * `issue-290-claim-region-extent.py` (pure numpy, deterministic). The live probe
 * is ONE ui-xr boot reusing the #289 scene probe (portless server + room-capture
 * URL + asset-evidence wait) — it reads the camera pose and the actors' live world
 * matrices; it renders nothing.
 *
 * claimScope: the vertical/lateral extent of the garment claim region on the two
 * shipped body-param library bodies, and the camera-visible bare-skin census
 * immediately outside it at the default scene-overview capture camera.
 * notEvidenceFor: garment aesthetics/quality, clinical wardrobe correctness,
 * Quest readiness, cloth physics/deformation, any target extent recommendation.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import { PEDS_ASTHMA_SCENARIO_ID, resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  readLivePostureGeometryFromPage,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

export const ISSUE_ID = "issue-290";
export const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence", ISSUE_ID);
export const ARTIFACT_PATH = path.join(EVIDENCE_DIR, "claim-region-extent.json");

export const CANDIDATES_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates");
export const GENERATED_HUMANOIDS_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
export const DRIVER_MODULE = path.join(HERE, "issue-290-claim-region-extent.py");

const LIBRARY_GLBS: Record<string, { glb: string; upperToken: string; lowerToken: string }> = {
  adult_lean_female: {
    glb: "body-param-adult_lean_female-library.glb",
    upperToken: "shirt",
    lowerToken: "pants",
  },
  adult_heavy_male: {
    glb: "body-param-adult_heavy_male-library.glb",
    upperToken: "shirt",
    lowerToken: "pants",
  },
};

const CHILD_GLB = "peds_patient_child.glb";

/** The default capture camera the room-capture mode uses (main.ts scene-overview branch). */
export const EXPECTED_CAMERA = {
  mode: ROOM_CAPTURE_MODE,
  framing: "generated_scene_overview_multi_actor_dynamic_encounter_capture_clinical_focus",
  fov: 60,
  position: [0.18, 1.32, 4.35],
  lookAt: [0.02, 1.02, -0.08],
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
    }
  }
  return { position, indices, triangles };
}

type ExtractedMesh = { name: string; geom: MeshGeom };

/** Classify a mesh name into body / upper garment / lower garment / footwear (mirrors #289). */
function classifyMeshName(name: string): "body" | "upper" | "lower" | "footwear" | "other" {
  if (/basemesh|anny_base/i.test(name)) return "body";
  if (/footwear|shoe|slipper/i.test(name)) return "footwear";
  if (/pants|trouser/i.test(name)) return "lower";
  if (/scrub|shirt|garment|gown|tshirt|top/i.test(name)) return "upper";
  return "other";
}

async function extractMeshes(
  io: NodeIO,
  glbPath: string,
): Promise<{ meshes: ExtractedMesh[]; body: ExtractedMesh }> {
  if (!existsSync(glbPath)) throw new Error(`issue-290: missing GLB ${glbPath}`);
  const doc = await io.read(glbPath);
  const meshes: ExtractedMesh[] = [];
  let body: ExtractedMesh | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    // Skip the 1-triangle declared-layer marker meshes (SSOT markers, not garments).
    if (/declared_upper_layers/i.test(name)) continue;
    const kind = classifyMeshName(name);
    if (kind === "other") continue;
    const geom = meshGeom(mesh);
    const entry = { name, geom };
    meshes.push(entry);
    if (kind === "body" && !body) body = entry;
  }
  if (!body) throw new Error(`issue-290: no body mesh in ${glbPath}`);
  return { meshes, body };
}

async function writeMeshJson(dir: string, stem: string, mesh: ExtractedMesh): Promise<string> {
  const p = path.join(dir, `${stem}.json`);
  await writeFile(p, JSON.stringify({ position: mesh.geom.position, indices: mesh.geom.indices }));
  return p;
}

type LiveCameraRead = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  aspect: number;
  near: number;
  far: number;
  framing: string;
};

type LiveActorRead = {
  actorId: string;
  meshName: string;
  matrixWorldElements: number[];
  liveTriangleCount: number;
};

type LiveProbe = {
  camera: LiveCameraRead | null;
  actors: LiveActorRead[];
  assetEvidence: {
    pendingCount: number;
    loadedCount: number;
    failedCount: number;
    failedAssets: Array<{ assetId: string; assetPath: string }>;
    loadedAssets: string[];
  } | null;
  livePosture: Array<Record<string, unknown>>;
};

async function readLiveProbeFromPage(page: Page, wantedActorIds: readonly string[]): Promise<{
  camera: LiveCameraRead | null;
  actors: LiveActorRead[];
  assetEvidence: {
    pendingCount: number;
    loadedCount: number;
    failedCount: number;
    failedAssets: Array<{ assetId: string; assetPath: string }>;
    loadedAssets: string[];
  } | null;
}> {
  const wantedJson = JSON.stringify([...wantedActorIds]);
  const raw = (await page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    const wanted = new Set(${wantedJson});
    const out = { camera: null, actors: [] };
    if (!scene || typeof scene.traverse !== "function") return out;
    scene.updateMatrixWorld(true);
    let cam = null;
    scene.traverse(function (o) { if (o.isCamera && !cam) cam = o; });
    if (cam) {
      out.camera = {
        position: [cam.position.x, cam.position.y, cam.position.z],
        quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
        fov: cam.fov,
        aspect: cam.aspect,
        near: cam.near,
        far: cam.far,
        framing: (cam.userData && cam.userData.openClinXrCameraFraming) || ""
      };
    }
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
    const found = {};
    scene.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      const aid = actorIdOf(o);
      if (!aid || !wanted.has(aid) || found[aid]) return;
      if (!/basemesh|anny_base/i.test(o.name || "")) return;
      found[aid] = true;
      o.updateMatrixWorld(true);
      out.actors.push({
        actorId: aid,
        meshName: o.name || "",
        matrixWorldElements: Array.from(o.matrixWorld.elements),
        liveTriangleCount: (o.geometry && o.geometry.index) ? Math.floor(o.geometry.index.count / 3) : 0
      });
    });
    return out;
  })()`)) as { camera?: LiveCameraRead | null; actors?: LiveActorRead[] };
  const evidence = (await page.evaluate(`(() => {
    const w = window;
    const e = w.__openClinXrSceneAssetEvidence;
    if (!e) return null;
    const assets = Array.isArray(e.assets) ? e.assets : [];
    return {
      pendingCount: e.pendingCount || 0,
      loadedCount: e.loadedCount || 0,
      failedCount: e.failedCount || 0,
      failedAssets: assets.filter(function (a) { return a.status === "failed"; })
        .map(function (a) { return { assetId: a.assetId || "", assetPath: a.assetPath || "" }; }),
      loadedAssets: assets.filter(function (a) { return a.status === "loaded" && a.fallbackActive !== true; })
        .map(function (a) { return a.assetPath || a.assetId || ""; }),
    };
  })()`)) as {
    pendingCount: number;
    loadedCount: number;
    failedCount: number;
    failedAssets: Array<{ assetId: string; assetPath: string }>;
    loadedAssets: string[];
  } | null;
  return {
    camera: raw.camera ?? null,
    actors: raw.actors ?? [],
    assetEvidence: evidence,
  };
}

/** One ui-xr boot, reusing the #289 scene probe infra. Renders nothing. */
export async function runLiveProbe(input?: { baseUrl?: string }): Promise<LiveProbe> {
  const scenarioId = PEDS_ASTHMA_SCENARIO_ID;
  const cast = resolveScenarioActorCast(scenarioId);
  const wantedActorIds = cast.map((c) => c.actorId);

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  const baseUrl = input?.baseUrl ?? await (async () => {
    ownedServer = true;
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    return server.url;
  })();

  let probe: LiveProbe = {
    camera: null,
    actors: [],
    assetEvidence: { pendingCount: 0, loadedCount: 0, failedCount: 0, failedAssets: [], loadedAssets: [] },
    livePosture: [],
  };
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidAssetsLoaded(page, 180_000);
        await page.waitForTimeout(1200); // settled load — #85 mid-load class
        const { camera, actors, assetEvidence } = await readLiveProbeFromPage(page, wantedActorIds);
        let livePosture: Array<Record<string, unknown>> = [];
        try {
          const posture = await readLivePostureGeometryFromPage(page);
          livePosture = posture.actors as Array<Record<string, unknown>>;
        } catch {
          // posture read is a sanity cross-check only; a failure must not sink the probe
        }
        probe = { camera, actors, assetEvidence, livePosture };
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
  return probe;
}

type FigureBuild = {
  bodyClassId: string;
  glbPath: string;
  actorId: string;
  matrixWorldElements: number[];
  bodyMeshPath: string;
  garmentMeshes: Array<{ path: string; slot: "upper" | "lower" | "footwear"; meshName: string }>;
};

async function buildManifest(
  tmpDir: string,
  probe: LiveProbe,
): Promise<{
  manifest: Record<string, unknown>;
  figures: FigureBuild[];
  liveBodyBounds: Array<Record<string, unknown>>;
  cameraSane: boolean;
  cameraNote: string;
}> {
  const io = new NodeIO();

  // actorId -> bodyClassId for the two library subjects (mirrors #289).
  const cast = resolveScenarioActorCast(PEDS_ASTHMA_SCENARIO_ID);
  const actorByBodyClass: Record<string, string> = {};
  for (const c of cast) {
    if (/lean_female/i.test(c.assetPath)) actorByBodyClass["adult_lean_female"] = c.actorId;
    if (/heavy_male/i.test(c.assetPath)) actorByBodyClass["adult_heavy_male"] = c.actorId;
  }
  const childActorId = cast.find((c) => /peds_patient_child/i.test(c.assetPath))?.actorId
    ?? "patient_maya_johnson_v1";

  const placementByActor = new Map(probe.actors.map((a) => [a.actorId, a.matrixWorldElements]));
  const missing = Object.values(actorByBodyClass).filter((aid) => !placementByActor.has(aid));
  if (missing.length > 0) {
    throw new Error(`issue-290: live probe did not find placements for ${missing.join(", ")}`);
  }

  const figures: FigureBuild[] = [];
  const manifestActors: Array<Record<string, unknown>> = [];

  for (const [bodyClassId, cfg] of Object.entries(LIBRARY_GLBS)) {
    const actorId = actorByBodyClass[bodyClassId];
    if (!actorId) {
      throw new Error(`issue-290: no live actor mapped for ${bodyClassId}`);
    }
    const placement = placementByActor.get(actorId);
    if (!placement) {
      throw new Error(`issue-290: no live placement for ${actorId}`);
    }
    const { meshes, body } = await extractMeshes(io, path.join(CANDIDATES_DIR, cfg.glb));
    const bodyPath = await writeMeshJson(tmpDir, `body-${bodyClassId}`, body);
    const garmentMeshes: FigureBuild["garmentMeshes"] = [];
    const occluders: Array<{ path: string; kind: string; meshName: string }> = [
      { path: bodyPath, kind: "body", meshName: body.name },
    ];
    for (const m of meshes) {
      if (m === body) continue;
      const kind = classifyMeshName(m.name);
      if (kind === "body") continue;
      const p = await writeMeshJson(tmpDir, `${bodyClassId}-${m.name.replace(/[^a-zA-Z0-9]+/g, "_")}`, m);
      const slot = kind === "upper" ? "upper" : kind === "lower" ? "lower" : "footwear";
      garmentMeshes.push({ path: p, slot, meshName: m.name });
      occluders.push({ path: p, kind: slot === "footwear" ? "footwear" : "garment", meshName: m.name });
    }
    figures.push({
      bodyClassId,
      glbPath: path.join("apps/ui-xr/public/xr-assets/humanoids/candidates", cfg.glb),
      actorId,
      matrixWorldElements: placement,
      bodyMeshPath: bodyPath,
      garmentMeshes,
    });
    manifestActors.push({
      actorId,
      isSubject: true,
      matrixWorldElements: placement,
      occluderMeshes: occluders,
    });
  }

  // Child patient: occluder-only actor (its geometry can occlude the adults' skin
  // from the capture camera; it is not a claim-region subject).
  const childPlacement = placementByActor.get(childActorId);
  const { meshes: childMeshes, body: childBody } = await extractMeshes(io, path.join(GENERATED_HUMANOIDS_DIR, CHILD_GLB));
  const childOccluders: Array<{ path: string; kind: string; meshName: string }> = [];
  const childBodyPath = await writeMeshJson(tmpDir, "child-body", childBody);
  childOccluders.push({ path: childBodyPath, kind: "body", meshName: childBody.name });
  for (const m of childMeshes) {
    if (m === childBody) continue;
    const kind = classifyMeshName(m.name);
    if (kind === "other") continue;
    const p = await writeMeshJson(tmpDir, `child-${m.name.replace(/[^a-zA-Z0-9]+/g, "_")}`, m);
    childOccluders.push({ path: p, kind, meshName: m.name });
  }
  manifestActors.push({
    actorId: childActorId,
    isSubject: false,
    matrixWorldElements: childPlacement ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    occluderMeshes: childOccluders,
  });

  // Camera sanity vs the deterministic default (main.ts scene-overview branch).
  const cam = probe.camera;
  let cameraSane = false;
  let cameraNote = "camera not read from live scene";
  if (cam) {
    const dp = Math.hypot(
      cam.position[0] - EXPECTED_CAMERA.position[0],
      cam.position[1] - EXPECTED_CAMERA.position[1],
      cam.position[2] - EXPECTED_CAMERA.position[2],
    );
    const framingOk = cam.framing.includes("generated_scene_overview");
    cameraSane = dp < 0.1 && framingOk && Math.abs(cam.fov - EXPECTED_CAMERA.fov) < 1.0;
    cameraNote = cameraSane
      ? `live camera matches the scene-overview default (Δpos=${dp.toFixed(3)} m, fov ${cam.fov}, framing "${cam.framing}")`
      : `live camera DEVIATES from expected: Δpos=${dp.toFixed(3)} m, fov ${cam.fov}, framing "${cam.framing}"`;
  }

  const manifest = {
    camera: cam ?? {
      position: EXPECTED_CAMERA.position,
      quaternion: [0, 0, 0, 1],
      fov: EXPECTED_CAMERA.fov,
      aspect: 1440 / 900,
      near: 0.1,
      far: 100,
      framing: EXPECTED_CAMERA.framing,
    },
    figures: figures.map((f) => ({
      bodyClassId: f.bodyClassId,
      glbPath: f.glbPath,
      actorId: f.actorId,
      matrixWorldElements: f.matrixWorldElements,
      bodyMeshPath: f.bodyMeshPath,
      garmentMeshes: f.garmentMeshes.map((g) => ({ path: g.path, slot: g.slot, meshName: g.meshName })),
      slots: [{ slot: "upper" }, { slot: "lower" }],
    })),
    actors: manifestActors,
  };

  const liveBodyBounds: Array<Record<string, unknown>> = probe.livePosture;

  return { manifest, figures, liveBodyBounds, cameraSane, cameraNote };
}

export async function inspectClaimRegionExtent(input?: {
  baseUrl?: string;
  outputPath?: string;
  skipLiveBounds?: boolean;
}): Promise<Record<string, unknown>> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "issue-290-extent-"));
  let report: Record<string, unknown>;
  try {
    const probe = await runLiveProbe({ baseUrl: input?.baseUrl });
    const built = await buildManifest(tmpDir, probe);
    const manifestPath = path.join(tmpDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(built.manifest));
    const driverOut = path.join(tmpDir, "report.json");
    try {
      await execFileAsync("python3", [DRIVER_MODULE, "--manifest", manifestPath, "--out", driverOut], {
        timeout: 900_000,
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      });
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; code?: number };
      throw new Error(
        `issue-290 driver failed (exit ${e.code}): ${String(e.stderr ?? e.stdout ?? e).slice(-2000)}`,
      );
    }
    const driverReport = JSON.parse(await readFile(driverOut, "utf8")) as { figures: unknown[] };

    report = {
      schemaVersion: "openclinxr.issue-290.claim-region-extent.v1",
      measuredAt: new Date().toISOString(),
      scenarioId: PEDS_ASTHMA_SCENARIO_ID,
      captureMode: ROOM_CAPTURE_MODE,
      camera: {
        mode: EXPECTED_CAMERA.mode,
        expected: EXPECTED_CAMERA,
        liveRead: probe.camera,
        sanity: built.cameraSane ? "matches_default_capture_camera" : "deviates_from_expected",
        note: built.cameraNote,
      },
      assetEvidence: probe.assetEvidence,
      liveBodyBounds: built.liveBodyBounds,
      actorWorldPlacements: probe.actors.map((a) => ({
        actorId: a.actorId,
        meshName: a.meshName,
        matrixWorldElements: a.matrixWorldElements,
        liveTriangleCount: a.liveTriangleCount,
      })),
      method: {
        regionDefinition:
          "band = garment full Y extent (same as #289); lateral = garment per-slice max |x| footprint, 24 slices "
          + "(garment_coverage._lateral_footprint); region = body faces with centroid Y in band AND centroid |x| <= footprint(slice) "
          + "— exactly the issue-283 corrected claim the factory predicate selects",
        bodyHeightFractions:
          "heightFraction = (centroidY - bodyMinY)/bodyHeight; lateralFraction = |centroidX|/bodyHeight",
        immediateRing:
          `vertical: ${RING_VERTICAL_FRACTION_DESC}; lateral: ${RING_LATERAL_DESC} (coverage ray tolerance)`,
        visibilityTest:
          "face visible at the default capture camera iff (a) projects inside the frustum (live fov/aspect), "
          + "(b) front-facing (outward normal toward the camera), (c) no skinned humanoid triangle of any peds actor "
          + "(child + parent + nurse bodies, garments, footwear, each transformed by its live world placement matrix) "
          + "is hit strictly before the face centroid along the camera ray. Geometry is the shipped GLB bind pose; "
          + "the clinical-idle pose displaces limbs ~1-3 cm from bind pose (residual, see notEvidenceFor).",
        coveredByGarment:
          "ring faces with signed clearance < 5 mm to ANY garment/footwear surface of the same figure "
          + "(#285/#289 hide-mask convention, body-normal sign, 8 cm search) — skin actually under cloth, camera-independent",
      },
      figures: driverReport.figures,
      summary: buildSummary(driverReport.figures as Array<Record<string, unknown>>),
      claimScope:
        "extent of the garment claim region on the two shipped body-param library GLBs, and the camera-visible "
        + "bare-skin census immediately outside it at the default scene-overview capture camera in the peds "
        + "asthma scenario",
      notEvidenceFor: [
        "garment_aesthetics_or_quality",
        "clinical_wardrobe_correctness",
        "quest_readiness",
        "learner_readiness",
        "cloth_physics_or_deformation",
        "any_target_extent_recommendation",
        "bind_pose_vs_idle_pose_limb_displacement_exactness",
        "furniture_or_environment_occlusion_of_outside_faces",
      ],
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return report;
}

const RING_VERTICAL_FRACTION_DESC = "8% of body height above/below the band";
const RING_LATERAL_DESC = "0.06 m past the garment silhouette";

function buildSummary(figures: Array<Record<string, unknown>>): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = [];
  for (const f of figures) {
    const slots = (f.slots ?? {}) as Record<string, Record<string, unknown>>;
    for (const slot of ["upper", "lower"] as const) {
      const s = slots[slot];
      if (!s) continue;
      const band = s.bandBodyHeightFraction as [number, number];
      const lat = s.lateralFootprintBodyHeightFraction as { min: number; max: number };
      const boundaries = (s.boundaries ?? {}) as Record<string, {
        immediateRing?: { faceCount: number; camera?: { visible?: number }; coveredByGarmentCount?: number };
        fullOutside?: { faceCount: number; camera?: { visible?: number; occlusionSampled?: boolean } };
      }>;
      const row: Record<string, unknown> = {
        bodyClassId: f.bodyClassId,
        actorId: f.actorId,
        slot,
        regionBandBodyHeightFraction: band,
        regionLateralFootprintMaxBodyHeightFraction: lat.max,
        regionFaceCount: s.regionFaceCount,
      };
      for (const b of ["above", "below", "lateral"] as const) {
        const bd = boundaries[b];
        row[`outside_${b}_ringFaces`] = bd?.immediateRing?.faceCount ?? 0;
        row[`outside_${b}_ringCameraVisible`] = bd?.immediateRing?.camera?.visible ?? 0;
        row[`outside_${b}_ringBareSkin`] = bd?.immediateRing?.coveredByGarmentCount === undefined
          ? null
          : (bd?.immediateRing?.faceCount ?? 0) - (bd?.immediateRing?.coveredByGarmentCount ?? 0);
        row[`outside_${b}_fullOutsideFaces`] = bd?.fullOutside?.faceCount ?? 0;
        row[`outside_${b}_fullCameraVisible`] = bd?.fullOutside?.camera?.visible ?? 0;
      }
      rows.push(row);
    }
  }
  return { rows };
}

export async function writeClaimRegionExtent(input?: {
  baseUrl?: string;
  outputPath?: string;
}): Promise<string> {
  const report = await inspectClaimRegionExtent(input);
  const outputPath = input?.outputPath ?? ARTIFACT_PATH;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`issue-290: wrote ${outputPath}\n`);
  const cam = report.camera as { note?: string; sanity?: string };
  process.stdout.write(`  camera: ${cam.sanity} — ${cam.note ?? ""}\n`);
  const rows = ((report.summary as { rows?: Array<Record<string, unknown>> }).rows ?? []);
  for (const r of rows) {
    process.stdout.write(
      `  ${String(r.bodyClassId).padEnd(18)} ${String(r.slot).padEnd(5)} `
      + `band=${JSON.stringify(r.regionBandBodyHeightFraction)} latMax=${r.regionLateralFootprintMaxBodyHeightFraction} `
      + `region=${r.regionFaceCount} | above ring=${r.outside_above_ringFaces} vis=${r.outside_above_ringCameraVisible} `
      + `| below ring=${r.outside_below_ringFaces} vis=${r.outside_below_ringCameraVisible} `
      + `| lateral ring=${r.outside_lateral_ringFaces} vis=${r.outside_lateral_ringCameraVisible}\n`,
    );
  }
  return outputPath;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("issue-290-claim-region-extent.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const outFlag = args.find((a) => a.startsWith("--out="));
  writeClaimRegionExtent({
    outputPath: outFlag ? outFlag.slice("--out=".length) : ARTIFACT_PATH,
  }).catch((err: unknown) => {
    console.error(`issue-290: FAILED ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
