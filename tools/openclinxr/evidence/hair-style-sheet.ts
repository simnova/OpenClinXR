/**
 * E7.2 — THE HAIR SHEET. Labelled contact sheet of every cached hair style.
 *
 * One cell per inventory row (27), rendered from the style's own `.obj`, labelled
 * with the fields the landed inventory records. The orchestrator grades the pixels;
 * this module only produces the sheet and the sidecar the contract reads.
 *
 * Load path (chosen, D1): OBJ -> GLB in Node via three.js OBJLoader + GLTFExporter,
 * served from `apps/ui-xr/public/hair-style-sheet/`, rendered through the
 * isolated-subject lab's existing `glb` subject kind, composed with
 * `buildContactSheet` (#163). Same path as `garment-class-sheet.ts`; no second
 * compositor, no new lab page, no Blender.
 *
 * Labels are READ FROM `hair-pack-licence-inventory.json` (the landed E7.1
 * artifact), never re-derived here. One measurement, one owner: the sheet quotes
 * the inventory so the page/header licence contradiction cannot be re-litigated
 * per consumer.
 *
 * Decisions (recorded for the E7.2 commit message):
 *   - Grid: 6 columns x 5 rows, cell 512x384 + 36px label band -> 3072x2100.
 *     6 styles per row keeps one row of labels legible; 512px keeps each hair
 *     silhouette readable in the composite.
 *   - Camera framing: the lab's legacy fit-to-bounds solve (`frameCamera` with no
 *     `view`: distance = max(bounds extent, 0.4) * 2.4, camera offset
 *     (0.55, 0.35, 0.85) * distance, lookAt bounds centre) — head-scale framing
 *     DERIVED from each hair mesh's own bounds, never a hardcoded position.
 *     `subjectOnly: true` (#265): flat dark background, no ground plane, one
 *     variable per cell.
 *   - Material: one distinct hue per cell (golden-angle HSL, deterministic) so a
 *     human can tell one style from another — the E1 sheet's distinct-material
 *     discipline (§10y). Not a hair-colour claim.
 *   - Oversized marker: the three styles the inventory refuses on topology
 *     (`fitsStrippedBasemesh: false`) get ` [OVERSIZED]` appended to their cell
 *     label and `oversized: true` in the sidecar — knowing what we are refusing
 *     is worth a cell, and the marker says which cells those are.
 *   - Content is luminance sd per cell (`regionLuminance`, #431), not bytes:
 *     blanks read sd 0.96-1.82 while real content reads 26.90+, so the known-good
 *     cell (mhair02) is checked by sd in the planted contract.
 *
 * claimScope: portfolio-gate evidence — hair silhouettes as inventoried by E7.1.
 * notEvidenceFor: any style verdict being correct (pixel judgement — orchestrator
 * grades), fit on an actor, licence column precedence (licence-provenance's call),
 * clinical validity, Quest readiness.
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
import { GLTFExporter } from "../../../apps/ui-xr/node_modules/three/examples/jsm/exporters/GLTFExporter.js";
import { OBJLoader } from "../../../apps/ui-xr/node_modules/three/examples/jsm/loaders/OBJLoader.js";
import { buildContactSheet } from "./isolated-subject-harness.js";
import { HELPER_STRIP_VERTEX } from "./lib/mhclo-topology.js";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const INVENTORY = path.join(REPO_ROOT, "tools/openclinxr/evidence/hair-pack-licence-inventory.json");
const SHEET = path.join(REPO_ROOT, "tools/openclinxr/evidence/hair-style-sheet.png");
const SIDECAR = path.join(REPO_ROOT, "tools/openclinxr/evidence/hair-style-sheet.json");
const CELLS_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-451/cells");
/** Served by the ui-xr dev server at `/hair-style-sheet/<name>.glb`. */
const GLB_SERVE_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/hair-style-sheet");

/** Grid: 6 columns x 5 rows. 27 cells -> 5 rows; 512x384 keeps silhouettes readable. */
const SHEET_COLUMNS = 6;
const SHEET_CELL_WIDTH = 512;
const SHEET_CELL_HEIGHT = 384;

const RENDERER =
  "apps/ui-xr isolated-subject.html `glb` subject kind (three.js WebGLRenderer via ui-xr dev:portless); " +
  "OBJ->GLB by three.js OBJLoader+GLTFExporter (hair-style-sheet.ts); " +
  "composited by buildContactSheet from isolated-subject-harness.ts (Playwright HTML composite)";

const FRAMING =
  "fit-to-bounds (lab legacy frameCamera solve): distance = max(bounds extent, 0.4 m) * 2.4; " +
  "camera offset (0.55, 0.35, 0.85) * distance; lookAt bounds centre; subjectOnly=true (#265)";

type HairInvRow = {
  style: string;
  sourcePath: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
  mappedToReference: string | null;
};

export type HairSheetCell = {
  style: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
  /** True for the three styles the inventory refuses on topology (>= 13,380). */
  oversized: boolean;
  cell: number;
  luminance: { mean: number; sd: number };
};

export type HairStyleSheetIndex = {
  schemaVersion: "openclinxr.hair-style-sheet.v1";
  issue: "451";
  factoryStep: "clothing_consume";
  measuredAt: string;
  renderer: string;
  framing: string;
  sheet: string;
  cells: HairSheetCell[];
};

/**
 * GLTFExporter's write path uses the browser FileReader API, absent in Node.
 * Minimal shim covering exactly the surface the exporter touches (readAsArrayBuffer,
 * readAsDataURL, onloadend, result). Same shim as garment-class-sheet.ts.
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

/**
 * The single `.obj` for a style: same dir as the inventory's `.mhclo`, same stem
 * first, else the dir's only `.obj` (MakeHuman obj stems differ from style names;
 * each style dir holds exactly one .obj).
 */
async function resolveObjPath(row: HairInvRow): Promise<string> {
  const dir = path.join(REPO_ROOT, path.dirname(row.sourcePath));
  const objs = (await readdir(dir)).filter((f) => f.endsWith(".obj"));
  const stem = path.basename(row.sourcePath).replace(/\.mhclo$/, "");
  const exact = objs.find((f) => f === `${stem}.obj`);
  const chosen = exact ?? objs[0];
  if (!chosen) {
    throw new Error(`hair-style-sheet: no .obj for ${row.style} in ${dir}`);
  }
  return path.join(dir, chosen);
}

/**
 * One distinct hue per cell, deterministic golden-angle spacing — the E1 sheet's
 * distinct-material discipline so the grade render shows 27 separable cells.
 */
function hairPaletteColor(index: number): number {
  const hue = (index * 137.508) % 360;
  const s = 0.78;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return (to255(rgb[0]) << 16) | (to255(rgb[1]) << 8) | to255(rgb[2]);
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
    throw new Error(`isolated subject lab refused the hair style: ${settled.text}`);
  }
  await mkdir(path.dirname(imagePath), { recursive: true });
  await page.locator("#isolated-subject-capture-canvas").screenshot({ path: imagePath });
}

/**
 * Produce the sheet + sidecar: ONE dev-server boot, ONE browser, N styles.
 * Labels come from the landed inventory, never re-derived.
 *
 * All GLBs are converted and written BEFORE the dev server boots — Vite's
 * public-dir watcher full-reloads the page when a file lands mid-serve, which
 * raced the capture (observed: HTML fallback reached the GLTFLoader).
 * Inputs first, then serve, then render.
 */
export async function buildHairStyleSheet(): Promise<{
  sheet: string;
  sidecar: string;
  cells: HairSheetCell[];
}> {
  const inv = JSON.parse(await readFile(INVENTORY, "utf8")) as { rows: HairInvRow[] };
  if (!Array.isArray(inv.rows) || inv.rows.length === 0) {
    throw new Error(`hair-style-sheet: ${INVENTORY} has no rows — E7.1 must land first`);
  }
  await mkdir(GLB_SERVE_DIR, { recursive: true });
  await mkdir(CELLS_DIR, { recursive: true });

  let i = 0;
  for (const row of inv.rows) {
    const objPath = await resolveObjPath(row);
    const glb = await objToGlb(objPath, hairPaletteColor(i));
    const stem = path.basename(objPath, ".obj");
    await writeFile(path.join(GLB_SERVE_DIR, `${String(i).padStart(2, "0")}-${stem}.glb`), Buffer.from(glb));
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
    const sidecarCells: HairSheetCell[] = [];
    i = 0;
    for (const row of inv.rows) {
      const objPath = await resolveObjPath(row);
      const stem = path.basename(objPath, ".obj");
      const cellPng = path.join(CELLS_DIR, `${String(i).padStart(2, "0")}-${row.style}.png`);
      const oversized = row.maxVertRef !== null && row.maxVertRef >= HELPER_STRIP_VERTEX;
      const label = `${row.style}${oversized ? " [OVERSIZED]" : ""}`;
      await captureCell(
        page,
        server.url,
        {
          subjectId: `hair_${i}`,
          subjectKind: "glb",
          bodyGlb: `hair-style-sheet/${String(i).padStart(2, "0")}-${stem}.glb`,
          subjectOnly: true,
          label,
        },
        cellPng,
      );
      const lum = regionLuminance(new Uint8Array(await readFile(cellPng)));
      if (!lum) {
        throw new Error(`hair-style-sheet: cell ${row.style} PNG is not an 8-bit non-interlaced PNG — cannot record luminance`);
      }
      cells.push({ imagePath: cellPng, label });
      sidecarCells.push({
        style: row.style,
        headerLicence: row.headerLicence,
        pageLicence: row.pageLicence,
        maxVertRef: row.maxVertRef,
        fitsStrippedBasemesh: row.fitsStrippedBasemesh,
        oversized,
        cell: i,
        luminance: {
          mean: Math.round(lum.mean * 100) / 100,
          sd: Math.round(lum.sd * 100) / 100,
        },
      });
      i += 1;
    }

    await buildContactSheet({
      page,
      cells,
      outPath: SHEET,
      columns: SHEET_COLUMNS,
      cellWidth: SHEET_CELL_WIDTH,
      cellHeight: SHEET_CELL_HEIGHT,
    });
    const index: HairStyleSheetIndex = {
      schemaVersion: "openclinxr.hair-style-sheet.v1",
      issue: "451",
      factoryStep: "clothing_consume",
      measuredAt: new Date().toISOString(),
      renderer: RENDERER,
      framing: FRAMING,
      sheet: "hair-style-sheet.png",
      cells: sidecarCells,
    };
    await writeFile(SIDECAR, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return { sheet: SHEET, sidecar: SIDECAR, cells: sidecarCells };
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildHairStyleSheet()
    .then((r) => {
      console.log(`hair-style-sheet: wrote ${r.sheet} and ${r.sidecar} (${r.cells.length} cells)`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
