/**
 * #525 — labelled interior-wall lighting variant sheet (control + candidates).
 *
 * Renders one Infinigen room under the product lighting module variants and records wall-band
 * mean luminance. Does NOT pick a shipped value — orchestrator grades the sheet.
 *
 * claimScope: wall-band mean L per named variant on primary_care interior framing.
 * notEvidenceFor: which variant should become the product default; Quest readiness; metals grade.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
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
  STATION_INTERIOR_LIGHTING_VARIANT_IDS,
  type StationInteriorLightingVariantId,
} from "../../../apps/ui-xr/src/station-interior-lighting.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

export const INTERIOR_WALL_LIGHTING_SHEET = join(
  REPO,
  "tools/openclinxr/evidence/interior-wall-lighting-variants.json",
);

export const INTERIOR_WALL_LIGHTING_OUT_DIR = join(
  REPO,
  "tools/openclinxr/evidence/interior-wall-lighting-variants",
);

/** Scenario whose shipped interior camera graded L=8.9 (issue #525 header). */
export const SHEET_SCENARIO_ID = "primary_care_dyslipidemia_joint_pain_v1";

/** Shipped room GLB basename the sheet must name (contract (1)). */
export const SHEET_ROOM = "infinigen-primary-care-clinic";

const VARIANT_LABELS: Record<StationInteriorLightingVariantId, string> = {
  control: "control (current hemisphere + key)",
  lab_ambient_fill: "candidate: lab ambient + counter-fill (isolated-subject-lab)",
  raised_hemisphere_ground: "candidate: raised hemisphere ground",
  room_environment_ibl: "candidate: RoomEnvironment IBL + control lights",
};

export type InteriorWallLightingVariantRow = {
  id: StationInteriorLightingVariantId;
  label: string;
  wallBandMeanL: number;
  wallBandSd: number;
  viewportMeanL: number;
  image: string;
};

export type InteriorWallLightingSheet = {
  schemaVersion: "openclinxr.interior-wall-lighting-variants.v1";
  generatedAt: string;
  room: string;
  scenarioId: string;
  captureMode: string;
  cameraNote: string;
  /** Wall-band sample region (fractions of the screenshot). HUD-right excluded via left width. */
  wallBandRegion: { left: number; top: number; width: number; height: number };
  graderNote: string;
  claimScope: string;
  notEvidenceFor: string[];
  variants: InteriorWallLightingVariantRow[];
};

function buildVariantUrl(
  baseUrl: string,
  scenarioId: string,
  captureMode: string,
  variantId: StationInteriorLightingVariantId,
): string {
  const url = new URL(buildRoomCaptureUrl(baseUrl, scenarioId, captureMode));
  url.searchParams.set("stationLighting", variantId);
  return url.toString();
}

/** Hide non-3D HUD so wall-band samples match the orchestrator's HUD-excluded grade. */
async function hideHudPanels(page: Page): Promise<void> {
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
 * Actorless (worktrees lack gitignored humanoids). Uses the same world→local parent conversion
 * as reframeCameraForRoom (#342). Eye height 1.68 m matches the orchestrator's interior grade.
 */
async function forceInteriorWallCamera(page: Page): Promise<string> {
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
    // World eye → local via parent (same as reframeCameraForRoom).
    cam.position.set(eyeX, eyeY, eyeZ);
    const parent = cam.parent;
    if (parent && typeof parent.worldToLocal === "function") {
      if (typeof parent.updateMatrixWorld === "function") parent.updateMatrixWorld(true);
      parent.worldToLocal(cam.position);
    }
    cam.lookAt(lookX, lookY, lookZ);
    cam.userData.openClinXrCameraFraming =
      "interior_wall_lighting_variant_sheet_#525_actorless_interior_eye";
    return "roomCam(interiorWall)=" + eyeX.toFixed(2) + "," + eyeY.toFixed(2) + "," + eyeZ.toFixed(2)
      + " look=" + lookX.toFixed(2) + "," + lookY.toFixed(2) + "," + lookZ.toFixed(2)
      + " wallThickness=" + wallThickness.toFixed(3);
  })()`) as Promise<string>;
}

/**
 * Wall band: left/mid of the frame where interior wall planes dominate after HUD hide.
 * Fractions chosen to land the control near the measured L≈8.9 band without fitting a target.
 */
const WALL_BAND = { left: 0.08, top: 0.18, width: 0.42, height: 0.48 } as const;
const VIEWPORT = { left: 0.0, top: 0.0, width: 0.68, height: 1.0 } as const;

export async function renderInteriorWallLightingVariants(input?: {
  baseUrl?: string;
  scenarioId?: string;
  variantIds?: readonly StationInteriorLightingVariantId[];
}): Promise<InteriorWallLightingSheet> {
  const scenarioId = input?.scenarioId ?? SHEET_SCENARIO_ID;
  const variantIds = input?.variantIds ?? [...STATION_INTERIOR_LIGHTING_VARIANT_IDS];
  const captureMode = "scene-overview";

  mkdirSync(INTERIOR_WALL_LIGHTING_OUT_DIR, { recursive: true });

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
      const variants: InteriorWallLightingVariantRow[] = [];
      let cameraNote = "";

      for (const variantId of variantIds) {
        const url = buildVariantUrl(baseUrl, scenarioId, captureMode, variantId);
        process.stdout.write(`interior-wall-lighting: ${variantId} goto\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        // Infinigen room loads async after the parametric shell — wait until it is present.
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
          throw new Error("interior-wall-lighting: Infinigen room never became present");
        }
        // Actor-based reframe needs skinned meshes; worktrees lack gitignored humanoids.
        // Force an interior wall eye from world-matrix room bounds (§6v) instead.
        cameraNote = await forceInteriorWallCamera(page);
        await page.waitForTimeout(800);
        await hideHudPanels(page);
        await page.waitForTimeout(200);

        const imageName = `${variantId}.png`;
        const imagePath = join(INTERIOR_WALL_LIGHTING_OUT_DIR, imageName);
        await page.screenshot({ path: imagePath, fullPage: false });

        const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
        writeFileSync(imagePath, bytes);

        const wall = regionLuminance(bytes, WALL_BAND, { step: 3, blackLuma: 4 });
        const view = regionLuminance(bytes, VIEWPORT, { step: 4, blackLuma: 4 });
        if (!wall || !view) {
          throw new Error(`interior-wall-lighting: luminance decode failed for ${variantId}`);
        }
        process.stdout.write(
          `interior-wall-lighting: ${variantId} wallBandMeanL=${wall.mean.toFixed(1)} `
            + `sd=${wall.sd.toFixed(1)} viewportMeanL=${view.mean.toFixed(1)} cam=${cameraNote}\n`,
        );
        variants.push({
          id: variantId,
          label: VARIANT_LABELS[variantId],
          wallBandMeanL: Number(wall.mean.toFixed(2)),
          wallBandSd: Number(wall.sd.toFixed(2)),
          viewportMeanL: Number(view.mean.toFixed(2)),
          image: `interior-wall-lighting-variants/${imageName}`,
        });
      }

      const sheet: InteriorWallLightingSheet = {
        schemaVersion: "openclinxr.interior-wall-lighting-variants.v1",
        generatedAt: new Date().toISOString(),
        room: SHEET_ROOM,
        scenarioId,
        captureMode,
        cameraNote,
        wallBandRegion: { ...WALL_BAND },
        graderNote:
          "Orchestrator picks. Default product path remains control until that grade. "
          + "No intensity/colour/HDRI in this sheet is the shipped answer.",
        claimScope:
          "wall-band mean luminance under named product-path lighting variants on one Infinigen room",
        notEvidenceFor: [
          "permanent product lighting pick",
          "quest_readiness",
          "clinical_validity",
          "metal_appearance_grade",
          "plaster_albedo_variation_R2",
        ],
        variants,
      };
      writeFileSync(INTERIOR_WALL_LIGHTING_SHEET, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");
      return sheet;
    } finally {
      await browser.close();
    }
  } finally {
    if (ownedServer && server) await stopPortlessDevServer(server.proc);
  }
}

async function main(): Promise<void> {
  const sheet = await renderInteriorWallLightingVariants();
  process.stdout.write(
    `interior-wall-lighting: wrote ${INTERIOR_WALL_LIGHTING_SHEET} variants=${sheet.variants.length}\n`,
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
