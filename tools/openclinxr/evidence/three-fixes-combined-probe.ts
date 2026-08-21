/**
 * #543 — one capture with all three room fixes active.
 *
 * Extends #529 (interior-wall-ao-probe: aoMapIntensity override + interior camera) and
 * #534 (room-primitive-material-probe: hull materials already on the product load path +
 * wall/ceiling regionLuminance). Does NOT write a third capture harness (D1). Does NOT ship
 * aoMapIntensity=0 as the product default — clause (4) keeps default at `control`.
 *
 * claimScope: whether one capture with station lighting ≠ control, aoMapIntensity 0, and the
 *   materialised hull produces separately measured wall/ceiling/floor luminances.
 * notEvidenceFor: product lighting default; AO remedy choice; other rooms; whether the room
 *   looks CORRECT (orchestrator grades pixels).
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
  buildRoomCaptureUrl,
  readInfinigenRoomLiveFacts,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import {
  SHEET_ROOM,
  SHEET_SCENARIO_ID,
} from "./interior-wall-lighting-variants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

export const THREE_FIXES_COMBINED_PROBE_JSON = join(
  REPO,
  "tools/openclinxr/evidence/three-fixes-combined-probe.json",
);
export const THREE_FIXES_COMBINED_OUT_DIR = join(
  REPO,
  "tools/openclinxr/evidence/three-fixes-combined",
);

const GLB_REL = "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";

/** Same wall-band as #525 / #529 / #534. */
const WALL_BAND = { left: 0.08, top: 0.18, width: 0.42, height: 0.48 } as const;
/** Same ceiling strip as #534. */
const CEILING_BAND = { left: 0.08, top: 0.02, width: 0.42, height: 0.12 } as const;
/** Floor strip below the wall band — named region for clause (2); not a whole-image mean. */
const FLOOR_BAND = { left: 0.08, top: 0.72, width: 0.42, height: 0.22 } as const;

type RegionBand = { left: number; top: number; width: number; height: number };

export type ThreeFixesCombinedRegion = {
  id: "wall" | "ceiling" | "floor";
  meanL: number;
  sd: number;
  /** [left, top, width, height] fractions of the screenshot — clause (2). */
  rect: [number, number, number, number];
};

export type ThreeFixesCombinedProbe = {
  schemaVersion: "openclinxr.three-fixes-combined-probe.v1";
  generatedAt: string;
  room: string;
  scenarioId: string;
  captureMode: string;
  /** Must not be `control` — clause (1). */
  lightingVariant: string;
  /** Runtime override only — clause (1); product default untouched. */
  aoMapIntensity: 0;
  hullMaterialsApplied: boolean;
  hullAssignedCount: number;
  /** Counterweight — clause (4); must stay `control`. */
  productDefaultVariant: string;
  camera: string;
  image: string;
  glbSha256: string;
  regions: ThreeFixesCombinedRegion[];
  wallToCeilingRatio: number;
  claimScope: string;
  notEvidenceFor: string[];
};

function bandToRect(b: RegionBand): [number, number, number, number] {
  return [b.left, b.top, b.width, b.height];
}

/** IBL capture URL — same as #543 combined path. Exported for #544. */
export function buildThreeFixesCombinedUrl(
  baseUrl: string,
  scenarioId: string,
  captureMode: string,
): string {
  const url = new URL(buildRoomCaptureUrl(baseUrl, scenarioId, captureMode));
  // Non-control station lighting — same IBL path as #529 / #534.
  url.searchParams.set("stationLighting", "room_environment_ibl");
  return url.toString();
}

/** Hide non-3D HUD — verbatim from interior-wall-ao-probe.ts (#529). Exported for #544. */
export async function hideHudPanels(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const root = document.body;
    if (!root) return;
    const hide = (sel) => {
      for (const el of root.querySelectorAll(sel)) {
        el.style.visibility = "hidden";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      }
    };
    hide("[data-openclinxr-panel], .openclinxr-panel, #clinical-panel, #dialogue-panel");
    hide("button, nav, header, aside");
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.style.visibility = "visible";
      canvas.style.opacity = "1";
    }
  })()`);
}

/**
 * Place the camera INSIDE the Infinigen room looking at an interior wall.
 * Verbatim from interior-wall-ao-probe.ts forceInteriorWallCamera (D1 reuse of #529 path).
 * Exported for #544 wall-roughness-probe (same camera, no fourth harness).
 */
export async function forceInteriorWallCamera(page: Page): Promise<string> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return "roomCam=missing-scene";
    let cam = null;
    scene.traverse(function (o) {
      if (!cam && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) cam = o;
    });
    if (!cam) return "roomCam=missing-camera";

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
    if (!roomRoot) return "roomCam=no-infinigen-room";

    let interior = null, exterior = null;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const box = worldBoxOf(o);
      if (/exterior/i.test(o.name || "")) exterior = grow(exterior, box);
      else interior = grow(interior, box);
    });
    if (!interior) return "roomCam=no-interior-bounds";

    const wallThickness = exterior ? Math.max(0.05, exterior.max[2] - interior.max[2]) : 0.12;
    const eyeX = (interior.min[0] + interior.max[0]) / 2;
    const eyeY = 1.68;
    const eyeZ = interior.max[2] - 2 * wallThickness;
    const lookX = eyeX;
    const lookY = 1.45;
    const lookZ = interior.min[2] + 2 * wallThickness;

    cam.fov = 55;
    if (typeof cam.updateProjectionMatrix === "function") cam.updateProjectionMatrix();
    cam.position.set(eyeX, eyeY, eyeZ);
    const parent = cam.parent;
    if (parent && typeof parent.worldToLocal === "function") {
      if (typeof parent.updateMatrixWorld === "function") parent.updateMatrixWorld(true);
      parent.worldToLocal(cam.position);
    }
    cam.lookAt(lookX, lookY, lookZ);
    cam.userData.openClinXrCameraFraming =
      "three_fixes_combined_#543_actorless_interior_eye";
    return "roomCam(interiorWall)=" + eyeX.toFixed(2) + "," + eyeY.toFixed(2) + "," + eyeZ.toFixed(2)
      + " look=" + lookX.toFixed(2) + "," + lookY.toFixed(2) + "," + lookZ.toFixed(2)
      + " wallThickness=" + wallThickness.toFixed(3);
  })()`) as Promise<string>;
}

/** Runtime-only aoMapIntensity — verbatim from interior-wall-ao-probe.ts (#529). Exported for #544. */
export async function setAoMapIntensity(page: Page, intensity: 0 | 1): Promise<number> {
  return page.evaluate(`((intensity) => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return 0;
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    const root = roomRoot || scene;
    const seen = new Set();
    let n = 0;
    root.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m || !m.aoMap || seen.has(m)) continue;
        seen.add(m);
        m.aoMapIntensity = intensity;
        if ("needsUpdate" in m) m.needsUpdate = true;
        n += 1;
      }
    });
    return n;
  })(${intensity})`) as Promise<number>;
}

/**
 * Confirm #534 hull assignment is live on the product load path
 * (`assignMissingRoomPrimitiveMaterials` tags openClinXrAssignedMaterialAtLoad).
 * Exported for #544.
 */
export async function readHullMaterialFacts(page: Page): Promise<{
  hullMaterialsApplied: boolean;
  hullAssignedCount: number;
  exteriorWithMaterial: number;
  exteriorBare: number;
}> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") {
      return { hullMaterialsApplied: false, hullAssignedCount: 0, exteriorWithMaterial: 0, exteriorBare: 0 };
    }
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot) {
      return { hullMaterialsApplied: false, hullAssignedCount: 0, exteriorWithMaterial: 0, exteriorBare: 0 };
    }
    let assigned = 0;
    let exteriorWithMaterial = 0;
    let exteriorBare = 0;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.userData && o.userData.openClinXrAssignedMaterialAtLoad) assigned += 1;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const name = (o.name || "");
      const isExterior = /exterior/i.test(name);
      if (!isExterior) return;
      if (mat && (mat.name || mat.type)) exteriorWithMaterial += 1;
      else exteriorBare += 1;
    });
    return {
      hullMaterialsApplied: assigned > 0 || (exteriorWithMaterial > 0 && exteriorBare === 0),
      hullAssignedCount: assigned,
      exteriorWithMaterial: exteriorWithMaterial,
      exteriorBare: exteriorBare,
    };
  })()`) as Promise<{
    hullMaterialsApplied: boolean;
    hullAssignedCount: number;
    exteriorWithMaterial: number;
    exteriorBare: number;
  }>;
}

export async function renderThreeFixesCombinedProbe(input?: {
  baseUrl?: string;
  scenarioId?: string;
}): Promise<ThreeFixesCombinedProbe> {
  const scenarioId = input?.scenarioId ?? SHEET_SCENARIO_ID;
  const captureMode = "scene-overview";
  mkdirSync(THREE_FIXES_COMBINED_OUT_DIR, { recursive: true });

  const glbBytes = readFileSync(join(REPO, GLB_REL));
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");

  // Counterweight: product default must still resolve to control with no query.
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
      process.stdout.write(`three-fixes-combined-probe: goto room_environment_ibl\n`);
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
        throw new Error("three-fixes-combined-probe: Infinigen room never became present");
      }

      const hull = await readHullMaterialFacts(page);
      process.stdout.write(
        `three-fixes-combined-probe: hull applied=${hull.hullMaterialsApplied} `
          + `assigned=${hull.hullAssignedCount} exteriorWithMat=${hull.exteriorWithMaterial} `
          + `exteriorBare=${hull.exteriorBare}\n`,
      );
      if (!hull.hullMaterialsApplied) {
        throw new Error(
          "three-fixes-combined-probe: hull materials not applied on the product load path — "
            + `#534 assignment missing (assigned=${hull.hullAssignedCount} exteriorBare=${hull.exteriorBare})`,
        );
      }

      const cameraNote = await forceInteriorWallCamera(page);
      await page.waitForTimeout(800);
      await hideHudPanels(page);
      await page.waitForTimeout(200);

      // Fix #529 term: neutralise AO at runtime only — do not touch product sources.
      const touched = await setAoMapIntensity(page, 0);
      await page.waitForTimeout(400);
      process.stdout.write(
        `three-fixes-combined-probe: aoMapIntensity=0 materials=${touched} cam=${cameraNote}\n`,
      );

      const imageName = "combined-ibl-ao0-hull.png";
      const imagePath = join(THREE_FIXES_COMBINED_OUT_DIR, imageName);
      const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
      writeFileSync(imagePath, bytes);

      const wall = regionLuminance(bytes, WALL_BAND, { step: 3, blackLuma: 4 });
      const ceiling = regionLuminance(bytes, CEILING_BAND, { step: 3, blackLuma: 4 });
      const floor = regionLuminance(bytes, FLOOR_BAND, { step: 3, blackLuma: 4 });
      if (!wall || !ceiling || !floor) {
        throw new Error("three-fixes-combined-probe: luminance decode failed for a named region");
      }

      const regions: ThreeFixesCombinedRegion[] = [
        {
          id: "wall",
          meanL: Number(wall.mean.toFixed(2)),
          sd: Number(wall.sd.toFixed(2)),
          rect: bandToRect(WALL_BAND),
        },
        {
          id: "ceiling",
          meanL: Number(ceiling.mean.toFixed(2)),
          sd: Number(ceiling.sd.toFixed(2)),
          rect: bandToRect(CEILING_BAND),
        },
        {
          id: "floor",
          meanL: Number(floor.mean.toFixed(2)),
          sd: Number(floor.sd.toFixed(2)),
          rect: bandToRect(FLOOR_BAND),
        },
      ];

      const wallToCeilingRatio = ceiling.mean > 0 ? wall.mean / ceiling.mean : 0;
      process.stdout.write(
        `three-fixes-combined-probe: wallL=${wall.mean.toFixed(2)} ceilingL=${ceiling.mean.toFixed(2)} `
          + `floorL=${floor.mean.toFixed(2)} ratio=${wallToCeilingRatio.toFixed(3)}\n`,
      );

      const probe: ThreeFixesCombinedProbe = {
        schemaVersion: "openclinxr.three-fixes-combined-probe.v1",
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
        image: `three-fixes-combined/${imageName}`,
        glbSha256,
        regions,
        wallToCeilingRatio: Number(wallToCeilingRatio.toFixed(4)),
        claimScope:
          "whether one capture with station lighting, aoMapIntensity 0 and the materialised hull "
          + "all active produces a lit interior, with wall/ceiling/floor measured as separate regions",
        notEvidenceFor: [
          "product lighting default",
          "AO remedy choice (invert vs zero vs rebake)",
          "other rooms",
          "whether the room looks CORRECT",
          "quest_readiness",
          "clinical_validity",
        ],
      };
      writeFileSync(THREE_FIXES_COMBINED_PROBE_JSON, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
      return probe;
    } finally {
      await browser.close();
    }
  } finally {
    if (ownedServer && server) await stopPortlessDevServer(server.proc);
  }
}

async function main(): Promise<void> {
  const probe = await renderThreeFixesCombinedProbe();
  process.stdout.write(
    `three-fixes-combined-probe: wrote ${THREE_FIXES_COMBINED_PROBE_JSON} `
      + `ratio=${probe.wallToCeilingRatio} image=${probe.image}\n`,
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
