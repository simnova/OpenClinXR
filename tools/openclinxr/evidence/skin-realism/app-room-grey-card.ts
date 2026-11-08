/**
 * Capture command:
 * OPENCLINXR_LOCK_ROOT=/private/tmp/openclinxr-locks pnpm exec tsx tools/openclinxr/openclaw/heavy-slot.ts st-skinref-s1c-app-card -- pnpm exec tsx tools/openclinxr/evidence/skin-realism/app-room-grey-card.ts --lab-manifest .openclinxr/openclaw/ceo/st-skinref/s1b/renders/young-neck-close/mpfb-ob-patient-aisha/runtime/neck-close/numbers.json --out .openclinxr/openclaw/ceo/st-skinref/s1c/app-room-grey-card
 *
 * Loads the shipped OB scenario through apps/ui-xr, places the same physical
 * 18% card relative to the patient, then captures it at subject depth and 1 m
 * nearer the live rig key. This is a desktop/SwiftShader instrument, not Quest,
 * clinical, learner, scoring, or production-readiness evidence.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import type { Browser, Page } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { decodePng } from "./runtime-portrait-capture.js";

const TOOL = "tools/openclinxr/evidence/skin-realism/app-room-grey-card.ts";
const SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";
const STATION_ID = "ob_headache_preeclampsia_triage_station_v1";
const ENVIRONMENT_ID = "ob_triage_room_v1";
const PATIENT_ID = "patient_aisha_khan_v1";
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

function parseCli(argv: string[]): { labManifest: string; out: string } {
  let labManifest = "";
  let out = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const take = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--lab-manifest") labManifest = take();
    else if (arg === "--out") out = take();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!labManifest) throw new Error("--lab-manifest <runtime numbers.json> is required");
  if (!out) throw new Error("--out <directory> is required");
  return { labManifest, out };
}

function command(): string {
  return ["pnpm", "exec", "tsx", TOOL, ...process.argv.slice(2)].join(" ");
}

function appUrl(baseUrl: string): string {
  const query = new URLSearchParams({
    openclinxrScenarioId: SCENARIO_ID,
    stationId: STATION_ID,
    openclinxrEnvironmentId: ENVIRONMENT_ID,
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

async function placeCard(page: Page, lab: NonNullable<LabManifest["greyCard"]>, position: "subject_depth" | "key_near_1m"): Promise<{
  box: Rect;
  worldTransform: Record<string, unknown>;
  renderer: Record<string, unknown>;
  lights: unknown[];
  environmentIntensity: unknown;
  keyDirection: number[];
}> {
  return await page.evaluate(async ({ input, positionId, patientId }) => {
    // The card is built from the page's own three.js module (Vite serves one deps entry; importing that
    // URL returns the module instance the app renders with) and placed in the app's LIVE render camera:
    // the app owns its camera every frame, so the card goes to the camera, not the camera to the card.
    type V = { x: number; y: number; z: number; clone: () => V; copy: (v: V) => V; add: (v: V) => V; sub: (v: V) => V; normalize: () => V; multiplyScalar: (n: number) => V; distanceTo: (v: V) => number; applyMatrix4: (m: unknown) => V; project: (camera: unknown) => V; unproject: (camera: unknown) => V; toArray: () => number[] };
    type Obj = { name?: string; type?: string; userData: Record<string, unknown>; visible?: boolean; position: V; quaternion: { toArray: () => number[] }; scale: V & { set: (x: number, y: number, z: number) => void }; matrixWorld: { toArray: () => number[] }; castShadow: boolean; receiveShadow: boolean; frustumCulled: boolean; renderOrder: number; lookAt: (v: V) => void; updateMatrixWorld: (force: boolean) => void; getWorldPosition: (v: V) => V; material?: unknown };
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
    let patient: Obj | null = null, key: Obj | null = null, skinIntensity: number | null = null;
    scene.traverse((node) => {
      if (node.userData["openClinXrAppGreyCard"] === true) old.push(node);
      if (!patient && node.userData["openClinXrActorId"] === patientId) patient = node;
      if (node.userData["openClinXrLightingRigRole"] === "key") key = node;
      const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const m of mats as Array<{ isMeshStandardMaterial?: boolean; name?: string; envMapIntensity?: number }>) {
        if (skinIntensity == null && m?.isMeshStandardMaterial && /skin|body/i.test(`${node.name ?? ""} ${m.name ?? ""}`)) skinIntensity = m.envMapIntensity ?? 1;
      }
    });
    for (const o of old) scene.remove(o);
    if (!patient || !key) throw new Error("app scene lacks patient or key light");
    const livePatient = patient as Obj, liveKey = key as Obj;

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
    const keyWorld = liveKey.getWorldPosition(new THREE.Vector3());
    const keyDirection = keyWorld.clone().sub(centre).normalize();
    const cardSize = 0.12;
    // Candidate spots beside the patient at chest height, at the patient's depth; position ii shifts 1 m toward the key.
    const offsets = [0.5, -0.5, 0.7, -0.7, 0.9, -0.9].map((k) => k * Math.max(size.x, size.z) + Math.sign(k) * cardSize);
    const toPatient = centre.clone().sub(camPos).normalize();
    const side = new THREE.Vector3(-toPatient.z, 0, toPatient.x).normalize();
    const meshes: Obj[] = [];
    scene.traverse((o) => { if ((o as unknown as { isMesh?: boolean }).isMesh && o.visible !== false) meshes.push(o); });
    const raycaster = new THREE.Raycaster();
    let chosen: { pos: V; offset: number } | null = null;
    const rejected: unknown[] = [];
    for (const offset of offsets) {
      const pos = centre.clone().add(side.clone().multiplyScalar(offset));
      pos.y = box.getCenter(new THREE.Vector3()).y + size.y * 0.15;
      if (positionId === "key_near_1m") pos.add(keyDirection.clone().multiplyScalar(1));
      const ndc = pos.clone().project(liveCamera);
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9 || ndc.z > 1) continue;
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
    const lights: unknown[] = [];
    scene.traverse((node) => {
      const color = (node as unknown as { color?: { getHexString?: () => string } }).color;
      const intensity = (node as unknown as { intensity?: unknown }).intensity;
      if (typeof intensity === "number" && color?.getHexString) lights.push({ type: node.type, intensity, color: `#${color.getHexString()}`, position: node.getWorldPosition(new THREE.Vector3()).toArray(), role: node.userData["openClinXrLightingRigRole"] ?? node.userData["openClinXrStationInteriorLightingRole"] ?? null });
    });
    return {
      box: { x0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.x)))), y0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.y)))), x1: Math.min(width, Math.ceil(Math.max(...px.map((p) => p.x)))), y1: Math.min(height, Math.ceil(Math.max(...px.map((p) => p.y)))) },
      worldTransform: { position: card.position.toArray(), quaternion: card.quaternion.toArray(), scale: card.scale.toArray(), matrix: card.matrixWorld.toArray(), lateralOffsetMeters: chosen.offset, cameraDistanceMeters: camPos.distanceTo(chosen.pos) },
      renderer: { toneMapping: liveRenderer.toneMapping, toneMappingExposure: liveRenderer.toneMappingExposure, outputColorSpace: liveRenderer.outputColorSpace },
      lights,
      environmentIntensity: scene.environmentIntensity ?? null,
      keyDirection: keyDirection.toArray(),
    };
  }, { input: lab, positionId: position, patientId: PATIENT_ID });
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
      await page.goto(appUrl(server!.url), { waitUntil: "networkidle", timeout: 180_000 });
      await page.waitForFunction((patientId) => {
        const scene = (globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (node: { userData?: Record<string, unknown> }) => void) => void } }).__openClinXrDebugScene;
        if (!scene) return false;
        let actor = false, key = false;
        scene.traverse((node) => { if (node.userData?.["openClinXrActorId"] === patientId) actor = true; if (node.userData?.["openClinXrLightingRigRole"] === "key") key = true; });
        return actor && key;
      }, PATIENT_ID, { timeout: 180_000 }).catch(async (error: unknown) => {
        const state = await page.evaluate(() => {
          const g = globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (node: { userData?: Record<string, unknown> }) => void) => void }; location: { href: string } };
          const actors = new Set<string>(); const roles = new Set<string>();
          g.__openClinXrDebugScene?.traverse((node) => {
            const actor = node.userData?.["openClinXrActorId"]; if (typeof actor === "string") actors.add(actor);
            const role = node.userData?.["openClinXrLightingRigRole"] ?? node.userData?.["openClinXrStationInteriorLightingRole"]; if (typeof role === "string") roles.add(role);
          });
          return { href: g.location.href, debugScene: Boolean(g.__openClinXrDebugScene), actors: [...actors], lightRoles: [...roles] };
        });
        throw new Error(`app scene never had patient ${PATIENT_ID} + a key-role light: ${JSON.stringify(state)} faults=${JSON.stringify(pageFaults.slice(0, 8))} (${String(error)})`);
      });
      const captures: Record<string, unknown> = {};
      for (const position of ["subject_depth", "key_near_1m"] as const) {
        const live = await placeCard(page, lab.greyCard!, position);
        const png = path.join(out, `${position}.png`);
        await page.locator("#station-canvas").screenshot({ path: png });
        const measured = cardMedianLab(png, live.box);
        captures[position] = { png: path.relative(cwd, png), ...live, ...measured };
      }
      const report = {
        schema: "openclinxr.st-skinref-s1c.app-room-grey-card.v1",
        command: command(),
        route: appUrl(server!.url),
        shippedPath: { app: "apps/ui-xr", scenarioId: SCENARIO_ID, stationId: STATION_ID, environmentId: ENVIRONMENT_ID, actorId: PATIENT_ID },
        card: { linearReflectance: 0.18, roughness: 1, metalness: 0, castShadow: false, receiveShadow: true, relativePlacementSource: "lab greyCard.worldTransform transformed by live patient root" },
        lab: { manifest: path.relative(cwd, labPath), sha256: createHash("sha256").update(labBytes).digest("hex"), png: path.relative(cwd, labPng), card: labCardMeasurement, renderer: lab.rendererReadback ?? null, lights: lab.lightsReadback ?? null, productRig: lab.productRigReadback ?? null },
        app: captures,
        decisionRule: "abs(lab card raw median L* - app subject_depth card raw median L*) <= 3 => lab reproduces app; otherwise lab is wrong and P1 stops",
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
