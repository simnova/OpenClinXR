/**
 * #534 — probe: every Infinigen room primitive carries a material in the live graph after load.
 *
 * Graph half: three.js GLTFLoader + `assignMissingRoomPrimitiveMaterials` (same path as
 * `loadInfinigenEnvironmentIntoStation`). Luminance half: extends #529 interior-wall-ao-probe
 * camera / HUD hide / regionLuminance on primary-care (D1 — no fourth capture harness).
 *
 * claimScope: material presence after loader-side assignment; wall/ceiling luminance READING only.
 * notEvidenceFor: lighting default; AO remedy; Quest readiness; clinical validity; wall appearance grade.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Box3,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "../../../apps/ui-xr/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../../apps/ui-xr/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { chromium, type Page } from "playwright";
import {
  assignMissingRoomPrimitiveMaterials,
  isGltfMissingAuthoredMaterial,
} from "../../../apps/ui-xr/src/infinigen-room-primitive-materials.ts";
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
const ENV_DIR = join(REPO, "apps/ui-xr/public/xr-assets/environment");

export const ROOM_PRIMITIVE_MATERIAL_PROBE_JSON = join(
  REPO,
  "tools/openclinxr/evidence/room-primitive-material-probe.json",
);
export const ROOM_PRIMITIVE_MATERIAL_PROBE_OUT_DIR = join(
  REPO,
  "tools/openclinxr/evidence/room-primitive-material-probe",
);

/** Same wall-band as #525 / #529. */
const WALL_BAND = { left: 0.08, top: 0.18, width: 0.42, height: 0.48 } as const;
/** Ceiling strip above the wall band — reading only (§9d). */
const CEILING_BAND = { left: 0.08, top: 0.02, width: 0.42, height: 0.12 } as const;

const INFINIGEN_SHELLS = [
  "infinigen-adult-ed-abdominal-bay.glb",
  "infinigen-behavioral-health-private.glb",
  "infinigen-ed-exam-bay.glb",
  "infinigen-ed-stroke-bay.glb",
  "infinigen-inpatient-ward.glb",
  "infinigen-ob-triage.glb",
  "infinigen-oncology-consult.glb",
  "infinigen-pediatric-fever-urgent-care.glb",
  "infinigen-pediatric-urgent-care-bay.glb",
  "infinigen-primary-care-clinic.glb",
  "infinigen-stepdown.glb",
  "infinigen-surgical-ward.glb",
  "infinigen-telehealth-home-visit.glb",
  "infinigen-urgent-care-clinic.glb",
] as const;

type GraphPrim = {
  mesh?: string;
  material?: string | null;
  assignedAtLoad?: boolean;
  visible?: boolean;
  worldExtent?: [number, number, number];
  side?: string;
  materialSource?: string;
  baseColor?: [number, number, number];
};

type Shell = {
  glb?: string;
  prims?: GraphPrim[];
  wallRegionMeanL?: number;
  ceilingRegionMeanL?: number;
};

type ProbeArtifact = {
  schemaVersion: "openclinxr.room-primitive-material-probe.v1";
  generatedAt: string;
  room: string;
  scenarioId: string;
  claimScope: string;
  notEvidenceFor: string[];
  shells: Shell[];
  glbSha256: Record<string, string>;
};

// Node shim for GLTFLoader texture path (same class as external-tool-cagematch.ts).
(globalThis as { self?: typeof globalThis }).self ??= globalThis;
if (typeof URL.createObjectURL !== "function") {
  const blobUrls = new Map<string, unknown>();
  URL.createObjectURL = ((blob: unknown) => {
    const url = `blob:node/${blobUrls.size}`;
    blobUrls.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    blobUrls.delete(url);
  }) as typeof URL.revokeObjectURL;
}
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  (globalThis as { document: unknown }).document = {
    createElementNS: () => {
      const el = new EventTarget() as EventTarget & {
        complete: boolean;
        setAttribute: () => void;
        removeAttribute: () => void;
        src?: string;
      };
      el.complete = false;
      el.setAttribute = () => {};
      el.removeAttribute = () => {};
      let src: string | undefined;
      Object.defineProperty(el, "src", {
        get: () => src,
        set: (v: string) => {
          src = v;
          el.complete = true;
          setTimeout(() => el.dispatchEvent(new Event("load")), 0);
        },
      });
      return el;
    },
  };
}

function sideLabel(side: number | undefined): string {
  if (side === DoubleSide) return "DoubleSide";
  if (side === 1) return "BackSide";
  return "FrontSide";
}

function dumpPrims(root: Object3D): GraphPrim[] {
  const prims: GraphPrim[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const std = mat instanceof MeshStandardMaterial ? mat : null;
    const box = new Box3().setFromObject(obj);
    const extent: [number, number, number] = [
      Math.max(0, box.max.x - box.min.x),
      Math.max(0, box.max.y - box.min.y),
      Math.max(0, box.max.z - box.min.z),
    ];
    const assignedAtLoad = !!(
      obj.userData.openClinXrAssignedMaterialAtLoad
      || (std && std.userData.openClinXrAssignedAtLoad)
    );
    const materialSource =
      typeof obj.userData.openClinXrMaterialSource === "string"
        ? obj.userData.openClinXrMaterialSource
        : typeof std?.userData.openClinXrMaterialSource === "string"
          ? std.userData.openClinXrMaterialSource
          : undefined;
    const name = std && typeof std.name === "string" ? std.name : "";
    // Empty / missing name ⇒ material-less for the contract filter `!p.material`.
    const material = isGltfMissingAuthoredMaterial(obj.material) ? null : (name || null);
    prims.push({
      mesh: obj.name || "(unnamed)",
      material,
      assignedAtLoad: assignedAtLoad || undefined,
      visible: obj.visible,
      worldExtent: extent,
      side: std ? sideLabel(std.side) : undefined,
      materialSource,
      baseColor: std
        ? [Number(std.color.r.toFixed(4)), Number(std.color.g.toFixed(4)), Number(std.color.b.toFixed(4))]
        : undefined,
    });
  });
  return prims;
}

async function loadGlbWithRuntimeLoader(absPath: string): Promise<Object3D> {
  const buf = readFileSync(absPath);
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
    loader.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "",
      (parsed) => resolve(parsed as { scene: Object3D }),
      reject,
    );
  });
  return gltf.scene;
}

function buildIblUrl(baseUrl: string, scenarioId: string, captureMode: string): string {
  const url = new URL(buildRoomCaptureUrl(baseUrl, scenarioId, captureMode));
  url.searchParams.set("stationLighting", "room_environment_ibl");
  return url.toString();
}

/** Hide non-3D HUD — same selector set as interior-wall-ao-probe.ts. */
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
 * Verbatim from interior-wall-ao-probe.ts forceInteriorWallCamera (D1 reuse).
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
      "interior_wall_material_probe_#534_actorless_interior_eye";
    return "roomCam(interiorWall)=" + eyeX.toFixed(2) + "," + eyeY.toFixed(2) + "," + eyeZ.toFixed(2)
      + " look=" + lookX.toFixed(2) + "," + lookY.toFixed(2) + "," + lookZ.toFixed(2)
      + " wallThickness=" + wallThickness.toFixed(3);
  })()`) as Promise<string>;
}

async function capturePrimaryCareLuminance(baseUrl: string): Promise<{
  wallRegionMeanL: number;
  ceilingRegionMeanL: number;
  cameraNote: string;
  image: string;
}> {
  mkdirSync(ROOM_PRIMITIVE_MATERIAL_PROBE_OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1007, height: 900 } });
    const url = buildIblUrl(baseUrl, SHEET_SCENARIO_ID, "scene-overview");
    process.stdout.write(`room-primitive-material-probe: goto ${url}\n`);
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
      throw new Error("room-primitive-material-probe: Infinigen room never became present");
    }

    const cameraNote = await forceInteriorWallCamera(page);
    await page.waitForTimeout(800);
    await hideHudPanels(page);
    await page.waitForTimeout(200);

    const imageName = "primary-care-interior.png";
    const imagePath = join(ROOM_PRIMITIVE_MATERIAL_PROBE_OUT_DIR, imageName);
    const bytes = new Uint8Array(await page.screenshot({ fullPage: false, type: "png" }));
    writeFileSync(imagePath, bytes);

    const wall = regionLuminance(bytes, WALL_BAND, { step: 3, blackLuma: 4 });
    const ceiling = regionLuminance(bytes, CEILING_BAND, { step: 3, blackLuma: 4 });
    if (!wall || !ceiling) {
      throw new Error("room-primitive-material-probe: luminance decode failed");
    }
    process.stdout.write(
      `room-primitive-material-probe: cam=${cameraNote} wallL=${wall.mean.toFixed(2)} ceilingL=${ceiling.mean.toFixed(2)}\n`,
    );
    return {
      wallRegionMeanL: Number(wall.mean.toFixed(2)),
      ceilingRegionMeanL: Number(ceiling.mean.toFixed(2)),
      cameraNote,
      image: `room-primitive-material-probe/${imageName}`,
    };
  } finally {
    await browser.close();
  }
}

export async function renderRoomPrimitiveMaterialProbe(input?: {
  baseUrl?: string;
  skipCapture?: boolean;
}): Promise<ProbeArtifact> {
  const glbSha256: Record<string, string> = {};
  const shells: Shell[] = [];

  for (const glb of INFINIGEN_SHELLS) {
    const abs = join(ENV_DIR, glb);
    if (!existsSync(abs)) {
      throw new Error(`room-primitive-material-probe: missing ${glb}`);
    }
    const bytes = readFileSync(abs);
    glbSha256[glb] = createHash("sha256").update(bytes).digest("hex");

    const scene = await loadGlbWithRuntimeLoader(abs);
    const assigned = assignMissingRoomPrimitiveMaterials(scene);
    process.stdout.write(
      `room-primitive-material-probe: ${glb} assigned=${assigned.length} `
        + `sources=${assigned.map((a) => a.materialSource).join(",") || "-"}\n`,
    );
    shells.push({ glb, prims: dumpPrims(scene) });
  }

  // Also record the clean hand-built shell (0 assigned) for completeness — not in contract keys.
  const handBuilt = "ed-exam-bay-shell.glb";
  if (existsSync(join(ENV_DIR, handBuilt))) {
    const abs = join(ENV_DIR, handBuilt);
    glbSha256[handBuilt] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    const scene = await loadGlbWithRuntimeLoader(abs);
    assignMissingRoomPrimitiveMaterials(scene);
    shells.push({ glb: handBuilt, prims: dumpPrims(scene) });
  }

  let wallRegionMeanL: number | undefined;
  let ceilingRegionMeanL: number | undefined;
  if (!input?.skipCapture) {
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
      const lum = await capturePrimaryCareLuminance(baseUrl);
      wallRegionMeanL = lum.wallRegionMeanL;
      ceilingRegionMeanL = lum.ceilingRegionMeanL;
    } finally {
      if (ownedServer && server) await stopPortlessDevServer(server.proc);
    }
  }

  const primary = shells.find((s) => s.glb === "infinigen-primary-care-clinic.glb");
  if (primary && wallRegionMeanL != null && ceilingRegionMeanL != null) {
    primary.wallRegionMeanL = wallRegionMeanL;
    primary.ceilingRegionMeanL = ceilingRegionMeanL;
  }

  const probe: ProbeArtifact = {
    schemaVersion: "openclinxr.room-primitive-material-probe.v1",
    generatedAt: new Date().toISOString(),
    room: SHEET_ROOM,
    scenarioId: SHEET_SCENARIO_ID,
    claimScope:
      "whether every primitive in the shipped Infinigen room shells carries a material in the live "
      + "three.js scene graph after loader-side plaster-derived assignment; GLBs unmodified",
    notEvidenceFor: [
      "product lighting default",
      "AO remedy",
      "plaster_albedo_variation_R2",
      "quest_readiness",
      "clinical_validity",
      "whether walls look correct",
    ],
    shells,
    glbSha256,
  };
  writeFileSync(ROOM_PRIMITIVE_MATERIAL_PROBE_JSON, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
  return probe;
}

async function main(): Promise<void> {
  const skipCapture = process.argv.includes("--skip-capture");
  const probe = await renderRoomPrimitiveMaterialProbe({ skipCapture });
  const dirty = (probe.shells ?? [])
    .filter((s) => (s.prims ?? []).some((p) => !p.material))
    .map((s) => s.glb);
  process.stdout.write(
    `room-primitive-material-probe: wrote ${ROOM_PRIMITIVE_MATERIAL_PROBE_JSON} `
      + `shells=${probe.shells.length} stillBare=${JSON.stringify(dirty)}\n`,
  );
  // List PNGs for the contract's image deliverable root.
  if (existsSync(ROOM_PRIMITIVE_MATERIAL_PROBE_OUT_DIR)) {
    const pngs = readdirSync(ROOM_PRIMITIVE_MATERIAL_PROBE_OUT_DIR).filter((f) => f.endsWith(".png"));
    process.stdout.write(`room-primitive-material-probe: pngs=${pngs.join(",") || "(none)"}\n`);
  }
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
