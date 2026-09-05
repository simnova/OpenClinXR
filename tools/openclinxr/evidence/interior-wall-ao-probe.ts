/**
 * #529 — one discriminator: is the wall speckle the aoMap term?
 *
 * Extends the #525 interior-wall lighting path (same camera, wall-band region, regionLuminance).
 * Renders room_environment_ibl twice at aoMapIntensity 1 and 0. Does NOT pick a lighting default,
 * invert, re-bake, or drop the occlusion slot.
 *
 * claimScope: whether wall-band speckle under RoomEnvironment IBL is produced by the aoMap term
 *   on one Infinigen room.
 * notEvidenceFor: product lighting default; AO remedy; R2 albedo; other rooms; quest_readiness;
 *   clinical_validity.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
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
  SHEET_ROOM,
  SHEET_SCENARIO_ID,
} from "./interior-wall-lighting-variants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");

export const INTERIOR_WALL_AO_PROBE_JSON = join(
  REPO,
  "tools/openclinxr/evidence/interior-wall-ao-probe.json",
);
export const INTERIOR_WALL_AO_PROBE_OUT_DIR = join(
  REPO,
  "tools/openclinxr/evidence/interior-wall-ao-probe",
);

const GLB_REL = "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb";

/** Same wall-band as #525 / interior-wall-lighting-variants.ts (landed camera cell). */
const WALL_BAND = { left: 0.08, top: 0.18, width: 0.42, height: 0.48 } as const;

export type InteriorWallAoProbeCell = {
  id: "ibl_ao1" | "ibl_ao0";
  aoMapIntensity: 0 | 1;
  camera: string;
  wallBandMeanL: number;
  wallBandSd: number;
  /** Shape reading only — mean |px − 3×3 mean|; not asserted by the contract (§9d). */
  wallBandHf: number;
  image: string;
  materialsWithAoMap: number;
};

export type InteriorWallAoProbe = {
  schemaVersion: "openclinxr.interior-wall-ao-probe.v1";
  generatedAt: string;
  room: string;
  scenarioId: string;
  captureMode: string;
  lightingVariant: "room_environment_ibl";
  cameraNote: string;
  wallBandRegion: { left: number; top: number; width: number; height: number };
  glbSha256: string;
  plasterUv2Falsifier: {
    meshName: string;
    materialName: string;
    hasUv2: boolean;
    withAoMap: boolean;
  };
  claimScope: string;
  notEvidenceFor: string[];
  cells: InteriorWallAoProbeCell[];
};

function buildIblUrl(baseUrl: string, scenarioId: string, captureMode: string): string {
  const url = new URL(buildRoomCaptureUrl(baseUrl, scenarioId, captureMode));
  url.searchParams.set("stationLighting", "room_environment_ibl");
  return url.toString();
}

/** Hide non-3D HUD — same selector set as interior-wall-lighting-variants.ts. */
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
 * Verbatim from interior-wall-lighting-variants.ts forceInteriorWallCamera (D1 reuse).
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
    cam.position.set(eyeX, eyeY, eyeZ);
    const parent = cam.parent;
    if (parent && typeof parent.worldToLocal === "function") {
      if (typeof parent.updateMatrixWorld === "function") parent.updateMatrixWorld(true);
      parent.worldToLocal(cam.position);
    }
    cam.lookAt(lookX, lookY, lookZ);
    cam.userData.openClinXrCameraFraming =
      "interior_wall_ao_probe_#529_actorless_interior_eye";
    return "roomCam(interiorWall)=" + eyeX.toFixed(2) + "," + eyeY.toFixed(2) + "," + eyeZ.toFixed(2)
      + " look=" + lookX.toFixed(2) + "," + lookY.toFixed(2) + "," + lookZ.toFixed(2)
      + " wallThickness=" + wallThickness.toFixed(3);
  })()`) as Promise<string>;
}

/**
 * Named falsifier from the brief: plaster Circle.054 / shader_plaster must carry TEXCOORD_1
 * for aoMap to be active. three.js 0.184 maps TEXCOORD_1 → attributes.uv1 (not uv2);
 * aoMap samples via texture.channel (texCoord=1 → channel 1 → uv1).
 */
async function readPlasterUv2Falsifier(page: Page): Promise<{
  meshName: string;
  materialName: string;
  hasUv2: boolean;
  withAoMap: boolean;
  materialsWithAoMap: number;
  aoMapChannel: number | null;
  uvAttrs: string[];
  candidateSummary?: unknown;
}> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    const empty = {
      meshName: "", materialName: "", hasUv2: false, withAoMap: false,
      materialsWithAoMap: 0, aoMapChannel: null, uvAttrs: [],
    };
    if (!scene || typeof scene.traverse !== "function") return empty;
    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    const root = roomRoot || scene;
    let plaster = null;
    let materialsWithAoMap = 0;
    const seen = new Set();
    const candidates = [];
    root.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (m.aoMap) materialsWithAoMap += 1;
      }
      const mat0 = Array.isArray(o.material) ? o.material[0] : o.material;
      const mn = (mat0 && mat0.name) ? String(mat0.name) : "";
      const on = String(o.name || "");
      const geom = o.geometry;
      const attrs = geom && geom.attributes ? Object.keys(geom.attributes) : [];
      const hasSecondUv = !!(geom && geom.attributes && (geom.attributes.uv1 || geom.attributes.uv2));
      const withAo = !!(mat0 && mat0.aoMap);
      if (/plaster/i.test(mn) || /Circle\\.054/.test(on) || (withAo && /plaster/i.test(mn))) {
        candidates.push({
          mesh: o, on: on, mn: mn, hasSecondUv: hasSecondUv, withAo: withAo, attrs: attrs,
          channel: mat0 && mat0.aoMap && typeof mat0.aoMap.channel === "number" ? mat0.aoMap.channel : null,
          tris: geom && geom.index ? Math.floor(geom.index.count / 3) : (geom && geom.attributes && geom.attributes.position ? Math.floor(geom.attributes.position.count / 3) : 0),
        });
      }
    });
    // Prefer the brief's Circle.054 (30 tris plaster with occlusion), else any plaster+second-UV+aoMap.
    candidates.sort(function (a, b) {
      const score = function (c) {
        let s = 0;
        if (/Circle\\.054/.test(c.on)) s += 100;
        if (c.hasSecondUv) s += 50;
        if (c.withAo) s += 20;
        if (c.tris === 30) s += 10;
        return s;
      };
      return score(b) - score(a);
    });
    plaster = candidates.length > 0 ? candidates[0].mesh : null;
    if (!plaster) {
      return {
        meshName: "(plaster-not-found)",
        materialName: "",
        hasUv2: false,
        withAoMap: false,
        materialsWithAoMap: materialsWithAoMap,
        aoMapChannel: null,
        uvAttrs: [],
      };
    }
    const best = candidates[0];
    const geom = plaster.geometry;
    const uvAttrs = geom && geom.attributes ? Object.keys(geom.attributes).filter(function (k) { return /^uv/i.test(k); }) : [];
    // TEXCOORD_1 → uv1 in three@0.184; older code/docs called the second set uv2.
    const hasSecondUv = !!(geom && geom.attributes && (geom.attributes.uv1 || geom.attributes.uv2));
    const mat = Array.isArray(plaster.material) ? plaster.material[0] : plaster.material;
    return {
      meshName: String(plaster.name || ""),
      materialName: mat && mat.name ? String(mat.name) : "",
      hasUv2: hasSecondUv,
      withAoMap: !!(mat && mat.aoMap),
      materialsWithAoMap: materialsWithAoMap,
      aoMapChannel: mat && mat.aoMap && typeof mat.aoMap.channel === "number" ? mat.aoMap.channel : null,
      uvAttrs: uvAttrs,
      candidateCount: candidates.length,
      candidateSummary: candidates.slice(0, 6).map(function (c) {
        return c.on + "|" + c.mn + "|uv2ish=" + c.hasSecondUv + "|ao=" + c.withAo + "|tris=" + c.tris + "|ch=" + c.channel;
      }),
    };
  })()`) as Promise<{
    meshName: string;
    materialName: string;
    hasUv2: boolean;
    withAoMap: boolean;
    materialsWithAoMap: number;
    aoMapChannel: number | null;
    uvAttrs: string[];
    candidateCount?: number;
    candidateSummary?: string[];
  }>;
}

/** Runtime-only: set aoMapIntensity on every material that carries an aoMap. */
async function setAoMapIntensity(page: Page, intensity: 0 | 1): Promise<number> {
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
 * Mean |px − 3×3 neighbourhood mean| over the wall band — shape reading only (§9d).
 * Same PNG decode constraints as regionLuminance (8-bit RGB/RGBA, non-interlaced).
 */
function wallBandHf(bytes: Uint8Array, region: typeof WALL_BAND, step = 3): number | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
      interlace = bytes[off + 20]!;
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;

  const lumaAt = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const grid = new Float32Array(w * h);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  const paeth = (a: number, b: number, c: number) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a);
    const pb = Math.abs(pp - b);
    const pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]!;
      const a = i >= chans ? cur[i - chans]! : 0;
      const b = prev[i]!;
      const c = i >= chans ? prev[i - chans]! : 0;
      cur[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : (x + paeth(a, b, c)) & 0xff;
    }
    p += stride;
    for (let x = 0; x < w; x++) {
      const i = x * chans;
      grid[y * w + x] = chans >= 3
        ? lumaAt(cur[i]!, cur[i + 1]!, cur[i + 2]!)
        : cur[i]!;
    }
    prev.set(cur);
  }

  const x0 = Math.max(1, Math.floor(region.left * w));
  const y0 = Math.max(1, Math.floor(region.top * h));
  const x1 = Math.min(w - 1, x0 + Math.floor(region.width * w));
  const y1 = Math.min(h - 1, y0 + Math.floor(region.height * h));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      let neigh = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          neigh += grid[(y + dy) * w + (x + dx)]!;
        }
      }
      const mean3 = neigh / 9;
      sum += Math.abs(grid[y * w + x]! - mean3);
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

export async function renderInteriorWallAoProbe(input?: {
  baseUrl?: string;
  scenarioId?: string;
}): Promise<InteriorWallAoProbe> {
  const scenarioId = input?.scenarioId ?? SHEET_SCENARIO_ID;
  const captureMode = "scene-overview";
  mkdirSync(INTERIOR_WALL_AO_PROBE_OUT_DIR, { recursive: true });

  const glbBytes = readFileSync(join(REPO, GLB_REL));
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");

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
      const url = buildIblUrl(baseUrl, scenarioId, captureMode);
      process.stdout.write(`interior-wall-ao-probe: goto room_environment_ibl\n`);
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
        throw new Error("interior-wall-ao-probe: Infinigen room never became present");
      }

      const cameraNote = await forceInteriorWallCamera(page);
      await page.waitForTimeout(800);
      await hideHudPanels(page);
      await page.waitForTimeout(200);

      const falsifier = await readPlasterUv2Falsifier(page);
      process.stdout.write(
        `interior-wall-ao-probe: plaster falsifier mesh=${falsifier.meshName} `
          + `mat=${falsifier.materialName} hasSecondUv=${falsifier.hasUv2} withAoMap=${falsifier.withAoMap} `
          + `aoMaterials=${falsifier.materialsWithAoMap} channel=${falsifier.aoMapChannel} `
          + `uvAttrs=[${falsifier.uvAttrs.join(",")}] `
          + `candidates=${JSON.stringify(falsifier.candidateSummary ?? [])}\n`,
      );
      if (!falsifier.hasUv2) {
        throw new Error(
          "DEAD PREMISE: plaster primitive has no uv1/uv2 (TEXCOORD_1) in the live scene — "
            + "three.js would drop aoMap; stop per brief falsifier. "
            + `mesh=${falsifier.meshName} mat=${falsifier.materialName} `
            + `uvAttrs=[${falsifier.uvAttrs.join(",")}] `
            + `candidates=${JSON.stringify(falsifier.candidateSummary ?? [])}`,
        );
      }

      const cells: InteriorWallAoProbeCell[] = [];
      // AO-on first so ibl_ao1 can reproduce the #525 landed cell; then AO-off. Same camera.
      for (const intensity of [1, 0] as const) {
        const id = intensity === 1 ? "ibl_ao1" : "ibl_ao0";
        const touched = await setAoMapIntensity(page, intensity);
        await page.waitForTimeout(400);
        process.stdout.write(
          `interior-wall-ao-probe: ${id} aoMapIntensity=${intensity} materials=${touched} cam=${cameraNote}\n`,
        );

        const imageName = `${id}.png`;
        const imagePath = join(INTERIOR_WALL_AO_PROBE_OUT_DIR, imageName);
        const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
        writeFileSync(imagePath, bytes);

        const wall = regionLuminance(bytes, WALL_BAND, { step: 3, blackLuma: 4 });
        if (!wall) {
          throw new Error(`interior-wall-ao-probe: luminance decode failed for ${id}`);
        }
        const hf = wallBandHf(bytes, WALL_BAND, 3);
        if (hf == null) {
          throw new Error(`interior-wall-ao-probe: HF decode failed for ${id}`);
        }
        process.stdout.write(
          `interior-wall-ao-probe: ${id} wallBandMeanL=${wall.mean.toFixed(2)} `
            + `sd=${wall.sd.toFixed(2)} hf=${hf.toFixed(2)}\n`,
        );
        cells.push({
          id,
          aoMapIntensity: intensity,
          camera: cameraNote,
          wallBandMeanL: Number(wall.mean.toFixed(2)),
          wallBandSd: Number(wall.sd.toFixed(2)),
          wallBandHf: Number(hf.toFixed(2)),
          image: `interior-wall-ao-probe/${imageName}`,
          materialsWithAoMap: touched,
        });
      }

      const probe: InteriorWallAoProbe = {
        schemaVersion: "openclinxr.interior-wall-ao-probe.v1",
        generatedAt: new Date().toISOString(),
        room: SHEET_ROOM,
        scenarioId,
        captureMode,
        lightingVariant: "room_environment_ibl",
        cameraNote,
        wallBandRegion: { ...WALL_BAND },
        glbSha256,
        plasterUv2Falsifier: {
          meshName: falsifier.meshName,
          materialName: falsifier.materialName,
          hasUv2: falsifier.hasUv2,
          withAoMap: falsifier.withAoMap,
        },
        claimScope:
          "whether the wall-band speckle under RoomEnvironment IBL is produced by the aoMap term "
          + "on one Infinigen room",
        notEvidenceFor: [
          "product lighting default",
          "AO remedy choice",
          "plaster_albedo_variation_R2",
          "other rooms",
          "quest_readiness",
          "clinical_validity",
        ],
        cells,
      };
      writeFileSync(INTERIOR_WALL_AO_PROBE_JSON, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
      return probe;
    } finally {
      await browser.close();
    }
  } finally {
    if (ownedServer && server) await stopPortlessDevServer(server.proc);
  }
}

async function main(): Promise<void> {
  const probe = await renderInteriorWallAoProbe();
  process.stdout.write(
    `interior-wall-ao-probe: wrote ${INTERIOR_WALL_AO_PROBE_JSON} cells=${probe.cells.length}\n`,
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
