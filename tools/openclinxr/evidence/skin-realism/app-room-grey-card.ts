/**
 * Capture command:
 * OPENCLINXR_LOCK_ROOT=/private/tmp/openclinxr-locks pnpm exec tsx tools/openclinxr/openclaw/heavy-slot.ts st-skinref-s1c-app-card -- pnpm exec tsx tools/openclinxr/evidence/skin-realism/app-room-grey-card.ts --lab-manifest .openclinxr/openclaw/ceo/st-skinref/s1b/renders/young-neck-close/mpfb-ob-patient-aisha/runtime/neck-close/numbers.json --out .openclinxr/openclaw/ceo/st-skinref/s1c/app-room-grey-card
 *
 * Loads the requested shipped scenario through apps/ui-xr (OB by default),
 * places the same physical 18% card relative to the patient, then captures it
 * beside the neck and chest.
 * This is a desktop/SwiftShader instrument, not Quest,
 * clinical, learner, scoring, or production-readiness evidence.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import type { Browser, Page } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { decodePng } from "./runtime-portrait-capture.js";
import type { LightSortRecord } from "./vitruvian-grey-card.js";

const TOOL = "tools/openclinxr/evidence/skin-realism/app-room-grey-card.ts";
const DEFAULT_SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";
const DEFAULT_STATION_ID = "ob_headache_preeclampsia_triage_station_v1";
const DEFAULT_ENVIRONMENT_ID = "ob_triage_room_v1";
const DEFAULT_PATIENT_ID = "patient_aisha_khan_v1";
const SIZE = 1024;

type Rect = { x0: number; y0: number; x1: number; y1: number };
type LabManifest = {
  rendererReadback?: Record<string, unknown>;
  lightsReadback?: unknown;
  productRigReadback?: unknown;
  greyCardBoxPx?: Rect;
  greyCard?: {
    worldTransform?: { position?: number[]; quaternion?: number[] };
    sizeMeters?: number;
    focusTargetDistanceMeters?: number;
    cameraDistanceRatio?: number;
    envMapIntensity?: number;
  };
};

type Cli = {
  labManifest: string;
  out: string;
  lightToggle: boolean;
  scenarioId: string;
  stationId: string;
  environmentId: string;
  patientActorId: string;
  positions: Array<"neck" | "chest_side">;
};

function parseCli(argv: string[]): Cli {
  let labManifest = "";
  let out = "";
  let lightToggle = false;
  let scenarioId = DEFAULT_SCENARIO_ID;
  let stationId = DEFAULT_STATION_ID;
  let environmentId = DEFAULT_ENVIRONMENT_ID;
  let patientActorId = DEFAULT_PATIENT_ID;
  // ED: no unoccluded chest_side spot exists (door jamb or off-screen at every offset), so CW2 runs neck only.
  let positions: Array<"neck" | "chest_side"> = ["neck", "chest_side"];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const take = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--lab-manifest") labManifest = take();
    else if (arg === "--out") out = take();
    else if (arg === "--light-toggle") lightToggle = true;
    else if (arg === "--scenario-id") scenarioId = take();
    else if (arg === "--station-id") stationId = take();
    else if (arg === "--environment-id") environmentId = take();
    else if (arg === "--patient-actor-id") patientActorId = take();
    else if (arg === "--positions") {
      const list = take().split(",");
      if (list.length === 0 || list.some((p) => p !== "neck" && p !== "chest_side")) throw new Error("--positions takes neck,chest_side or a subset");
      positions = list as Array<"neck" | "chest_side">;
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!labManifest) throw new Error("--lab-manifest <runtime numbers.json> is required");
  if (!out) throw new Error("--out <directory> is required");
  return { labManifest, out, lightToggle, scenarioId, stationId, environmentId, patientActorId, positions };
}

function command(): string {
  return ["pnpm", "exec", "tsx", TOOL, ...process.argv.slice(2)].join(" ");
}

function appUrl(baseUrl: string, cli: Cli): string {
  const query = new URLSearchParams({
    openclinxrScenarioId: cli.scenarioId,
    stationId: cli.stationId,
    openclinxrEnvironmentId: cli.environmentId,
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
  });
  return `${baseUrl.replace(/\/$/, "")}/?${query.toString()}`;
}

function srgbToLab(r8: number, g8: number, b8: number): [number, number, number] {
  const lin = (v8: number): number => {
    const v = v8 / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (v: number): number => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const m = Math.floor(values.length / 2);
  return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2;
}

function cardMedianLab(pngPath: string, box: Rect): { srgbMedian: [number, number, number]; rawMedianLab: [number, number, number]; pixelCount: number } {
  const png = decodePng(pngPath);
  const inset = Math.max(2, Math.floor(Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.12));
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let y = Math.max(0, box.y0 + inset); y < Math.min(png.h, box.y1 - inset); y += 1) {
    for (let x = Math.max(0, box.x0 + inset); x < Math.min(png.w, box.x1 - inset); x += 1) {
      const i = (y * png.w + x) * png.chans;
      channels[0].push(png.data[i] ?? 0);
      channels[1].push(png.data[i + 1] ?? png.data[i] ?? 0);
      channels[2].push(png.data[i + 2] ?? png.data[i] ?? 0);
    }
  }
  if (!channels[0].length) throw new Error(`empty card box ${JSON.stringify(box)}`);
  const rgb: [number, number, number] = [median(channels[0]), median(channels[1]), median(channels[2])];
  return { srgbMedian: rgb, rawMedianLab: srgbToLab(...rgb), pixelCount: channels[0].length };
}

type LightRecord = LightSortRecord & {
  index: number;
  color: string;
  intensity: number;
  worldPosition: [number, number, number];
  patientRootPosition: [number, number, number];
};

async function placeCard(page: Page, lab: NonNullable<LabManifest["greyCard"]>, position: "neck" | "chest_side", patientActorId: string): Promise<{
  box: Rect;
  worldTransform: Record<string, unknown>;
  renderer: Record<string, unknown>;
  lights: LightRecord[];
  patientMaterials: unknown[];
  patientCandidateSummary: unknown[];
  environmentIntensity: unknown;
  keyDirection: number[];
}> {
  return await page.evaluate(async ({ input, positionId, patientId }) => {
    // The card is built from the page's own three.js module (Vite serves one deps entry; importing that
    // URL returns the module instance the app renders with) and placed in the app's LIVE render camera:
    // the app owns its camera every frame, so the card goes to the camera, not the camera to the card.
    type V = { x: number; y: number; z: number; clone: () => V; copy: (v: V) => V; add: (v: V) => V; sub: (v: V) => V; normalize: () => V; multiplyScalar: (n: number) => V; distanceTo: (v: V) => number; applyMatrix4: (m: unknown) => V; project: (camera: unknown) => V; unproject: (camera: unknown) => V; toArray: () => number[] };
    type Matrix = { clone: () => Matrix; invert: () => Matrix; multiply: (m: Matrix) => Matrix; toArray: () => number[] };
    type Obj = { name?: string; type?: string; userData: Record<string, unknown>; visible?: boolean; position: V; quaternion: { toArray: () => number[] }; scale: V & { set: (x: number, y: number, z: number) => void }; matrixWorld: Matrix; castShadow: boolean; receiveShadow: boolean; frustumCulled: boolean; renderOrder: number; lookAt: (v: V) => void; updateMatrixWorld: (force: boolean) => void; getWorldPosition: (v: V) => V; material?: unknown; traverse?: (fn: (o: Obj) => void) => void };
    type Scene = Obj & { add: (o: Obj) => void; remove: (o: Obj) => void; traverse: (fn: (o: Obj) => void) => void; onAfterRender?: (...args: unknown[]) => void; environmentIntensity?: number };
    type Camera = Obj & { fov: number; aspect: number; isPerspectiveCamera?: boolean };
    type Renderer = { toneMapping: unknown; toneMappingExposure: unknown; outputColorSpace: unknown; domElement: { width: number; height: number } };
    const g = globalThis as unknown as { __openClinXrDebugScene?: Scene; requestAnimationFrame: (fn: () => void) => number };
    const scene = g.__openClinXrDebugScene;
    if (!scene) throw new Error("no shipped __openClinXrDebugScene");
    const names = performance.getEntriesByType("resource").map((entry) => entry.name);
    const chunk = names.find((n) => /\/\.vite\/deps\/three\.module[^/]*\.js/.test(n));
    const threeUrl = names.find((n) => /\/\.vite\/deps\/three\.js(\?|$)/.test(n)) ?? (chunk ? chunk.replace(/three\.module[^/?]*\.js/, "three.js") : undefined);
    if (!threeUrl) throw new Error("page three.js module URL not found in resource timing");
    const THREE = await import(/* @vite-ignore */ threeUrl) as {
      Vector3: new (x?: number, y?: number, z?: number) => V;
      Vector2: new (x?: number, y?: number) => unknown;
      Box3: new () => { setFromObject: (o: Obj) => { getCenter: (v: V) => V; getSize: (v: V) => V } };
      Raycaster: new () => { setFromCamera: (ndc: unknown, camera: unknown) => void; intersectObjects: (objs: Obj[], recursive: boolean) => Array<{ distance: number; object: Obj }> };
      PlaneGeometry: new (w: number, h: number) => unknown;
      MeshStandardMaterial: new (params: Record<string, unknown>) => { name: string };
      Mesh: new (geometry: unknown, material: unknown) => Obj;
      Color: new () => { setRGB: (r: number, g: number, b: number, cs?: string) => unknown };
      LinearSRGBColorSpace: string;
    };
    const old: Obj[] = [];
    const patientCandidates: Obj[] = [];
    let patient: Obj | null = null, key: Obj | null = null, skinIntensity: number | null = null;
    scene.traverse((node) => {
      if (node.userData["openClinXrAppGreyCard"] === true) old.push(node);
      if (node.userData["openClinXrActorId"] === patientId) patientCandidates.push(node);
      if (node.userData["openClinXrLightingRigRole"] === "key") key = node;
      const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const m of mats as Array<{ isMeshStandardMaterial?: boolean; name?: string; envMapIntensity?: number }>) {
        if (skinIntensity == null && m?.isMeshStandardMaterial && /skin|body/i.test(`${node.name ?? ""} ${m.name ?? ""}`)) skinIntensity = m.envMapIntensity ?? 1;
      }
    });
    // Several nodes carry the patient's actor id (role placeholder, nameplate, the loaded GLB).
    // The placement frame and the material dump must use the one that holds the skinned body.
    const candidateRows = patientCandidates.map((node) => {
      let meshes = 0, skinned = 0;
      node.traverse?.((child) => {
        const flags = child as unknown as { isMesh?: boolean; isSkinnedMesh?: boolean };
        if (flags.isMesh) meshes += 1;
        if (flags.isSkinnedMesh) skinned += 1;
      });
      return { node, name: node.name ?? "", type: node.type ?? "", meshes, skinned };
    });
    patient = candidateRows.filter((row) => row.skinned > 0).sort((a, b) => b.skinned - a.skinned || a.meshes - b.meshes)[0]?.node ?? null;
    const patientCandidateSummary = candidateRows.map(({ name, type, meshes: meshCount, skinned }) => ({
      name,
      type,
      meshes: meshCount,
      skinned,
    }));
    if (!patient) {
      const skinnedChains: string[][] = [];
      scene.traverse((node) => {
        if (!(node as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
        const chain: string[] = [];
        for (let at: (Obj & { parent?: Obj | null }) | null | undefined = node as Obj & { parent?: Obj | null }; at; at = at.parent) chain.push(`${at.name ?? ""}<${at.type ?? ""}>${at.userData["openClinXrActorId"] ? `[${String(at.userData["openClinXrActorId"])}]` : ""}`);
        skinnedChains.push(chain);
      });
      throw new Error(`no node tagged ${patientId} holds a SkinnedMesh: ${JSON.stringify(patientCandidateSummary)} skinned=${JSON.stringify(skinnedChains.slice(0, 12))}`);
    }
    for (const o of old) scene.remove(o);
    if (!patient || !key) throw new Error("app scene lacks patient or key light");
    const livePatient = patient as Obj, liveKey = key as Obj;
    livePatient.updateMatrixWorld(true);

    // Grab the live renderer and camera from one real frame.
    let renderer: Renderer | null = null, camera: Camera | null = null;
    const prior = scene.onAfterRender;
    scene.onAfterRender = (...args: unknown[]) => { renderer = args[0] as Renderer; camera = args[2] as Camera; if (typeof prior === "function") prior(...args); };
    await new Promise<void>((resolve) => g.requestAnimationFrame(() => g.requestAnimationFrame(resolve)));
    if (prior) scene.onAfterRender = prior; else delete scene.onAfterRender;
    if (!renderer || !camera) throw new Error("app render did not expose renderer/camera");
    const liveRenderer = renderer as Renderer, liveCamera = camera as Camera;
    liveCamera.updateMatrixWorld(true);
    const camPos = liveCamera.getWorldPosition(new THREE.Vector3());

    const box = new THREE.Box3().setFromObject(livePatient);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    let headNode: Obj | null = null;
    livePatient.traverse?.((node) => {
      const flags = node as unknown as { isBone?: boolean; isMesh?: boolean };
      if (!headNode && flags.isBone && /(^|[_ .-])head($|[_ .-])/i.test(node.name ?? "")) headNode = node;
    });
    let headReference = "head bone world position";
    if (!headNode) {
      livePatient.traverse?.((node) => {
        const flags = node as unknown as { isMesh?: boolean };
        if (!headNode && flags.isMesh && /head|face/i.test(node.name ?? "")) headNode = node;
      });
      headReference = "head mesh bbox centre";
    }
    if (!headNode) throw new Error(`patient root ${livePatient.name ?? "(unnamed)"} has no stable head bone or head mesh`);
    const liveHead = headNode as Obj;
    const headPosition = headReference === "head mesh bbox centre"
      ? new THREE.Box3().setFromObject(liveHead).getCenter(new THREE.Vector3())
      : liveHead.getWorldPosition(new THREE.Vector3());
    const keyWorld = liveKey.getWorldPosition(new THREE.Vector3());
    const keyDirection = keyWorld.clone().sub(centre).normalize();
    const cardSize = 0.12;
    const offsets = [0.18, -0.18, 0.28, -0.28, 0.38, -0.38, 0.46, -0.46];
    const toPatient = centre.clone().sub(camPos).normalize();
    const side = new THREE.Vector3(-toPatient.z, 0, toPatient.x).normalize();
    const meshes: Obj[] = [];
    scene.traverse((o) => { if ((o as unknown as { isMesh?: boolean }).isMesh && o.visible !== false) meshes.push(o); });
    const raycaster = new THREE.Raycaster();
    let chosen: { pos: V; offset: number } | null = null;
    const rejected: unknown[] = [];
    for (const offset of offsets) {
      const anchor = positionId === "neck" ? headPosition : centre;
      const pos = anchor.clone().add(side.clone().multiplyScalar(offset));
      pos.y = positionId === "neck" ? headPosition.y - Math.min(0.16, size.y * 0.08) : centre.y + size.y * 0.1;
      const ndc = pos.clone().project(liveCamera);
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.8 || ndc.z > 1) {
        rejected.push({ offset, ndc: ndc.toArray(), reason: "HUD/screen bounds" });
        continue;
      }
      if (positionId === "neck" && pos.distanceTo(headPosition) > 0.5) {
        rejected.push({ offset, headDistanceMeters: pos.distanceTo(headPosition), reason: "farther than 0.5 m from head" });
        continue;
      }
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), liveCamera);
      const dist = camPos.distanceTo(pos);
      const hits = raycaster.intersectObjects(meshes, true).filter((h) => h.distance < dist - 0.05);
      if (hits.length === 0) { chosen = { pos, offset }; break; }
      rejected.push({ offset: Math.round(offset * 100) / 100, ndc: [Math.round(ndc.x * 100) / 100, Math.round(ndc.y * 100) / 100], dist: Math.round(dist * 100) / 100, hits: hits.slice(0, 3).map((h) => `${h.object.name ?? h.object.type}@${Math.round(h.distance * 100) / 100}`) });
    }
    if (!chosen) throw new Error(`no unoccluded on-screen card spot for ${positionId}: ${JSON.stringify(rejected)}`);

    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace), roughness: 1, metalness: 0, envMapIntensity: input.envMapIntensity ?? skinIntensity ?? 1 });
    material.name = "openclinxr_app_18_percent_grey_card_material";
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    card.name = `openclinxr_app_grey_card_${positionId}`;
    card.userData["openClinXrAppGreyCard"] = true;
    card.position.copy(chosen.pos);
    card.scale.set(cardSize, cardSize, 1);
    card.lookAt(camPos);
    card.castShadow = false; card.receiveShadow = true; card.frustumCulled = false;
    scene.add(card); card.updateMatrixWorld(true);
    await new Promise<void>((resolve) => g.requestAnimationFrame(() => g.requestAnimationFrame(resolve)));

    const width = liveRenderer.domElement.width, height = liveRenderer.domElement.height;
    const px = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(card.matrixWorld).project(liveCamera)).map((p) => ({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }));
    const rootInverse = livePatient.matrixWorld.clone().invert();
    const patientMaterials: unknown[] = [];
    livePatient.traverse?.((node) => {
      const flags = node as unknown as { isMesh?: boolean };
      if (!flags.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const entry of materials as Array<{ name?: string; type?: string; color?: { getHexString?: () => string }; map?: unknown; userData?: Record<string, unknown> }>) {
        patientMaterials.push({
          meshName: node.name ?? "",
          materialName: entry.name ?? "",
          materialType: entry.type ?? "",
          colorHex: entry.color?.getHexString ? `#${entry.color.getHexString()}` : null,
          mapPresent: Boolean(entry.map),
          openClinXrMaterialPolicy: entry.userData?.["openClinXrMaterialPolicy"] ?? null,
        });
      }
    });
    const unsortedLights: Array<Omit<LightRecord, "index"> & { node: Obj }> = [];
    scene.traverse((node) => {
      const color = (node as unknown as { color?: { getHexString?: () => string } }).color;
      const intensity = (node as unknown as { intensity?: unknown }).intensity;
      if (typeof intensity !== "number" || !color?.getHexString) return;
      const world = node.getWorldPosition(new THREE.Vector3());
      unsortedLights.push({
        node,
        type: node.type ?? "",
        intensity,
        color: `#${color.getHexString()}`,
        worldPosition: world.toArray() as [number, number, number],
        patientRootPosition: world.clone().applyMatrix4(rootInverse).toArray() as [number, number, number],
        role: (node.userData["openClinXrLightingRigRole"] ?? node.userData["openClinXrStationInteriorLightingRole"] ?? null) as string | null,
      });
    });
    unsortedLights.sort((a, b) => (a.role ?? "").localeCompare(b.role ?? "") || a.type.localeCompare(b.type) || a.worldPosition[0] - b.worldPosition[0] || a.worldPosition[1] - b.worldPosition[1] || a.worldPosition[2] - b.worldPosition[2]);
    const lights = unsortedLights.map(({ node, ...record }, index) => {
      node.userData["openClinXrGreyCardLightToggleIndex"] = index;
      return { index, ...record };
    });
    const ndc = chosen.pos.clone().project(liveCamera);
    return {
      box: { x0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.x)))), y0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.y)))), x1: Math.min(width, Math.ceil(Math.max(...px.map((p) => p.x)))), y1: Math.min(height, Math.ceil(Math.max(...px.map((p) => p.y)))) },
      worldTransform: {
        position: card.position.toArray(), quaternion: card.quaternion.toArray(), scale: card.scale.toArray(), matrix: card.matrixWorld.toArray(),
        patientRootMatrix: rootInverse.clone().multiply(card.matrixWorld).toArray(),
        patientRootName: livePatient.name ?? "",
        patientRootActorId: patientId,
        lateralOffsetMeters: chosen.offset,
        cameraDistanceMeters: camPos.distanceTo(chosen.pos),
        headReference: { method: headReference, objectName: liveHead.name ?? "", worldPosition: headPosition.toArray() },
        headDistanceMeters: chosen.pos.distanceTo(headPosition),
        ndc: ndc.toArray(),
      },
      renderer: { toneMapping: liveRenderer.toneMapping, toneMappingExposure: liveRenderer.toneMappingExposure, outputColorSpace: liveRenderer.outputColorSpace },
      lights,
      patientMaterials,
      patientCandidateSummary,
      environmentIntensity: scene.environmentIntensity ?? null,
      keyDirection: keyDirection.toArray(),
    };
  }, { input: lab, positionId: position, patientId: patientActorId });
}

async function setAppLightVisibility(page: Page, index: number | null, visible: boolean): Promise<{ allVisible: boolean }> {
  return await page.evaluate(async ({ lightIndex, nextVisible }) => {
    type Node = { visible?: boolean; userData?: Record<string, unknown> };
    const g = globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (node: Node) => void) => void }; requestAnimationFrame: (fn: () => void) => number };
    const scene = g.__openClinXrDebugScene;
    if (!scene) throw new Error("no shipped __openClinXrDebugScene");
    let found = lightIndex == null;
    scene.traverse((node) => {
      const tagged = node.userData?.["openClinXrGreyCardLightToggleIndex"];
      if (typeof tagged !== "number") return;
      if (lightIndex == null || tagged === lightIndex) {
        node.visible = nextVisible;
        if (tagged === lightIndex) found = true;
      }
    });
    if (!found) throw new Error(`light toggle index ${String(lightIndex)} disappeared`);
    await new Promise<void>((resolve) => g.requestAnimationFrame(() => g.requestAnimationFrame(resolve)));
    let allVisible = true;
    scene.traverse((node) => {
      if (typeof node.userData?.["openClinXrGreyCardLightToggleIndex"] === "number" && node.visible !== true) allVisible = false;
    });
    return { allVisible };
  }, { lightIndex: index, nextVisible: visible });
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const cwd = process.cwd();
  const out = path.resolve(cwd, cli.out);
  const labPath = path.resolve(cwd, cli.labManifest);
  const labBytes = await readFile(labPath);
  const lab = JSON.parse(labBytes.toString("utf8")) as LabManifest;
  if (!lab.greyCard?.worldTransform?.position || !lab.greyCard.worldTransform.quaternion || !lab.greyCard.sizeMeters || !lab.greyCardBoxPx) throw new Error("lab manifest has no complete greyCard record/box");
  const labPng = path.join(path.dirname(labPath), "new.png");
  const labCardMeasurement = cardMedianLab(labPng, lab.greyCardBoxPx);
  await mkdir(out, { recursive: true });
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    await createLocalComputeServices().sceneCapture.withBrowser("skin-realism:app-room-grey-card", async (handle) => {
      const browser = handle as Browser;
      const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
      await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
      await page.addInitScript("globalThis.__name = globalThis.__name || ((target) => target);");
      const pageFaults: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") pageFaults.push(message.text().slice(0, 400)); });
      page.on("pageerror", (error) => pageFaults.push(`pageerror: ${error.message.slice(0, 400)}`));
      page.on("response", (response) => { if (response.status() >= 400) pageFaults.push(`HTTP ${response.status()} ${response.url().slice(0, 300)}`); });
      await page.goto(appUrl(server!.url, cli), { waitUntil: "networkidle", timeout: 180_000 });
      await page.waitForFunction((patientId) => {
        const scene = (globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (node: { userData?: Record<string, unknown> }) => void) => void } }).__openClinXrDebugScene;
        if (!scene) return false;
        let actor = false, key = false, body = false;
        scene.traverse((node) => {
          if (node.userData?.["openClinXrActorId"] === patientId) actor = true;
          if (node.userData?.["openClinXrLightingRigRole"] === "key") key = true;
          // The patient's GLB body loads after the role placeholder and after other actors' bodies;
          // only a SkinnedMesh under a node tagged with the patient id counts.
          const mesh = node as { isSkinnedMesh?: boolean; parent?: { userData?: Record<string, unknown>; parent?: unknown } | null };
          if (!mesh.isSkinnedMesh) return;
          for (let at = mesh.parent; at; at = at.parent as typeof at) if (at.userData?.["openClinXrActorId"] === patientId) { body = true; break; }
        });
        return actor && key && body;
      }, cli.patientActorId, { timeout: 180_000 }).catch(async (error: unknown) => {
        const state = await page.evaluate(() => {
          const g = globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (node: { userData?: Record<string, unknown> }) => void) => void }; location: { href: string } };
          const actors = new Set<string>(); const roles = new Set<string>();
          g.__openClinXrDebugScene?.traverse((node) => {
            const actor = node.userData?.["openClinXrActorId"]; if (typeof actor === "string") actors.add(actor);
            const role = node.userData?.["openClinXrLightingRigRole"] ?? node.userData?.["openClinXrStationInteriorLightingRole"]; if (typeof role === "string") roles.add(role);
          });
          return { href: g.location.href, debugScene: Boolean(g.__openClinXrDebugScene), actors: [...actors], lightRoles: [...roles] };
        });
        throw new Error(`app scene never had patient ${cli.patientActorId} + a key-role light: ${JSON.stringify(state)} faults=${JSON.stringify(pageFaults.slice(0, 8))} (${String(error)})`);
      });
      const captures: Record<string, unknown> = {};
      // Behaviour-identity record for I1b: every actor-tagged node, its world matrix, and each SkinnedMesh's tagged ancestor.
      const sceneDump = await page.evaluate(() => {
        type N = { name?: string; type?: string; userData?: Record<string, unknown>; matrixWorld: { elements: number[] }; isSkinnedMesh?: boolean; parent?: N | null; updateMatrixWorld?: (f: boolean) => void };
        const scene = (globalThis as unknown as { __openClinXrDebugScene: N & { traverse: (fn: (n: N) => void) => void } }).__openClinXrDebugScene;
        scene.updateMatrixWorld?.(true);
        const r = (m: number[]) => m.map((v) => Math.round(v * 1e5) / 1e5);
        const tagged: unknown[] = [], skinned: unknown[] = [];
        scene.traverse((n) => {
          const id = n.userData?.["openClinXrActorId"];
          if (typeof id === "string" && id) tagged.push({ name: n.name ?? "", type: n.type ?? "", actorId: id, slotKind: n.userData?.["openClinXrSlotKind"] ?? null, posture: n.userData?.["openClinXrActorPosture"] ?? null, matrixWorld: r(n.matrixWorld.elements) });
          if (n.isSkinnedMesh) {
            let owner: string | null = null;
            for (let at = n.parent; at; at = at.parent ?? null) { const a = at.userData?.["openClinXrActorId"]; if (typeof a === "string" && a) { owner = a; break; } }
            skinned.push({ name: n.name ?? "", owner });
          }
        });
        return { tagged, skinned };
      });
      await writeFile(path.join(out, "scene-dump.json"), `${JSON.stringify(sceneDump, null, 2)}\n`, "utf8");
      for (const position of cli.positions) {
        const live = await placeCard(page, lab.greyCard!, position, cli.patientActorId);
        const png = path.join(out, `${position}.png`);
        await page.locator("#station-canvas").screenshot({ path: png, timeout: 180_000 });
        const measured = cardMedianLab(png, live.box);
        const lightToggle: Array<LightRecord & { cardLab: ReturnType<typeof cardMedianLab>; dLstar: number }> = [];
        let restoreCheck: Record<string, unknown> | null = null;
        if (cli.lightToggle) {
          for (const light of live.lights) {
            try {
              await setAppLightVisibility(page, light.index, false);
              const togglePng = path.join(out, `${position}-light-${String(light.index).padStart(2, "0")}-off.png`);
              await page.locator("#station-canvas").screenshot({ path: togglePng, timeout: 180_000 });
              const cardLab = cardMedianLab(togglePng, live.box);
              lightToggle.push({ ...light, cardLab, dLstar: measured.rawMedianLab[0] - cardLab.rawMedianLab[0] });
            } finally {
              await setAppLightVisibility(page, light.index, true);
            }
          }
          const restored = await setAppLightVisibility(page, null, true);
          if (!restored.allVisible) throw new Error("not every app light was visible after the toggle sweep");
          const restorePng = path.join(out, `${position}-restore-check.png`);
          await page.locator("#station-canvas").screenshot({ path: restorePng, timeout: 180_000 });
          const restoredLab = cardMedianLab(restorePng, live.box);
          const deltaLstar = Math.abs(measured.rawMedianLab[0] - restoredLab.rawMedianLab[0]);
          if (deltaLstar > 0.1) throw new Error(`${position} restore check changed L* by ${deltaLstar}, above 0.1`);
          restoreCheck = { png: path.relative(cwd, restorePng), allLightsVisible: true, cardLab: restoredLab, deltaLstar };
        }
        captures[position] = {
          png: path.relative(cwd, png),
          ...live,
          ...measured,
          lightToggle,
          restoreCheck,
          skinMaterialRows: live.patientMaterials.filter((row) => /skin|body/i.test(JSON.stringify(row))),
        };
      }
      const report = {
        schema: "openclinxr.st-skinref-i1b.app-room-grey-card.v2",
        command: command(),
        route: appUrl(server!.url, cli),
        shippedPath: { app: "apps/ui-xr", scenarioId: cli.scenarioId, stationId: cli.stationId, environmentId: cli.environmentId, actorId: cli.patientActorId },
        card: { linearReflectance: 0.18, roughness: 1, metalness: 0, castShadow: false, receiveShadow: true, relativePlacementSource: "neck/head reference or chest-side anchor in the live patient root" },
        lab: { manifest: path.relative(cwd, labPath), sha256: createHash("sha256").update(labBytes).digest("hex"), png: path.relative(cwd, labPng), card: labCardMeasurement, renderer: lab.rendererReadback ?? null, lights: lab.lightsReadback ?? null, productRig: lab.productRigReadback ?? null },
        app: captures,
        decisionRule: "lightToggle dLstar names each sorted light's contribution before any lighting fix",
        notEvidenceFor: ["quest_readiness", "clinical_validity", "learner_readiness", "scoring_validity", "production_asset_readiness"],
      };
      await writeFile(path.join(out, "app-room-grey-card.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
