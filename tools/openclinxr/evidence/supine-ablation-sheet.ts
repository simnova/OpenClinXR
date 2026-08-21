/**
 * #495 — the ablation sheet. Three cells, one gowned MPFB body, isolated lab.
 *
 * Renders the pose's two mechanisms separately so the NEXT fix is aimed at a located
 * cause instead of a fifth guess (four landings on #492 failed to make the patient a
 * person). Cells:
 *
 *   standing   subjectKind "glb"               — no supine call at all
 *   root_only  subjectKind "runtime_posture"   — root basis, applyJointEulers=false
 *   full       subjectKind "runtime_posture"   — today's behaviour (root + 17 eulers)
 *
 * Deliverables (both TRACKED — `.openclinxr/evidence/**` is gitignored, #396):
 *   tools/openclinxr/evidence/stills/supine-ablation-sheet.png
 *   tools/openclinxr/evidence/supine-ablation-report.json
 *
 * claimScope: a gradeable three-cell ablation sheet rendered from the product
 * three.js path (isolated-subject-lab driving applySupinePose).
 * notEvidenceFor: any cause — deliberately. The sheet tells us which mechanism to
 * re-author, not that it works.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import {
  spawnPortlessDevServer, stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";
import { buildContactSheet } from "./isolated-subject-harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET_PATH = join(HERE, "stills", "supine-ablation-sheet.png");
const REPORT_PATH = join(HERE, "supine-ablation-report.json");
const CELLS_DIR = join(HERE, "../../../.openclinxr/evidence/supine-ablation-cells");

const BODY_GLB = "generated-humanoids/mpfb-gown-adult-patient.glb";

type Cell = "standing" | "root_only" | "full";

type LabDump = {
  bodyGlb: string;
  ranSupineCall?: boolean;
  appliedJointEulers?: boolean;
  posedMeshAabb?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

type SubjectAabb = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

type Report = {
  schemaVersion: string;
  bodyGlb: string;
  renderer: string;
  cells: {
    cell: Cell;
    ranSupineCall: boolean;
    appliedJointEulers: boolean;
    posedMeshAabb: { min: { y: number }; max: { y: number } };
  }[];
};

function subjectUrl(baseUrl: string, spec: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

const cellSpec = (cell: Cell): Record<string, unknown> => {
  if (cell === "standing") {
    return {
      subjectId: "standing",
      subjectKind: "glb",
      bodyGlb: BODY_GLB,
      label: "standing (no supine call)",
    };
  }
  return {
    subjectId: cell,
    subjectKind: "runtime_posture",
    posture: "supine",
    bodyGlb: BODY_GLB,
    ...(cell === "root_only" ? { supineRootOnly: true } : {}),
    label: cell === "root_only" ? "root_only (root basis, no joint eulers)" : "full (root + 17 eulers)",
  };
};

async function captureCell(
  page: Page,
  baseUrl: string,
  cell: Cell,
): Promise<{ ranSupineCall: boolean; appliedJointEulers: boolean; aabb: SubjectAabb }> {
  const url = subjectUrl(baseUrl, cellSpec(cell));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
        __openClinXrSubjectAabb?: SubjectAabb;
      };
      if ((w.__openClinXrIsolatedSubjectEvidence?.meshCount ?? 0) > 0 && w.__openClinXrSubjectAabb) {
        return true;
      }
      const app = document.querySelector<HTMLDivElement>("#app");
      const text = app?.textContent ?? "";
      if (text.includes("Isolated subject lab error")) {
        throw new Error(`isolated subject lab refused the subject: ${text.slice(0, 2000)}`);
      }
      return false;
    },
    null,
    { timeout: 120_000 },
  );

  const canvas = page.locator("#isolated-subject-capture-canvas");
  await mkdir(CELLS_DIR, { recursive: true });
  await canvas.screenshot({ path: join(CELLS_DIR, `${cell}.png`) });

  const state = await page.evaluate(() => {
    const w = window as unknown as {
      __openClinXrSubjectAabb?: SubjectAabb;
      __openClinXrSupineJointDump?: LabDump;
    };
    return {
      aabb: w.__openClinXrSubjectAabb ?? null,
      dump: w.__openClinXrSupineJointDump ?? null,
    };
  });

  if (!state.aabb) throw new Error(`no subject AABB recorded for cell ${cell}`);

  const ranSupineCall = cell !== "standing" && state.dump !== null;
  const appliedJointEulers = ranSupineCall ? (state.dump?.appliedJointEulers ?? false) : false;

  // Ground the supine AABB from the joint dump (same computeMeshBounds over the
  // humanoid); standing reads the subject AABB (glb kind has no supine dump).
  const posedAabb: SubjectAabb = state.dump?.posedMeshAabb ?? state.aabb;

  return { ranSupineCall, appliedJointEulers, aabb: posedAabb };
}

/**
 * Render the three ablation cells and write the tracked sheet + report.
 */
export async function runSupineAblationSheet(options?: {
  cwd?: string;
  force?: boolean;
}): Promise<Report> {
  const cwd = options?.cwd ?? process.cwd();
  void options?.force;

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });

    const cells: Report["cells"] = [];
    const sheetCells: Array<{ imagePath: string; label: string }> = [];
    for (const cell of ["standing", "root_only", "full"] as const) {
      const captured = await captureCell(page, server.url, cell);
      cells.push({
        cell,
        ranSupineCall: captured.ranSupineCall,
        appliedJointEulers: captured.appliedJointEulers,
        posedMeshAabb: {
          min: { y: captured.aabb.min.y },
          max: { y: captured.aabb.max.y },
        },
      });
      sheetCells.push({
        imagePath: join(CELLS_DIR, `${cell}.png`),
        label: cellSpec(cell).label as string,
      });
    }

    await mkdir(dirname(SHEET_PATH), { recursive: true });
    await buildContactSheet({
      page,
      cells: sheetCells,
      outPath: SHEET_PATH,
      columns: 3,
      cellWidth: 800,
      cellHeight: 600,
    });

    const report: Report = {
      schemaVersion: "supine-ablation-report.v1",
      bodyGlb: BODY_GLB,
      renderer:
        "apps/ui-xr three.js WebGLRenderer via isolated-subject-lab.ts "
        + "(subjectKind glb | runtime_posture) driving applySupinePose / applyAndPlantSupineOnDeck",
      cells,
    };

    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

// CLI — only when this file is the entrypoint (never on import).
const mainArg = process.argv[1] ?? "";
const isMain = mainArg !== ""
  && (import.meta.url === `file://${resolve(mainArg)}`
    || import.meta.url.endsWith(mainArg.replaceAll("\\", "/")));

if (isMain) {
  runSupineAblationSheet({ force: true })
    .then((report) => {
      console.log(`wrote ${SHEET_PATH}`);
      console.log(`wrote ${REPORT_PATH}`);
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
