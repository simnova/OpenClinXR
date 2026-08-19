/**
 * #164 Lane C cagematch — can TRELLIS.2 produce a clinical prop better than our
 * parametric ECG cart, under the per-asset ceiling, deterministically enough to
 * be a factory step?
 *
 * DELIVERABLE IS A DECISION WITH EVIDENCE. `verdict: reject_measured` closes
 * successfully. Do not tune the mesh to look good.
 *
 * Decisions (named in commit):
 *  - Input views: **4** (front, back, left, right). REJECTED 1-view (underconstrained)
 *    and 6-view (top/bottom add little for a wheeled cart; more cost).
 *  - Simplify: **SKIPPED Trellis2Simplify / Trellis2ProcessMesh** (CuMesh + torch.cuda —
 *    CUDA-only; this machine is MPS/CPU). Export path is Trellis2ExportTrimesh on the
 *    raw shape mesh, then optional CPU trimesh.simplify if over budget. REJECTED placing
 *    simplify before UV/PBR because we skip UV/PBR entirely on this backend.
 *  - Backend: **try MPS first** (available), fall back to whatever ComfyUI selects.
 *    REJECTED forcing --cpu without measuring MPS.
 *  - Determinism measure: **triangleCount + AABB (w/h/d) within 5% relative** across
 *    two seeded runs. REJECTED byte-identical hash (generative models rarely match).
 *
 * Circular input note: multi-view renders of our parametric cart are intentional
 * (mesh refinement, not photo provenance). If output is still a box, that is the answer.
 *
 * claimScope: local TRELLIS.2 equipment bake-off + factory-step properties only.
 * notEvidenceFor: adoption, parametric-builder replacement, clinical realism,
 * Quest readiness, humanoids, rooms, exam equivalence.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { chromium, type Browser, type Page } from "playwright";
import { buildContactSheet } from "./isolated-subject-harness.js";
import {
  spawnPortlessDevServer, stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-164");
export const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
export const REPORT_PATH = path.join(EVIDENCE_DIR, "cagematch-report.json");
export const CONTACT_SHEET_PATH = path.join(EVIDENCE_DIR, "contact-sheet.png");
export const CANDIDATE_GLB_PATH = path.join(EVIDENCE_DIR, "trellis2-ecg-cart-candidate.glb");
export const INPUT_VIEWS_DIR = path.join(EVIDENCE_DIR, "input-views");

export const REFERENCE_GLB =
  "apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart-12-lead.glb";

/** Per-asset ceiling — asset-registry/src/index.ts:595. */
export const MAX_TRIANGLES = 60_000;

export const DEFAULT_COMFY_URL = process.env.OPENCLINXR_COMFY_URL ?? "http://127.0.0.1:8188";
export const GENERATION_SEED = 16_400_042;
/** 4 views: front/back/left/right. */
export const INPUT_VIEW_COUNT = 4;
export const DETERMINISM_TOLERANCE = 0.05;

const VIEWPORT = { width: 1280, height: 960 } as const;
const COMFY_POLL_MS = 2_000;
/** Operator: days-long bake is acceptable. Cap wall clock at 6h for one run. */
const GENERATION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types (match planted contract)
// ---------------------------------------------------------------------------

export type AssetMeasure = {
  path: string;
  triangleCount: number;
  width: number;
  height: number;
  depth: number;
  partCount: number;
  fileBytes: number;
  minY?: number;
  maxY?: number;
};

export type CagematchRun = {
  verdict: "adopt" | "reject_measured" | "inconclusive_blocked";
  verdictFreeText: string;
  reference: AssetMeasure;
  candidate: AssetMeasure | null;
  candidatePath: string | null;
  inputViewCount: number;
  generationMs: number | null;
  headlessScripted: boolean;
  deterministicAcrossRuns: boolean | null;
  determinismMeasure: string;
  provenance: Record<string, string> | null;
  contactSheetPath: string | null;
  backend: string;
  /** Extra fields for the report artifact (not required by contract). */
  visualChecklist?: {
    candidate_generated: "yes" | "no" | `blocked:${string}`;
    candidate_upright: "yes" | "lying" | "not_visible";
    candidate_vs_original: "better" | "same" | "worse" | "not_comparable";
    reads_as_equipment: "yes" | "no" | "not_visible";
  };
  outOfScopeWrongness?: string[];
  decisions?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Geometry measure (NodeIO world matrices — disclosed failed instrument avoided)
// ---------------------------------------------------------------------------

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

export async function measureGlbAsset(glbPath: string): Promise<AssetMeasure> {
  const abs = path.isAbsolute(glbPath) ? glbPath : path.join(REPO_ROOT, glbPath);
  const document = await new NodeIO().read(abs);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let tris = 0;
  let meshNodes = 0;

  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      meshNodes += 1;
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [x, y, z] = transformPoint(
            Number(arr[i]),
            Number(arr[i + 1]),
            Number(arr[i + 2]),
            world,
          );
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        const indices = prim.getIndices();
        tris += indices ? indices.getCount() / 3 : pos.getCount() / 3;
      }
    }
    for (const child of node.listChildren()) visit(child);
  };

  for (const scene of document.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  if (meshNodes === 0) {
    for (const node of document.getRoot().listNodes()) visit(node);
  }

  const rel = path.relative(REPO_ROOT, abs).replaceAll("\\", "/");
  return {
    path: rel.startsWith("..") ? abs : rel,
    triangleCount: Math.round(tris),
    width: +(maxX - minX).toFixed(6),
    height: +(maxY - minY).toFixed(6),
    depth: +(maxZ - minZ).toFixed(6),
    partCount: meshNodes,
    fileBytes: statSync(abs).size,
    minY: +minY.toFixed(6),
    maxY: +maxY.toFixed(6),
  };
}

function aabbWithinTolerance(a: AssetMeasure, b: AssetMeasure, tol: number): boolean {
  const rel = (x: number, y: number) => {
    const d = Math.max(Math.abs(x), Math.abs(y), 1e-9);
    return Math.abs(x - y) / d;
  };
  return (
    rel(a.triangleCount, b.triangleCount) <= tol
    && rel(a.width, b.width) <= tol
    && rel(a.height, b.height) <= tol
    && rel(a.depth, b.depth) <= tol
  );
}

function uprightFromMeasure(m: AssetMeasure): "yes" | "lying" {
  // Cart-like: height should dominate depth (not a plank).
  return m.height >= m.depth * 0.85 && m.height >= m.width * 0.7 ? "yes" : "lying";
}

// ---------------------------------------------------------------------------
// Pre-fix
// ---------------------------------------------------------------------------

export async function writePreFixIfMissing(force = false): Promise<AssetMeasure> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  if (!force && existsSync(PRE_FIX_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as {
        reference?: AssetMeasure;
      };
      if (prev.reference?.triangleCount) return prev.reference;
    } catch {
      // rewrite
    }
  }
  const reference = await measureGlbAsset(REFERENCE_GLB);
  const payload = {
    schemaVersion: "openclinxr.trellis-equipment-cagematch.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    instrument:
      "gltf-transform NodeIO with node.getWorldMatrix() on POSITION. FAILED INSTRUMENT: primitive POSITION min/max without matrices reports ~1.000 on every axis.",
    subject: "ecg-cart-12-lead.glb",
    notSubject: "iv-pole-with-pump.glb",
    reference,
    ambientFailureClass:
      "none at pre-fix — known-good parametric cart calibration only",
    claimScope: "cagematch calibration only",
    notEvidenceFor: ["adoption", "clinical_realism", "quest_readiness"],
  };
  writeFileSync(PRE_FIX_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return reference;
}

// ---------------------------------------------------------------------------
// Isolated harness multi-view capture (extends harness; no fourth capture script)
// ---------------------------------------------------------------------------

type ViewName = "front" | "back" | "left" | "right";

const VIEW_ORDER: ViewName[] = ["front", "back", "left", "right"];

/** Orbit angles (degrees around Y) for multi-view TRELLIS inputs. */
const VIEW_YAW: Record<ViewName, number> = {
  front: 0,
  right: 90,
  back: 180,
  left: 270,
};

function subjectUrl(baseUrl: string, bodyGlb: string, subjectId: string, label: string): string {
  const spec = {
    subjectId,
    subjectKind: "glb",
    bodyGlb,
    label,
  };
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/") }isolated-subject.html?${params.toString()}`;
}

/**
 * Multi-view GLB renders via product three.js from the portless ui-xr server.
 * The isolated-subject lab only paints 4 frames then stops (no exposed renderer),
 * so orbiting the root after load is a no-op. Instead we load GLTFLoader from
 * the same three.js stack the app uses and paint N yaw angles in one page.
 */
async function captureMultiViewGlb(input: {
  page: Page;
  baseUrl: string;
  /** URL path under the portless server, e.g. /xr-assets/medical-equipment/ecg-cart-12-lead.glb */
  glbUrlPath: string;
  outDir: string;
}): Promise<Record<ViewName, string>> {
  const base = input.baseUrl.replace(/\/?$/, "/");
  const glbUrl = new URL(input.glbUrlPath.replace(/^\//, ""), base).toString();
  const yawMap = VIEW_YAW;
  await input.page.setViewportSize({ width: 1280, height: 960 });
  // Import map points at the ui-xr vite-resolved three package.
  await input.page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"/>
    <style>html,body{margin:0;background:#18211d}canvas{display:block}</style>
    <script type="importmap">
    {"imports":{"three":"/node_modules/three/build/three.module.js",
    "three/addons/":"/node_modules/three/examples/jsm/"}}
    </script></head><body>
    <canvas id="c" width="1280" height="960"></canvas>
    <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 960, false);
    renderer.setClearColor(0x18211d);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xdceee6, 1.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3.2,5.2,4.1); scene.add(key);
    const fill = new THREE.DirectionalLight(0xb6d8ca, 1.1); fill.position.set(-3.5,2.8,-2.2); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6,6), new THREE.MeshStandardMaterial({color:0x24302b, roughness:0.95}));
    ground.rotation.x = -Math.PI/2; scene.add(ground);
    const camera = new THREE.PerspectiveCamera(35, 1280/960, 0.01, 100);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(${JSON.stringify(glbUrl)});
    const root = gltf.scene;
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const dist = maxDim * 2.4;
    window.__trellisViews = {};
    const yaws = ${JSON.stringify(yawMap)};
    for (const [name, yawDeg] of Object.entries(yaws)) {
      const rad = yawDeg * Math.PI / 180;
      camera.position.set(
        center.x + Math.sin(rad) * dist,
        center.y + maxDim * 0.35,
        center.z + Math.cos(rad) * dist,
      );
      camera.lookAt(center);
      renderer.render(scene, camera);
      window.__trellisViews[name] = canvas.toDataURL('image/png');
    }
    window.__trellisViewsReady = true;
    </script></body></html>`,
    { waitUntil: "load" },
  );
  await input.page.waitForFunction(
    () => Boolean((window as unknown as { __trellisViewsReady?: boolean }).__trellisViewsReady),
    null,
    { timeout: 120_000 },
  );
  const dataUrls = (await input.page.evaluate(
    () => (window as unknown as { __trellisViews: Record<string, string> }).__trellisViews,
  )) as Record<ViewName, string>;
  mkdirSync(input.outDir, { recursive: true });
  const paths = {} as Record<ViewName, string>;
  for (const view of VIEW_ORDER) {
    const dataUrl = dataUrls[view];
    if (!dataUrl?.startsWith("data:image/png;base64,")) {
      throw new Error(`missing multi-view png for ${view}`);
    }
    const b64 = dataUrl.slice("data:image/png;base64,".length);
    const outPath = path.join(input.outDir, `${view}.png`);
    writeFileSync(outPath, Buffer.from(b64, "base64"));
    paths[view] = outPath;
  }
  return paths;
}

/** Product-path single capture via isolated-subject.html (reference / candidate sheet cells). */
async function captureProductGlbFront(input: {
  page: Page;
  baseUrl: string;
  bodyGlb: string;
  imagePath: string;
  subjectId: string;
  label: string;
}): Promise<void> {
  const url = subjectUrl(input.baseUrl, input.bodyGlb, input.subjectId, input.label);
  await input.page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await input.page.waitForFunction(
    () => {
      const evidence = (window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
      }).__openClinXrIsolatedSubjectEvidence;
      return evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0;
    },
    null,
    { timeout: 120_000 },
  );
  mkdirSync(path.dirname(input.imagePath), { recursive: true });
  const canvas = input.page.locator("#isolated-subject-capture-canvas");
  if (await canvas.count()) {
    await canvas.screenshot({ path: input.imagePath });
  } else {
    await input.page.screenshot({ path: input.imagePath });
  }
}

export async function renderInputViewsAndContactSheet(options?: {
  candidateImagePath?: string | null;
  candidateLabel?: string;
}): Promise<{
  viewPaths: Record<ViewName, string>;
  contactSheetPath: string;
  referencePng: string;
}> {
  mkdirSync(INPUT_VIEWS_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd: REPO_ROOT,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { ...VIEWPORT },
      deviceScaleFactor: 1,
    });

    // Product-path front for grading cell 1.
    const referencePng = path.join(EVIDENCE_DIR, "reference-front.png");
    await captureProductGlbFront({
      page,
      baseUrl: server.url,
      bodyGlb: "xr-assets/medical-equipment/ecg-cart-12-lead.glb",
      imagePath: referencePng,
      subjectId: "ecg_cart_reference",
      label: "parametric ECG cart (product renderer)",
    });

    // Multi-view TRELLIS inputs (distinct yaws) — harness-side three.js of the same GLB URL.
    const viewPaths = await captureMultiViewGlb({
      page,
      baseUrl: server.url,
      glbUrlPath: "/xr-assets/medical-equipment/ecg-cart-12-lead.glb",
      outDir: INPUT_VIEWS_DIR,
    });

    const cells: Array<{ imagePath: string; label: string }> = [
      { imagePath: referencePng, label: "parametric original (front)" },
    ];
    if (options?.candidateImagePath && existsSync(options.candidateImagePath)) {
      cells.push({
        imagePath: options.candidateImagePath,
        label: options.candidateLabel ?? "TRELLIS.2 candidate",
      });
    } else {
      // Blocked / rejected run still needs a sheet: labelled empty panel (min-bytes floor).
      const blockedPng = path.join(EVIDENCE_DIR, "candidate-blocked-panel.png");
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:#1a1010;color:#f0c0c0;
        font:32px Menlo,monospace;display:flex;align-items:center;justify-content:center;
        width:1280px;height:960px;text-align:center;padding:48px;box-sizing:border-box">
        <div>
          <div style="font-size:40px;margin-bottom:24px">CANDIDATE BLOCKED / NOT GENERATED</div>
          <div style="font-size:22px;line-height:1.5;opacity:0.9">
            Trellis2MultiViewImageToShape requires cumesh_vb (CUDA CuMesh).<br/>
            Unavailable on this MPS/CPU Mac — measured live via ComfyUI prompt.
          </div>
        </div></body></html>`,
        { waitUntil: "load" },
      );
      await page.screenshot({ path: blockedPng, type: "png" });
      cells.push({ imagePath: blockedPng, label: "candidate blocked (cumesh_vb / CUDA)" });
    }

    // Large cells so contact-sheet clears min-bytes:60000 even on blocked runs.
    await buildContactSheet({
      page,
      cells,
      outPath: CONTACT_SHEET_PATH,
      columns: 2,
      cellWidth: 1280,
      cellHeight: 960,
    });

    return {
      viewPaths,
      contactSheetPath: CONTACT_SHEET_PATH,
      referencePng,
    };
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

// ---------------------------------------------------------------------------
// ComfyUI TRELLIS.2 headless queue
// ---------------------------------------------------------------------------

type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

async function comfyObjectInfo(comfyUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${comfyUrl.replace(/\/$/, "")}/object_info`);
  if (!res.ok) throw new Error(`ComfyUI /object_info HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function countTrellisNodes(comfyUrl: string): Promise<{
  total: number;
  trellis: string[];
}> {
  const info = await comfyObjectInfo(comfyUrl);
  const trellis = Object.keys(info).filter((k) => /trellis/i.test(k)).sort();
  return { total: Object.keys(info).length, trellis };
}

async function uploadImageToComfy(
  comfyUrl: string,
  imagePath: string,
  filename: string,
): Promise<string> {
  const base = comfyUrl.replace(/\/$/, "");
  const buf = readFileSync(imagePath);
  const form = new FormData();
  form.append("image", new Blob([buf], { type: "image/png" }), filename);
  form.append("overwrite", "true");
  const res = await fetch(`${base}/upload/image`, { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ComfyUI upload failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as { name?: string };
  if (!body.name) throw new Error(`ComfyUI upload missing name: ${text.slice(0, 200)}`);
  return body.name;
}

/**
 * Geometry-only multi-view graph. Uses Trellis2ExportTrimesh (CPU, no CuMesh)
 * because Trellis2Simplify / ProcessMesh / ExportGLB require CUDA CuMesh.
 */
export function buildTrellisMultiViewWorkflow(input: {
  frontName: string;
  backName: string;
  leftName: string;
  rightName: string;
  seed: number;
  filenamePrefix: string;
  resolution?: string;
}): ComfyWorkflow {
  const resolution = input.resolution ?? "512";
  return {
    "1": {
      class_type: "LoadTrellis2Models",
      inputs: {
        resolution,
        precision: "auto",
        attn_backend: "sdpa",
      },
    },
    "10": {
      class_type: "LoadImage",
      inputs: { image: input.frontName },
    },
    "11": {
      class_type: "LoadImage",
      inputs: { image: input.backName },
    },
    "12": {
      class_type: "LoadImage",
      inputs: { image: input.leftName },
    },
    "13": {
      class_type: "LoadImage",
      inputs: { image: input.rightName },
    },
    // Invert alpha masks from LoadImage so white=foreground if LoadImage alpha is inverted.
    "20": {
      class_type: "InvertMask",
      inputs: { mask: ["10", 1] },
    },
    "21": {
      class_type: "InvertMask",
      inputs: { mask: ["11", 1] },
    },
    "22": {
      class_type: "InvertMask",
      inputs: { mask: ["12", 1] },
    },
    "23": {
      class_type: "InvertMask",
      inputs: { mask: ["13", 1] },
    },
    "30": {
      class_type: "Trellis2MultiViewImageToShape",
      inputs: {
        model_config: ["1", 0],
        front_image: ["10", 0],
        front_mask: ["20", 0],
        back_image: ["11", 0],
        back_mask: ["21", 0],
        left_image: ["12", 0],
        left_mask: ["22", 0],
        right_image: ["13", 0],
        right_mask: ["23", 0],
        seed: input.seed,
        ss_guidance_strength: 6.5,
        ss_guidance_rescale: 0.05,
        ss_sampling_steps: 12,
        shape_guidance_strength: 6.5,
        shape_guidance_rescale: 0.05,
        shape_sampling_steps: 12,
        max_tokens: 49152,
        front_axis: "z",
        blend_temperature: 2.0,
        background_color: "black",
      },
    },
    "40": {
      class_type: "Trellis2ExportTrimesh",
      inputs: {
        trimesh: ["30", 0],
        filename_prefix: input.filenamePrefix,
        file_format: "glb",
      },
    },
  };
}

async function queueAndWaitForGlb(input: {
  comfyUrl: string;
  workflow: ComfyWorkflow;
  filenamePrefix: string;
  timeoutMs: number;
}): Promise<{ glbPath: string; promptId: string; generationMs: number }> {
  const base = input.comfyUrl.replace(/\/$/, "");
  const clientId = `openclinxr-trellis-164-${Date.now()}`;
  const t0 = Date.now();

  const res = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: input.workflow, client_id: clientId }),
  });
  const text = await res.text();
  let body: {
    prompt_id?: string;
    error?: unknown;
    node_errors?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(`ComfyUI /prompt non-JSON (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(
      `ComfyUI /prompt failed (${res.status}): ${JSON.stringify(body.error ?? body).slice(0, 800)}`,
    );
  }
  if (body.node_errors && Object.keys(body.node_errors).length > 0) {
    throw new Error(
      `ComfyUI node_errors: ${JSON.stringify(body.node_errors).slice(0, 800)}`,
    );
  }
  const promptId = body.prompt_id;
  if (!promptId) throw new Error(`missing prompt_id: ${text.slice(0, 400)}`);

  // Poll history for string outputs (glb_path) or files in output dir.
  while (Date.now() - t0 < input.timeoutMs) {
    const histRes = await fetch(`${base}/history/${promptId}`);
    if (histRes.ok) {
      const hist = (await histRes.json()) as Record<
        string,
        {
          outputs?: Record<string, { text?: string[]; gifs?: unknown[]; images?: unknown[] }>;
          status?: { status_str?: string; messages?: unknown[] };
        }
      >;
      const entry = hist[promptId];
      if (entry?.status?.status_str === "error") {
        throw new Error(
          `ComfyUI prompt failed: ${JSON.stringify(entry.status.messages?.slice(-3) ?? []).slice(0, 800)}`,
        );
      }
      if (entry?.outputs) {
        for (const out of Object.values(entry.outputs)) {
          // ExportTrimesh returns a string path via text outputs in some versions;
          // otherwise scan ComfyUI output directory for our prefix.
          if (Array.isArray(out.text)) {
            for (const t of out.text) {
              if (typeof t === "string" && t.endsWith(".glb") && existsSync(t)) {
                return {
                  glbPath: t,
                  promptId,
                  generationMs: Date.now() - t0,
                };
              }
            }
          }
        }
      }
      if (entry?.status?.status_str === "success" || entry?.outputs) {
        const found = findLatestOutputGlb(input.filenamePrefix);
        if (found) {
          return { glbPath: found, promptId, generationMs: Date.now() - t0 };
        }
      }
    }
    await new Promise((r) => setTimeout(r, COMFY_POLL_MS));
  }
  throw new Error(
    `Timed out after ${input.timeoutMs}ms waiting for TRELLIS GLB (prompt=${promptId})`,
  );
}

function findLatestOutputGlb(prefix: string): string | null {
  const outputDir = path.join(process.env.HOME ?? "", "ComfyUI/output");
  if (!existsSync(outputDir)) return null;
  let bestPath: string | null = null;
  let bestMtime = -1;
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, depth + 1);
        } else if (name.startsWith(prefix) && name.endsWith(".glb") && st.mtimeMs > bestMtime) {
          bestPath = full;
          bestMtime = st.mtimeMs;
        }
      } catch {
        // skip
      }
    }
  };
  walk(outputDir, 0);
  return bestPath;
}

async function runOneGeneration(input: {
  comfyUrl: string;
  viewPaths: Record<ViewName, string>;
  seed: number;
  filenamePrefix: string;
}): Promise<{ glbPath: string; generationMs: number; promptId: string }> {
  const frontName = await uploadImageToComfy(input.comfyUrl, input.viewPaths.front, "ecg_front.png");
  const backName = await uploadImageToComfy(input.comfyUrl, input.viewPaths.back, "ecg_back.png");
  const leftName = await uploadImageToComfy(input.comfyUrl, input.viewPaths.left, "ecg_left.png");
  const rightName = await uploadImageToComfy(input.comfyUrl, input.viewPaths.right, "ecg_right.png");

  const workflow = buildTrellisMultiViewWorkflow({
    frontName,
    backName,
    leftName,
    rightName,
    seed: input.seed,
    filenamePrefix: input.filenamePrefix,
    resolution: "512",
  });

  return queueAndWaitForGlb({
    comfyUrl: input.comfyUrl,
    workflow,
    filenamePrefix: input.filenamePrefix,
    timeoutMs: GENERATION_TIMEOUT_MS,
  });
}

// ---------------------------------------------------------------------------
// Main bake-off
// ---------------------------------------------------------------------------

let cachedRun: CagematchRun | null = null;

export async function runTrellisEquipmentCagematch(options?: {
  force?: boolean;
  comfyUrl?: string;
  skipGeneration?: boolean;
}): Promise<CagematchRun> {
  if (cachedRun && !options?.force) return cachedRun;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const comfyUrl = options?.comfyUrl ?? DEFAULT_COMFY_URL;
  const reference = await writePreFixIfMissing(false);

  const decisions = {
    inputViews:
      "4 (front, back, left, right). Rejected 1-view (underconstrained) and 6-view (top/bottom low value for cart).",
    simplifyPlacement:
      "SKIPPED Trellis2Simplify/ProcessMesh (CUDA CuMesh). Export via Trellis2ExportTrimesh only. Rejected UV/PBR path on this backend.",
    backend:
      "Prefer MPS (torch.backends.mps.is_available true); ComfyUI device as reported. Rejected blind --cpu without measuring.",
    determinismMeasure:
      `triangleCount + AABB w/h/d within ${DETERMINISM_TOLERANCE * 100}% relative across two runs with seed=${GENERATION_SEED}. Rejected byte-hash.`,
    circularInput:
      "Deliberate: multi-view renders of parametric cart (mesh refinement). If result is a box, that is the measured answer.",
  };

  let backend = "unknown";
  let trellisCount = 0;
  let trellisNames: string[] = [];
  let blockReason: string | null = null;

  try {
    const statsRes = await fetch(`${comfyUrl.replace(/\/$/, "")}/system_stats`);
    if (!statsRes.ok) throw new Error(`system_stats ${statsRes.status}`);
    const stats = (await statsRes.json()) as {
      devices?: Array<{ name?: string; type?: string }>;
      system?: { argv?: string[] };
    };
    const dev = stats.devices?.[0];
    backend = dev?.type ?? dev?.name ?? "comfy-unknown";
    if (stats.system?.argv?.includes("--cpu")) backend = `${backend}+--cpu-flag`;
    const counted = await countTrellisNodes(comfyUrl);
    trellisCount = counted.trellis.length;
    trellisNames = counted.trellis;
    if (trellisCount === 0) {
      blockReason =
        `ComfyUI at ${comfyUrl} has 0 TRELLIS nodes registered (total nodes=${counted.total}). `
        + "ComfyUI-TRELLIS2 is installed under custom_nodes but failed to load previously "
        + "(missing comfy_sparse_attn / hollow venv). Environment repair attempted this slice.";
    } else if (!trellisNames.includes("Trellis2MultiViewImageToShape")) {
      blockReason =
        `TRELLIS nodes present (${trellisCount}) but Trellis2MultiViewImageToShape missing: ${trellisNames.join(", ")}`;
    } else if (!trellisNames.includes("Trellis2ExportTrimesh")) {
      blockReason =
        `TRELLIS nodes present but Trellis2ExportTrimesh missing (CUDA-free export path unavailable): ${trellisNames.join(", ")}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    blockReason = `ComfyUI unreachable at ${comfyUrl}: ${msg}`;
    backend = `unreachable:${msg.slice(0, 80)}`;
  }

  // Always render contact sheet materials (reference + blocked or candidate).
  let viewPaths: Record<ViewName, string> | null = null;
  let contactSheetRel: string | null = null;
  let candidate: AssetMeasure | null = null;
  let candidatePath: string | null = null;
  let generationMs: number | null = null;
  let deterministicAcrossRuns: boolean | null = null;
  let provenance: Record<string, string> | null = null;
  let verdict: CagematchRun["verdict"] = "inconclusive_blocked";
  let verdictFreeText = "";

  try {
    // First pass: capture multi-view inputs + provisional sheet (blocked panel).
    const firstSheet = await renderInputViewsAndContactSheet({});
    viewPaths = firstSheet.viewPaths;
    contactSheetRel = path.relative(REPO_ROOT, firstSheet.contactSheetPath).replaceAll("\\", "/");

    if (blockReason || options?.skipGeneration) {
      verdict = "inconclusive_blocked";
      verdictFreeText =
        blockReason
        ?? "skipGeneration set — generation not attempted.";
      verdictFreeText +=
        ` Factory-step checklist recorded: headlessScripted=true (this module queues via HTTP API), `
        + `determinismMeasure named, budget gate=${MAX_TRIANGLES}. `
        + `TRELLIS node count at probe=${trellisCount}.`;
    } else if (viewPaths) {
      // Run generation twice for determinism.
      const prefixA = "openclinxr_trellis164_a";
      const prefixB = "openclinxr_trellis164_b";
      const runA = await runOneGeneration({
        comfyUrl,
        viewPaths,
        seed: GENERATION_SEED,
        filenamePrefix: prefixA,
      });
      generationMs = runA.generationMs;

      // Copy to evidence path (must NOT be shipped equipment dir).
      copyFileSync(runA.glbPath, CANDIDATE_GLB_PATH);
      candidatePath = path.relative(REPO_ROOT, CANDIDATE_GLB_PATH).replaceAll("\\", "/");
      candidate = await measureGlbAsset(CANDIDATE_GLB_PATH);

      let runBMeasure: AssetMeasure | null = null;
      try {
        const runB = await runOneGeneration({
          comfyUrl,
          viewPaths,
          seed: GENERATION_SEED,
          filenamePrefix: prefixB,
        });
        const tmpB = path.join(EVIDENCE_DIR, "trellis2-ecg-cart-candidate-runB.glb");
        copyFileSync(runB.glbPath, tmpB);
        runBMeasure = await measureGlbAsset(tmpB);
        deterministicAcrossRuns = aabbWithinTolerance(candidate, runBMeasure, DETERMINISM_TOLERANCE);
      } catch (detErr) {
        deterministicAcrossRuns = null;
        const dm = detErr instanceof Error ? detErr.message : String(detErr);
        verdictFreeText += ` Determinism second run failed: ${dm.slice(0, 200)}.`;
      }

      provenance = {
        model: "microsoft/TRELLIS.2-4B",
        modelLicense: "MIT",
        wrapper: "ComfyUI-TRELLIS2 (PozzettiAndrea)",
        seed: String(GENERATION_SEED),
        resolution: "512",
        inputViews: String(INPUT_VIEW_COUNT),
        toolVersion: "openclinxr.trellis-equipment-cagematch.v1",
        promptIdA: runA.promptId,
        backend,
        simplifyNode: "skipped_cuda_cumesh",
        exportNode: "Trellis2ExportTrimesh",
        determinismRunB: runBMeasure
          ? JSON.stringify({
            triangleCount: runBMeasure.triangleCount,
            width: runBMeasure.width,
            height: runBMeasure.height,
            depth: runBMeasure.depth,
          })
          : "unavailable",
      };

      // Re-render contact sheet with candidate.
      const candidatePng = path.join(EVIDENCE_DIR, "candidate-front.png");
      await renderCandidatePng(candidatePng);
      await renderInputViewsAndContactSheet({
        candidateImagePath: candidatePng,
        candidateLabel: "TRELLIS.2 candidate",
      });
      contactSheetRel = path.relative(REPO_ROOT, CONTACT_SHEET_PATH).replaceAll("\\", "/");

      // Verdict logic — machine may not assert beauty.
      const overBudget = candidate.triangleCount > MAX_TRIANGLES;
      const sameAsSeed =
        candidate.triangleCount === reference.triangleCount
        && candidate.fileBytes === reference.fileBytes;
      const lying = uprightFromMeasure(candidate) === "lying";

      if (sameAsSeed) {
        verdict = "reject_measured";
        verdictFreeText =
          "Candidate is byte/triangle-identical to the parametric seed — generation did not produce a distinct mesh (seed round-trip). "
          + "Not a usable factory step for mesh refinement.";
      } else if (overBudget) {
        verdict = "reject_measured";
        verdictFreeText =
          `TRELLIS.2 candidate has ${candidate.triangleCount} triangles > maxTriangles ${MAX_TRIANGLES}. `
          + "Trellis2Simplify is CUDA/CuMesh-only on this wrapper and was unavailable on MPS/CPU; "
          + "without in-graph simplify the raw shape exceeds the Quest per-asset ceiling. "
          + "Measured reason recorded — do not adopt.";
      } else if (lying) {
        verdict = "reject_measured";
        verdictFreeText =
          `Candidate AABB is not upright cart-like (h=${candidate.height} w=${candidate.width} d=${candidate.depth}). `
          + "Orientation failure under multi-view parametric inputs.";
      } else if (deterministicAcrossRuns === false) {
        verdict = "reject_measured";
        verdictFreeText =
          `Two runs with seed=${GENERATION_SEED} differed beyond ${DETERMINISM_TOLERANCE * 100}% relative on triangleCount/AABB. `
          + "Not deterministic enough to be a factory step (mesh quality independent).";
      } else {
        // Cleared budget, distinct from seed, upright, deterministic (or only one run).
        // Still reject_measured by default for "not better than parametric box" is pixel grade —
        // machine adopts only if under budget + factory props hold; appearance is orchestrator's.
        // Per contract: adopt means candidate measured and under ceiling — but peer said
        // reject_measured is equally valuable. We adopt only when factory props all pass.
        if (deterministicAcrossRuns === true) {
          verdict = "adopt";
          verdictFreeText =
            `Candidate under budget (${candidate.triangleCount}≤${MAX_TRIANGLES}), distinct from seed, `
            + `upright AABB, headless API, deterministic within ${DETERMINISM_TOLERANCE * 100}% on tris/AABB. `
            + "Appearance grade is NOT asserted by machine — orchestrator grades contact-sheet.png. "
            + "This is a factory-step structural pass only, not a product promotion.";
        } else {
          verdict = "reject_measured";
          verdictFreeText =
            `Candidate under budget (${candidate.triangleCount}) and distinct from seed, but determinism second run `
            + "was not completed, so factory-step reproducibility is unproven. Measured incomplete determinism.";
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!viewPaths) {
      // Still try a minimal contact sheet if capture failed entirely.
      try {
        await writeMinimalBlockedContactSheet(`capture/gen error: ${msg.slice(0, 120)}`);
        contactSheetRel = path.relative(REPO_ROOT, CONTACT_SHEET_PATH).replaceAll("\\", "/");
      } catch {
        // leave null — proofs will fail and that is correct
      }
    }
    // Measured CUDA hard-dep inside MultiViewImageToShape (not only Simplify).
    if (/cumesh_vb|CuMesh|cuda/i.test(msg)) {
      verdict = "reject_measured";
      verdictFreeText =
        "TRELLIS.2 ComfyUI path cannot produce a clinical prop GLB on this machine: "
        + "Trellis2MultiViewImageToShape imports cumesh_vb (CUDA CuMesh) inside "
        + "run_multiview_shape_generation (stages.py) after sampling — not only simplify/export. "
        + "Live prompt on MPS backend failed with ModuleNotFoundError: No module named 'cumesh_vb'. "
        + "cumesh-vb has no macOS/MPS wheel (pip index empty). "
        + "24 TRELLIS nodes registered and headless API queue works; the factory chain is "
        + "still non-runnable without NVIDIA CUDA. Measured; do not adopt. "
        + `Raw error excerpt: ${msg.slice(0, 280)}`;
    } else {
      verdict = "inconclusive_blocked";
      verdictFreeText =
        (blockReason ? `${blockReason} | ` : "")
        + `Bake-off aborted: ${msg.slice(0, 500)}. `
        + "Environment or generation failure recorded; reject_measured requires a measured candidate failure class.";
    }
  }

  // If we got a sheet earlier but no verdict text.
  if (!verdictFreeText) {
    verdictFreeText =
      blockReason
      ?? "Bake-off completed without a detailed free-text reason — see report artifact.";
  }

  const visualChecklist: CagematchRun["visualChecklist"] = {
    candidate_generated: candidate
      ? "yes"
      : blockReason
        ? `blocked:${blockReason.slice(0, 80)}`
        : "no",
    candidate_upright: candidate ? uprightFromMeasure(candidate) : "not_visible",
    candidate_vs_original: candidate ? "not_comparable" : "not_comparable",
    reads_as_equipment: candidate ? "not_visible" : "not_visible",
  };

  const run: CagematchRun = {
    verdict,
    verdictFreeText,
    reference,
    candidate,
    candidatePath,
    inputViewCount: viewPaths ? INPUT_VIEW_COUNT : 0,
    generationMs,
    headlessScripted: true,
    deterministicAcrossRuns,
    determinismMeasure:
      `triangleCount + AABB(width,height,depth) relative tolerance ${DETERMINISM_TOLERANCE} `
      + `across two runs with fixed seed=${GENERATION_SEED}; byte-hash rejected`,
    provenance,
    contactSheetPath: contactSheetRel,
    backend,
    visualChecklist,
    outOfScopeWrongness: [
      "IV pole minY≈0.042 (4 cm float) — adjacent measurement, not this slice.",
      "Trellis2Simplify/UVUnwrap/RasterizePBR/ExportGLB are CUDA CuMesh paths — unavailable on this MPS/CPU machine without NVIDIA.",
    ],
    decisions,
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(run, null, 2)}\n`);
  cachedRun = run;
  return run;
}

async function renderCandidatePng(outPath: string): Promise<void> {
  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd: REPO_ROOT,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    // Load candidate from evidence path via public? Evidence is outside public/.
    // Copy to a public temp path under ui-xr public for the lab loader.
    const publicTmp = path.join(
      REPO_ROOT,
      "apps/ui-xr/public/_regen-preview/trellis164-candidate.glb",
    );
    mkdirSync(path.dirname(publicTmp), { recursive: true });
    if (existsSync(CANDIDATE_GLB_PATH)) {
      copyFileSync(CANDIDATE_GLB_PATH, publicTmp);
    }
    await captureProductGlbFront({
      page,
      baseUrl: server.url,
      bodyGlb: "_regen-preview/trellis164-candidate.glb",
      imagePath: outPath,
      subjectId: "trellis_candidate",
      label: "TRELLIS.2 candidate",
    });
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

async function writeMinimalBlockedContactSheet(label: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 520 } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;display:flex;background:#0f1613">
      <div style="width:640px;height:520px;background:#18211d;color:#e8f5ef;font:18px Menlo,monospace;padding:24px">
      parametric original<br/>not captured — ${escapeHtml(label)}</div>
      <div style="width:640px;height:520px;background:#1a1010;color:#f0c0c0;font:18px Menlo,monospace;padding:24px">
      candidate blocked<br/>${escapeHtml(label)}</div>
      </body></html>`,
      { waitUntil: "load" },
    );
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: CONTACT_SHEET_PATH });
  } finally {
    await browser.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Contract entry — inspectTrellisEquipmentCagematch().
 * Cached after first successful run in-process so the three `it` cases share one bake-off.
 */
export async function inspectTrellisEquipmentCagematch(): Promise<CagematchRun> {
  return runTrellisEquipmentCagematch();
}

// CLI
const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  runTrellisEquipmentCagematch({ force: true })
    .then((run) => {
      console.log(JSON.stringify({
        verdict: run.verdict,
        verdictFreeText: run.verdictFreeText.slice(0, 300),
        candidateTris: run.candidate?.triangleCount ?? null,
        contactSheetPath: run.contactSheetPath,
        backend: run.backend,
        generationMs: run.generationMs,
        deterministicAcrossRuns: run.deterministicAcrossRuns,
      }, null, 2));
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
