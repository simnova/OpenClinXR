/**
 * #189 — garment / scalp / skin mesh presence: exported glTF vs live three.js scene.
 *
 * Enumerates every shipped cast station dynamically (listShippedCastScenarioIds).
 * `inFile` comes from NodeIO over the cast GLB; `inScene` from the live graph under
 * each actor's openClinXrActorId root. The defect class is when those disagree.
 *
 * claimScope: mesh presence only (real garment, upper painted cloth, scalp, skin).
 * notEvidenceFor: garment quality/realism (#46), clinical validity, Quest readiness,
 * footwear (#188), room-prop texturing (#186), env black-volume scale.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type MeshKind = "real_garment" | "painted_cloth" | "scalp" | "skin" | "other";

export type MeshRow = {
  meshName: string;
  inFile: boolean;
  inScene: boolean;
  visible: boolean | null;
  frustumCulled: boolean | null;
  materialName: string | null;
  triangles: number;
  kind: MeshKind;
  worldAabb?: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
};

export type ActorRow = {
  scenarioId: string;
  actorId: string;
  assetBasename: string;
  meshes: MeshRow[];
};

export type ActorGarmentPresenceReport = {
  actors: ActorRow[];
  claimScope: string;
  notEvidenceFor: string[];
};

type FilePrimitive = {
  meshName: string;
  materialName: string;
  triangles: number;
  kind: MeshKind;
};

type LiveMesh = {
  name: string;
  materialName: string;
  visible: boolean;
  frustumCulled: boolean;
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] } | null;
};

/** In-process cache — three vitest cases share one Vite boot. */
let cachedReport: ActorGarmentPresenceReport | null = null;
let measureInFlight: Promise<ActorGarmentPresenceReport> | null = null;

function primitiveTriangleCount(prim: {
  getIndices: () => { getCount: () => number } | null;
  getAttribute: (name: string) => { getCount: () => number } | null;
}): number {
  const indices = prim.getIndices();
  if (indices) return Math.floor(indices.getCount() / 3);
  const pos = prim.getAttribute("POSITION");
  if (pos) return Math.floor(pos.getCount() / 3);
  return 0;
}

/**
 * Kind from mesh + material names.
 *
 * painted_cloth is UPPER-torso paint only (top/torso/upper/soft_trim). Lower/arm/pants
 * paint is intentional under #73 (kept when real garment covers the torso) and is "other"
 * so the counterweight does not red the known-good child (real tshirt + jeans paint).
 */
export function classifyMeshKind(meshName: string, materialName: string): MeshKind {
  const blob = `${meshName} ${materialName}`.toLowerCase();
  if (/openclinxr_real_garment|real_garment_from_phenotype|real_garment_/.test(blob)) {
    return "real_garment";
  }
  if (/scalp|native_scalp|hair_surface|hair_cap/.test(blob) && !/eyelash|brow/.test(blob)) {
    return "scalp";
  }
  if (/anny_generated_pbr|skin_pbr|generated_skin/.test(blob)) {
    return "skin";
  }
  if (/role_mesh_clothing|openclinxr_role_mesh_clothing|clothing_(parent|nurse|patient|spouse)/.test(blob)) {
    // Upper-torso conflict class only — not lower/arm.
    if (/(?:^|_)(top|torso|upper|soft_trim|gown)(?:$|_)/.test(blob) || /clothing_.*_(top|torso|upper)/.test(blob)) {
      return "painted_cloth";
    }
    return "other";
  }
  return "other";
}

async function readFilePrimitives(assetPath: string): Promise<FilePrimitive[]> {
  const abs = path.isAbsolute(assetPath) ? assetPath : path.join(repoRoot, assetPath);
  if (!existsSync(abs)) {
    throw new Error(`actor-garment-presence: missing GLB ${assetPath}`);
  }
  const document = await new NodeIO().read(abs);
  const root = document.getRoot();
  const out: FilePrimitive[] = [];
  const base = path.basename(assetPath, ".glb");

  for (const mesh of root.listMeshes()) {
    const meshName = mesh.getName() || "";
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const materialName = mat?.getName() || "";
      const triangles = primitiveTriangleCount(prim);
      const kind = classifyMeshKind(meshName, materialName);
      // Multi-prim base: stable name mesh::material so scalp/skin/paint split.
      const rowName =
        mesh.listPrimitives().length > 1 && materialName
          ? `${meshName || `${base}.anny_base`}::${materialName}`
          : meshName || `${base}.mesh`;
      out.push({ meshName: rowName, materialName, triangles, kind });
    }
  }
  return out;
}

function materialKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function bestLiveMatch(
  file: FilePrimitive,
  live: LiveMesh[],
  used: Set<number>,
): LiveMesh | null {
  const fileMat = materialKey(file.materialName);
  const fileMesh = materialKey(file.meshName);

  // 1) Exact material name key match.
  for (let i = 0; i < live.length; i += 1) {
    if (used.has(i)) continue;
    const lm = live[i]!;
    const liveMat = materialKey(lm.materialName);
    if (fileMat && liveMat && (liveMat === fileMat || liveMat.includes(fileMat) || fileMat.includes(liveMat))) {
      used.add(i);
      return lm;
    }
  }

  // 2) Mesh name key containment (phenotype rename path).
  for (let i = 0; i < live.length; i += 1) {
    if (used.has(i)) continue;
    const lm = live[i]!;
    const liveName = materialKey(lm.name);
    if (
      fileMesh
      && liveName
      && (liveName.includes(fileMesh.slice(0, 24))
        || fileMesh.includes(liveName.slice(0, 24))
        || (file.kind === "real_garment" && /realgarment|fromphenotype/.test(liveName))
        || (file.kind === "scalp" && /scalp|hair/.test(liveName))
        || (file.kind === "skin" && /anny_base|skin|pbr/.test(liveName)))
    ) {
      // Prefer same kind-ish triangle band for real_garment when multiple.
      if (file.kind === "real_garment" && lm.triangles > 0) {
        const ratio = lm.triangles / Math.max(file.triangles, 1);
        if (ratio < 0.5 || ratio > 2.0) continue;
      }
      used.add(i);
      return lm;
    }
  }

  // 3) Kind + triangle nearest (for real_garment / scalp / skin only).
  if (file.kind === "real_garment" || file.kind === "scalp" || file.kind === "skin" || file.kind === "painted_cloth") {
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < live.length; i += 1) {
      if (used.has(i)) continue;
      const lm = live[i]!;
      const liveKind = classifyMeshKind(lm.name, lm.materialName);
      if (liveKind !== file.kind) continue;
      const delta = Math.abs(lm.triangles - file.triangles);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDelta < Math.max(file.triangles * 0.35, 200)) {
      used.add(bestIdx);
      return live[bestIdx]!;
    }
  }

  return null;
}

async function dumpLiveMeshesForScenario(
  page: Page,
  expectedActorIds: readonly string[],
): Promise<Map<string, LiveMesh[]>> {
  const actorIdsJson = JSON.stringify([...expectedActorIds]);
  // String evaluate — avoid tsx __name injection into page.evaluate.
  const raw = (await page.evaluate(`(() => {
    const expected = new Set(${actorIdsJson});
    const scene = window.__openClinXrDebugScene;
    const byActor = {};
    function actorIdOf(obj) {
      let cur = obj;
      while (cur) {
        if (cur.userData && typeof cur.userData.openClinXrActorId === "string" && cur.userData.openClinXrActorId.length > 0) {
          return cur.userData.openClinXrActorId;
        }
        cur = cur.parent;
      }
      return null;
    }
    function worldAabb(o) {
      try {
        if (!o.geometry) return null;
        o.geometry.computeBoundingBox && o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox) return null;
        o.updateWorldMatrix(true, false);
        const box = o.geometry.boundingBox.clone();
        box.applyMatrix4(o.matrixWorld);
        return {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z]
        };
      } catch (e) {
        return null;
      }
    }
    if (!scene || !scene.traverse) return byActor;
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const aid = actorIdOf(o);
      if (!aid || (expected.size > 0 && !expected.has(aid))) return;
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      const matName = mats[0] && mats[0].name ? String(mats[0].name) : "";
      var tris = 0;
      if (o.geometry && o.geometry.index) tris = Math.floor(o.geometry.index.count / 3);
      else if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        tris = Math.floor(o.geometry.attributes.position.count / 3);
      }
      if (!byActor[aid]) byActor[aid] = [];
      byActor[aid].push({
        name: o.name || "",
        materialName: matName,
        visible: o.visible !== false,
        frustumCulled: Boolean(o.frustumCulled),
        triangles: tris,
        worldAabb: worldAabb(o)
      });
    });
    return byActor;
  })()`)) as Record<string, LiveMesh[]>;

  const map = new Map<string, LiveMesh[]>();
  for (const [id, rows] of Object.entries(raw ?? {})) {
    map.set(id, Array.isArray(rows) ? rows : []);
  }
  return map;
}

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      return skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

function composeActorRow(
  scenarioId: string,
  actorId: string,
  assetBasename: string,
  filePrims: FilePrimitive[],
  live: LiveMesh[],
): ActorRow {
  const used = new Set<number>();
  const meshes: MeshRow[] = [];

  // Prefer presence-relevant kinds first so matching does not steal rows.
  const ordered = [...filePrims].sort((a, b) => {
    const rank = (k: MeshKind) =>
      k === "real_garment" ? 0 : k === "scalp" ? 1 : k === "painted_cloth" ? 2 : k === "skin" ? 3 : 4;
    return rank(a.kind) - rank(b.kind);
  });

  for (const fp of ordered) {
    if (fp.kind === "other" && fp.triangles <= 2) {
      // Declared-layer 1-tri markers: record inFile only; scene absence is fine.
      meshes.push({
        meshName: fp.meshName,
        inFile: true,
        inScene: false,
        visible: null,
        frustumCulled: null,
        materialName: fp.materialName || null,
        triangles: fp.triangles,
        kind: fp.kind,
        worldAabb: null,
      });
      continue;
    }
    const match = bestLiveMatch(fp, live, used);
    meshes.push({
      meshName: fp.meshName,
      inFile: true,
      inScene: Boolean(match),
      visible: match ? match.visible : null,
      frustumCulled: match ? match.frustumCulled : null,
      materialName: match?.materialName || fp.materialName || null,
      triangles: fp.triangles,
      kind: fp.kind,
      worldAabb: match?.worldAabb ?? null,
    });
  }

  // Live-only meshes (debug cues etc.) — record as inScene without inFile for diagnostics.
  for (let i = 0; i < live.length; i += 1) {
    if (used.has(i)) continue;
    const lm = live[i]!;
    const kind = classifyMeshKind(lm.name, lm.materialName);
    if (kind === "other" && lm.triangles < 50) continue;
    meshes.push({
      meshName: lm.name || `(live-${i})`,
      inFile: false,
      inScene: true,
      visible: lm.visible,
      frustumCulled: lm.frustumCulled,
      materialName: lm.materialName || null,
      triangles: lm.triangles,
      kind,
      worldAabb: lm.worldAabb,
    });
  }

  return { scenarioId, actorId, assetBasename, meshes };
}

async function measureLiveAllStations(input?: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorGarmentPresenceReport> {
  const scenarios =
    input?.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("inspectActorGarmentPresence: listShippedCastScenarioIds returned empty");
  }

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input?.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const actors: ActorRow[] = [];
        for (const scenarioId of scenarios) {
          const cast = resolveScenarioActorCast(scenarioId);
          if (cast.length === 0) continue;
          process.stdout.write(`garment-presence: goto ${scenarioId} (${cast.length} actors)\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 8, 180_000);
          // Settled load — #85 bare-mannequin mid-load class.
          await page.waitForTimeout(1200);
          const liveByActor = await dumpLiveMeshesForScenario(
            page,
            cast.map((c) => c.actorId),
          );

          for (const entry of cast) {
            const filePrims = await readFilePrimitives(entry.assetPath);
            const live = liveByActor.get(entry.actorId) ?? [];
            const row = composeActorRow(
              scenarioId,
              entry.actorId,
              path.basename(entry.assetPath),
              filePrims,
              live,
            );
            actors.push(row);
            const droppedGarments = row.meshes.filter(
              (m) =>
                (m.kind === "real_garment" || m.kind === "painted_cloth" || m.kind === "scalp")
                && m.inFile
                && (!m.inScene || m.visible === false),
            );
            process.stdout.write(
              `  ${entry.actorId}: live=${live.length} filePrims=${filePrims.length} dropped=${droppedGarments.length}\n`,
            );
          }
        }

        return {
          actors,
          claimScope:
            "mesh_presence_asset_to_live_scene: real_garment, upper_painted_cloth, scalp, skin — not garment quality",
          notEvidenceFor: [
            "clinical_validity",
            "exam_equivalence",
            "scoring",
            "garment_quality_or_realism",
            "quest_readiness",
            "learner_readiness",
            "footwear",
            "room_prop_texturing",
          ],
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Measure every shipped cast actor: file meshes vs live scene presence.
 * Cached in-process so the three planted vitest cases share one boot.
 */
export async function inspectActorGarmentPresence(input?: {
  baseUrl?: string;
  force?: boolean;
  scenarioIds?: string[];
}): Promise<ActorGarmentPresenceReport> {
  if (!input?.force && !input?.scenarioIds && cachedReport) return cachedReport;
  if (!input?.force && !input?.scenarioIds && measureInFlight) return measureInFlight;

  const run = (async () => {
    const report = await measureLiveAllStations({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });
    if (!input?.scenarioIds) cachedReport = report;
    return report;
  })();

  if (!input?.scenarioIds) measureInFlight = run;
  try {
    return await run;
  } finally {
    if (measureInFlight === run) measureInFlight = null;
  }
}

/** CLI: write a flat pre-fix / diagnostic table. */
export async function writeGarmentPresencePreFix(input?: {
  outputPath?: string;
  scenarioIds?: string[];
  force?: boolean;
}): Promise<string> {
  const report = await inspectActorGarmentPresence({
    force: input?.force ?? true,
    scenarioIds: input?.scenarioIds,
  });
  const outputPath =
    input?.outputPath
    ?? path.join(repoRoot, ".openclinxr/evidence/issue-189/pre-fix.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const rows = report.actors.flatMap((a) =>
    a.meshes.map((m) => ({
      scenarioId: a.scenarioId,
      actorId: a.actorId,
      assetBasename: a.assetBasename,
      meshName: m.meshName,
      inFile: m.inFile,
      inScene: m.inScene,
      visible: m.visible,
      frustumCulled: m.frustumCulled,
      materialName: m.materialName,
      worldAabb: m.worldAabb ?? null,
      triangles: m.triangles,
      kind: m.kind,
    })),
  );
  const payload = {
    schemaVersion: "openclinxr.issue-189.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    claimScope: report.claimScope,
    notEvidenceFor: report.notEvidenceFor,
    ambientFailureClass:
      "measure names the hop: file↔scene disagreement on real_garment / scalp / skin",
    rows,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`garment-presence: wrote ${outputPath} (${rows.length} rows)\n`);
  return outputPath;
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("actor-garment-presence-in-scene.ts")
    || process.argv[1].endsWith("actor-garment-presence-in-scene.js"));

if (isDirectRun) {
  const args = process.argv.slice(2);
  let scenarioFilter: string[] | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--scenario" && args[i + 1]) {
      scenarioFilter = (scenarioFilter ?? []).concat(args[++i]!);
    } else if (arg === "--out" && args[i + 1]) {
      out = args[++i]!;
    }
  }
  writeGarmentPresencePreFix({
    force: true,
    scenarioIds: scenarioFilter,
    outputPath: out,
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
