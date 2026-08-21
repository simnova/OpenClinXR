/**
 * #544 — does wall roughness explain rend/albedo under IBL?
 *
 * Extends #543 (`three-fixes-combined-probe`: same IBL + aoMapIntensity 0 + hull + interior
 * camera). Runtime-only roughness override on the hexagon wall material — no GLB edit.
 * Rooms campaign stays CLOSED.
 *
 * Corrected rects from #543's row profile (NOT the original straddling wall rect):
 *   ceiling y 10-35%, wall y 40-65%, floor y 75-90% at x 8-50%.
 *
 * claimScope: whether a runtime wall roughness override changes rend/albedo at corrected
 *   per-surface rects on one room (both cells recorded; wall need not move).
 * notEvidenceFor: product lighting default; whether the room LOOKS right; other rooms;
 *   whether marble should be smooth as authored.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { resolveStationInteriorLightingVariantId } from "../../../apps/ui-xr/src/station-interior-lighting.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";
import {
  readInfinigenRoomLiveFacts,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import {
  SHEET_ROOM,
  SHEET_SCENARIO_ID,
} from "./interior-wall-lighting-variants.js";
import {
  buildThreeFixesCombinedUrl,
  forceInteriorWallCamera,
  hideHudPanels,
  readHullMaterialFacts,
  setAoMapIntensity,
} from "./three-fixes-combined-probe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

export const WALL_ROUGHNESS_PROBE_JSON = join(
  REPO,
  "tools/openclinxr/evidence/wall-roughness-probe.json",
);
export const WALL_ROUGHNESS_OUT_DIR = join(
  REPO,
  "tools/openclinxr/evidence/wall-roughness",
);

const GLB_REL = "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";

/**
 * Corrected #543 row-profile bands — clause (2) refuses bimodal (sd/mean > 0.5).
 * x 8-50%; ceiling y 10-35%; wall y 40-65%; floor y 75-90%.
 */
const WALL_BAND = { left: 0.08, top: 0.40, width: 0.42, height: 0.25 } as const;
const CEILING_BAND = { left: 0.08, top: 0.10, width: 0.42, height: 0.25 } as const;
const FLOOR_BAND = { left: 0.08, top: 0.75, width: 0.42, height: 0.15 } as const;

/** Inside-UV albedo from the planted contract — never a whole-atlas mean (#536). */
const ALBEDO = { wall: 190.5, ceiling: 254.8, floor: 247.0 } as const;

type RegionBand = { left: number; top: number; width: number; height: number };

export type WallRoughnessRegion = {
  id: "wall" | "ceiling" | "floor";
  meanL: number;
  sd: number;
  rect: [number, number, number, number];
  albedo: number;
  rendOverAlbedo: number;
};

export type WallRoughnessCell = {
  id: "wall_rough_010" | "wall_rough_070";
  wallRoughness: number;
  materialsTouched: number;
  materialNames: string[];
  regions: WallRoughnessRegion[];
  image: string;
};

export type WallRoughnessProbe = {
  schemaVersion: "openclinxr.wall-roughness-probe.v1";
  generatedAt: string;
  room: string;
  scenarioId: string;
  captureMode: string;
  lightingVariant: "room_environment_ibl";
  aoMapIntensity: 0;
  hullMaterialsApplied: boolean;
  hullAssignedCount: number;
  productDefaultVariant: string;
  camera: string;
  /** Relative to tools/openclinxr/evidence/ — primary sheet (treatment cell). */
  image: string;
  glbSha256: string;
  assetEdited: false;
  albedo: typeof ALBEDO;
  cells: WallRoughnessCell[];
  claimScope: string;
  notEvidenceFor: string[];
};

function bandToRect(b: RegionBand): [number, number, number, number] {
  return [b.left, b.top, b.width, b.height];
}

/**
 * Hide everything outside the Infinigen room root so the prescribed wall rect
 * (y 40-65%, x 8-50%) does not straddle humanoids / furniture — camera tag is
 * already `*_actorless_interior_eye`. Room door/shell stay visible.
 */
async function hideNonRoomSubjects(page: Page): Promise<number> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return 0;
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot) return 0;
    let n = 0;
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      let p = o;
      while (p) {
        if (p === roomRoot) return;
        p = p.parent;
      }
      if (o.visible) {
        o.visible = false;
        o.userData.openClinXrWallRoughnessProbeHidden = true;
        n += 1;
      }
    });
    return n;
  })()`) as Promise<number>;
}

/**
 * Runtime-only: set roughness on materials whose name matches /hexagon/i
 * (authored wall: shader_marble_shader_hexagon_tile_tile). No roughnessMap on this asset.
 */
async function setWallHexagonRoughness(
  page: Page,
  roughness: number,
): Promise<{ count: number; names: string[]; applied: number[] }> {
  return page.evaluate(`((roughness) => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") {
      return { count: 0, names: [], applied: [] };
    }
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    const root = roomRoot || scene;
    const seen = new Set();
    const names = [];
    const applied = [];
    root.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m || seen.has(m)) continue;
        const name = String(m.name || "");
        if (!/hexagon/i.test(name)) continue;
        seen.add(m);
        m.roughness = roughness;
        if ("needsUpdate" in m) m.needsUpdate = true;
        names.push(name);
        applied.push(typeof m.roughness === "number" ? m.roughness : roughness);
      }
    });
    return { count: names.length, names: names, applied: applied };
  })(${JSON.stringify(roughness)})`) as Promise<{
    count: number;
    names: string[];
    applied: number[];
  }>;
}

function measureRegions(bytes: Uint8Array): WallRoughnessRegion[] {
  const specs: Array<{ id: WallRoughnessRegion["id"]; band: RegionBand; albedo: number }> = [
    { id: "wall", band: WALL_BAND, albedo: ALBEDO.wall },
    { id: "ceiling", band: CEILING_BAND, albedo: ALBEDO.ceiling },
    { id: "floor", band: FLOOR_BAND, albedo: ALBEDO.floor },
  ];
  const out: WallRoughnessRegion[] = [];
  for (const s of specs) {
    const lum = regionLuminance(bytes, s.band, { step: 3, blackLuma: 4 });
    if (!lum) {
      throw new Error(`wall-roughness-probe: luminance decode failed for ${s.id}`);
    }
    const meanL = Number(lum.mean.toFixed(2));
    const sd = Number(lum.sd.toFixed(2));
    out.push({
      id: s.id,
      meanL,
      sd,
      rect: bandToRect(s.band),
      albedo: s.albedo,
      rendOverAlbedo: Number((meanL / s.albedo).toFixed(4)),
    });
  }
  return out;
}

export async function renderWallRoughnessProbe(input?: {
  baseUrl?: string;
  scenarioId?: string;
}): Promise<WallRoughnessProbe> {
  const scenarioId = input?.scenarioId ?? SHEET_SCENARIO_ID;
  const captureMode = "scene-overview";
  mkdirSync(WALL_ROUGHNESS_OUT_DIR, { recursive: true });

  const glbBytes = readFileSync(join(REPO, GLB_REL));
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
  const productDefaultVariant = resolveStationInteriorLightingVariantId(null);

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input?.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          cwd: REPO,
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1007, height: 900 } });
      const url = buildThreeFixesCombinedUrl(baseUrl, scenarioId, captureMode);
      process.stdout.write(`wall-roughness-probe: goto room_environment_ibl\n`);
      await page.goto(url, { waitUntil: "load", timeout: 180_000 });
      await waitForStationShell(page, 180_000);
      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.getObjectByName !== "function") return false;
          return !!scene.getObjectByName("openclinxr.station-environment.infinigen-room");
        })()`,
        null,
        { timeout: 180_000 },
      );
      const roomFacts = await readInfinigenRoomLiveFacts(page);
      if (!roomFacts.present) {
        throw new Error("wall-roughness-probe: Infinigen room never became present");
      }

      const hull = await readHullMaterialFacts(page);
      process.stdout.write(
        `wall-roughness-probe: hull applied=${hull.hullMaterialsApplied} `
          + `assigned=${hull.hullAssignedCount}\n`,
      );
      if (!hull.hullMaterialsApplied) {
        throw new Error(
          "wall-roughness-probe: hull materials not applied — #534 assignment missing "
            + `(assigned=${hull.hullAssignedCount} exteriorBare=${hull.exteriorBare})`,
        );
      }

      const cameraNote = await forceInteriorWallCamera(page);
      await page.waitForTimeout(800);
      await hideHudPanels(page);
      const hiddenSubjects = await hideNonRoomSubjects(page);
      await page.waitForTimeout(200);

      const aoTouched = await setAoMapIntensity(page, 0);
      await page.waitForTimeout(400);
      process.stdout.write(
        `wall-roughness-probe: aoMapIntensity=0 materials=${aoTouched} `
          + `hiddenNonRoom=${hiddenSubjects} cam=${cameraNote}\n`,
      );

      const cells: WallRoughnessCell[] = [];
      // Control first (as-authored 0.10), then treatment (≈0.7). Same camera / lighting / AO.
      for (const { id, roughness } of [
        { id: "wall_rough_010" as const, roughness: 0.10 },
        { id: "wall_rough_070" as const, roughness: 0.70 },
      ]) {
        const touched = await setWallHexagonRoughness(page, roughness);
        if (touched.count < 1) {
          throw new Error(
            `wall-roughness-probe: no hexagon wall material found for ${id} — cannot override roughness`,
          );
        }
        await page.waitForTimeout(400);
        process.stdout.write(
          `wall-roughness-probe: ${id} roughness=${roughness} `
            + `mats=${touched.count} names=${JSON.stringify(touched.names)}\n`,
        );

        const imageName = `${id}.png`;
        const imagePath = join(WALL_ROUGHNESS_OUT_DIR, imageName);
        const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
        writeFileSync(imagePath, bytes);

        const regions = measureRegions(bytes);
        const wall = regions.find((r) => r.id === "wall")!;
        const ceiling = regions.find((r) => r.id === "ceiling")!;
        process.stdout.write(
          `wall-roughness-probe: ${id} wallL=${wall.meanL} wallR/A=${wall.rendOverAlbedo} `
            + `ceilL=${ceiling.meanL} ceilR/A=${ceiling.rendOverAlbedo} `
            + `wallSd=${wall.sd}\n`,
        );

        cells.push({
          id,
          wallRoughness: roughness,
          materialsTouched: touched.count,
          materialNames: touched.names,
          regions,
          image: `wall-roughness/${imageName}`,
        });
      }

      const treatment = cells.find((c) => c.id === "wall_rough_070")!;
      const probe: WallRoughnessProbe = {
        schemaVersion: "openclinxr.wall-roughness-probe.v1",
        generatedAt: new Date().toISOString(),
        room: SHEET_ROOM,
        scenarioId,
        captureMode,
        lightingVariant: "room_environment_ibl",
        aoMapIntensity: 0,
        hullMaterialsApplied: true,
        hullAssignedCount: hull.hullAssignedCount,
        productDefaultVariant,
        camera: cameraNote,
        image: treatment.image,
        glbSha256,
        assetEdited: false,
        albedo: ALBEDO,
        cells,
        claimScope:
          "whether a runtime roughness override on the wall material changes how much light it "
          + "receives, measured as rend/albedo at corrected per-surface rects on one room",
        notEvidenceFor: [
          "product lighting default",
          "whether the room LOOKS right",
          "other rooms",
          "whether marble should be smooth as authored",
          "quest_readiness",
          "clinical_validity",
        ],
      };
      writeFileSync(WALL_ROUGHNESS_PROBE_JSON, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
      return probe;
    } finally {
      await browser.close();
    }
  } finally {
    if (ownedServer && server) await stopPortlessDevServer(server.proc);
  }
}

async function main(): Promise<void> {
  const probe = await renderWallRoughnessProbe();
  const lo = probe.cells.find((c) => c.id === "wall_rough_010");
  const hi = probe.cells.find((c) => c.id === "wall_rough_070");
  const loWall = lo?.regions.find((r) => r.id === "wall");
  const hiWall = hi?.regions.find((r) => r.id === "wall");
  process.stdout.write(
    `wall-roughness-probe: wrote ${WALL_ROUGHNESS_PROBE_JSON}\n`
      + `  control wall rend/albedo=${loWall?.rendOverAlbedo} `
      + `treatment wall rend/albedo=${hiWall?.rendOverAlbedo}\n`
      + `  image=${probe.image}\n`,
  );
}

const isDirect =
  process.argv[1] != null
  && fileURLToPath(import.meta.url) === pathResolve(process.argv[1]);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
