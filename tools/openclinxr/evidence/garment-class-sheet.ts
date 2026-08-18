/**
 * E1 slice 3 — THE PORTFOLIO GATE. Labelled contact sheet of every classed garment.
 *
 * One cell per UNIQUE garment the landed inventory classed (13), rendered from its own
 * `.obj`, labelled with the class the landed inventory assigned. The orchestrator grades
 * the pixels; this module only produces the sheet and the sidecar the contract reads.
 *
 * Load path (chosen): OBJ → GLB in Node via three.js OBJLoader + GLTFExporter, served
 * from `apps/ui-xr/public/garment-class-sheet/`, rendered through the isolated-subject
 * lab's existing `glb` subject kind, composed with `buildContactSheet` (#163).
 * REJECTED: editing the lab page to load raw .obj (product-code change; the `glb`
 * subject kind already exists and is proven), and a second compositor (buildContactSheet
 * is the proven one — D1).
 *
 * Labels are READ FROM `garment-class-inventory.json` (the landed E1 slice-1 artifact),
 * never re-derived here.
 *
 * claimScope: portfolio-gate evidence — garment silhouettes as classed by E1 slice 1.
 * notEvidenceFor: any class verdict being correct (pixel judgement — orchestrator grades),
 * fit/drape/coverage/poke-through/licence, hospital_gown existence, clinical validity.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from "../../../apps/ui-xr/node_modules/three/build/three.module.js";
import { OBJLoader } from "../../../apps/ui-xr/node_modules/three/examples/jsm/loaders/OBJLoader.js";
import { GLTFExporter } from "../../../apps/ui-xr/node_modules/three/examples/jsm/exporters/GLTFExporter.js";
import { buildContactSheet } from "./isolated-subject-harness.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * GLTFExporter's write path uses the browser FileReader API, absent in Node.
 * Minimal shim covering exactly the surface the exporter touches (readAsArrayBuffer,
 * readAsDataURL, onloadend, result). The GLB format writer stays three's GLTFExporter.
 */
function installFileReaderPolyfill(): void {
  if (typeof globalThis.FileReader === "function") return;
  class FileReaderShim {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }

    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString("base64")}`;
        this.onloadend?.();
      });
    }
  }
  (globalThis as unknown as { FileReader?: unknown }).FileReader = FileReaderShim;
}

installFileReaderPolyfill();

const INVENTORY = path.join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-inventory.json");
const SHEET = path.join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-sheet.png");
const SHEET_INDEX = path.join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-sheet.json");
const CELLS_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-416/cells");
/** Served by the ui-xr dev server at `/garment-class-sheet/<name>.glb`. */
const GLB_SERVE_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/garment-class-sheet");

/** One distinct hue per garment so the grade render shows distinct materials (§10y). */
const PALETTE = [
  0xe0524a, 0xd98f2e, 0xc9b53a, 0x58a04e, 0x3f9e9c,
  0x4a7fc4, 0x6a5cc4, 0x9a4fc0, 0xc2508a, 0x8a6f52,
  0x5f8a9f, 0x7a8f3f, 0xb07050,
] as const;

const RENDERER =
  "apps/ui-xr isolated-subject.html `glb` subject kind (three.js WebGLRenderer via ui-xr dev:portless); " +
  "OBJ->GLB by three.js OBJLoader+GLTFExporter (garment-class-sheet.ts); " +
  "composited by buildContactSheet from isolated-subject-harness.ts (Playwright HTML composite)";

type InvRow = { basename: string; class: string; sourcePath: string };

export type GarmentSheetCell = { basename: string; class: string; cell: number };

export type GarmentClassSheetIndex = {
  schemaVersion: "openclinxr.garment-class-sheet.v1";
  issue: "416";
  factoryStep: "instrument";
  measuredAt: string;
  renderer: string;
  sheet: string;
  cells: GarmentSheetCell[];
};

/** Unique by basename, first-occurrence order (the inventory carries duplicates under extracted/). */
function uniqueGarments(rows: InvRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.basename)) m.set(r.basename, r.class);
  return m;
}

/**
 * The single `.obj` for a basename: try each inventory row's dir in order until one
 * exists with an `.obj` (obj stems differ from mhclo stems; duplicates appear under
 * both `extracted/` and root paths, and only some dirs are present in a worktree).
 */
async function resolveObjPath(rows: InvRow[], basename: string): Promise<string> {
  for (const row of rows) {
    if (row.basename !== basename) continue;
    const dir = path.join(REPO_ROOT, path.dirname(row.sourcePath));
    let objs: string[];
    try {
      objs = (await readdir(dir)).filter((f) => f.endsWith(".obj"));
    } catch {
      continue; // directory absent in this worktree — try the next duplicate row
    }
    const stem = path.basename(row.sourcePath).replace(/\.mhclo$/, "");
    const exact = objs.find((f) => f === `${stem}.obj`);
    const chosen = exact ?? objs[0];
    if (chosen) return path.join(dir, chosen);
  }
  const rowsFor = rows.filter((r) => r.basename === basename).length;
  throw new Error(`garment-class-sheet: no .obj for ${basename} (checked ${rowsFor} row path(s))`);
}

/** OBJ -> binary GLB. Flat distinct material; normals computed (the .obj files carry none). */
async function objToGlb(objPath: string, color: number): Promise<ArrayBuffer> {
  const text = await readFile(objPath, "utf8");
  const root = new OBJLoader().parse(text);
  root.traverse((o) => {
    if (o instanceof Mesh) {
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = new MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
        side: DoubleSide,
      });
    }
  });
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  return exporter.parseAsync(root, { binary: true }) as Promise<ArrayBuffer>;
}

/** One cell render through the isolated-subject lab — mirrors the harness's captureSubject. */
async function captureCell(
  page: Page,
  baseUrl: string,
  spec: Record<string, unknown>,
  imagePath: string,
): Promise<void> {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  const url = `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const handle = await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
      };
      const ev = w.__openClinXrIsolatedSubjectEvidence;
      if (ev && typeof ev.meshCount === "number" && ev.meshCount > 0) {
        return { kind: "evidence" as const };
      }
      const app = document.querySelector<HTMLDivElement>("#app");
      const text = app?.textContent ?? "";
      if (text.includes("Isolated subject lab error")) {
        return { kind: "error" as const, text: text.slice(0, 2000) };
      }
      return null;
    },
    null,
    { timeout: 120_000 },
  );
  const settled = (await handle.jsonValue()) as
    | { kind: "evidence" }
    | { kind: "error"; text: string };
  if (settled.kind === "error") {
    throw new Error(`isolated subject lab refused the garment: ${settled.text}`);
  }
  await mkdir(path.dirname(imagePath), { recursive: true });
  await page.locator("#isolated-subject-capture-canvas").screenshot({ path: imagePath });
}

/**
 * Produce the sheet + sidecar: ONE dev-server boot, ONE browser, N garments.
 * Labels come from the landed inventory, never re-derived.
 *
 * All GLBs are converted and written BEFORE the dev server boots — Vite's
 * public-dir watcher full-reloads the page when a file lands mid-serve, which
 * raced the capture (observed: HTML fallback reached the GLTFLoader). Inputs
 * first, then serve, then render.
 */
export async function buildGarmentClassSheet(): Promise<{
  sheet: string;
  index: string;
  cells: GarmentSheetCell[];
}> {
  const inv = JSON.parse(await readFile(INVENTORY, "utf8")) as { rows: InvRow[] };
  const garments = uniqueGarments(inv.rows);
  await mkdir(GLB_SERVE_DIR, { recursive: true });
  await mkdir(CELLS_DIR, { recursive: true });

  let i = 0;
  for (const [basename] of garments) {
    const row = inv.rows.find((r) => r.basename === basename);
    if (!row) throw new Error(`garment-class-sheet: ${basename} missing from inventory rows`);
    const objPath = await resolveObjPath(inv.rows, basename);
    const stem = path.basename(basename, ".mhclo");
    const glb = await objToGlb(objPath, PALETTE[i % PALETTE.length]);
    await writeFile(path.join(GLB_SERVE_DIR, `${stem}.glb`), Buffer.from(glb));
    i += 1;
  }

  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd: REPO_ROOT,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });

    const cells: Array<{ imagePath: string; label: string }> = [];
    const sidecarCells: GarmentSheetCell[] = [];
    i = 0;
    for (const [basename, cls] of garments) {
      const stem = path.basename(basename, ".mhclo");
      const cellPng = path.join(CELLS_DIR, `${String(i).padStart(2, "0")}-${stem}.png`);
      const label = `${basename} [${cls}]`;
      await captureCell(
        page,
        server.url,
        {
          subjectId: `garment_${i}`,
          subjectKind: "glb",
          bodyGlb: `garment-class-sheet/${stem}.glb`,
          subjectOnly: true,
          label,
        },
        cellPng,
      );
      cells.push({ imagePath: cellPng, label });
      sidecarCells.push({ basename, class: cls, cell: i });
      i += 1;
    }

    await buildContactSheet({ page, cells, outPath: SHEET, columns: 4 });
    const index: GarmentClassSheetIndex = {
      schemaVersion: "openclinxr.garment-class-sheet.v1",
      issue: "416",
      factoryStep: "instrument",
      measuredAt: new Date().toISOString(),
      renderer: RENDERER,
      sheet: "garment-class-sheet.png",
      cells: sidecarCells,
    };
    await writeFile(SHEET_INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return { sheet: SHEET, index: SHEET_INDEX, cells: sidecarCells };
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildGarmentClassSheet()
    .then((r) => {
      console.log(`garment-class-sheet: wrote ${r.sheet} and ${r.index} (${r.cells.length} cells)`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
