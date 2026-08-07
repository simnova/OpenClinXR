/**
 * Isolated subject harness (#163) — one boot, N subjects/variants, contact sheet.
 *
 * Shape mirrors model-vetting-glb-grade-capture (one studio/server for N assets) but
 * subjects are **runtime** furniture builders + postures from apps/ui-xr — not only GLBs.
 *
 * Decisions (commit-named):
 *  - Lab page lives in apps/ui-xr as MPA entry `isolated-subject.html` (REJECTED extending
 *    model-vetting-studio for runtime subjects: composite rootDir cannot import ui-xr builders
 *    without duplication or a new package; product three.js path for postures is ui-xr).
 *  - Subject descriptor = JSON `{ subjectId, subjectKind, builder?, posture?, bodyGlb?,
 *    inclineDegrees? }` via URL `?subject=` (or query fields). Cannot express multi-actor
 *    dialogue, station lighting, or shell-relative placements.
 *  - Builders/postures IMPORTED in the lab page from `./station-*.ts` / `./supine-pose.ts`
 *    (REJECTED duplicate geometry).
 *  - Contact sheet = 2×2 labelled grid via Playwright HTML composite (no sharp dep);
 *    also writes each full-size variant PNG.
 *
 * claimScope: harness evidence for iteration speed.
 * notEvidenceFor: clinical incline choice as product ship, Quest readiness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  spawnPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";

export const DEFAULT_EVIDENCE_ROOT = ".openclinxr/evidence/isolated-subject-harness";
export const ISSUE_EVIDENCE_ROOT = ".openclinxr/evidence/issue-163";

export type RenderedSubject = {
  subjectId: string;
  subjectKind: string;
  imagePath: string;
  frameCoverage: number;
  roomGeometryPresent: boolean;
  hudPresent: boolean;
  extraActorIds: string[];
};

export type VariantSweep = {
  sweepId: string;
  parameter: string;
  values: number[];
  contactSheetPath: string;
  subjects: RenderedSubject[];
};

export type HarnessRun = {
  subjects: RenderedSubject[];
  sweeps: VariantSweep[];
  devServerBoots: number;
  browserLaunches: number;
  wallClockMs: number;
  usesProductRenderer: boolean;
};

type PageEvidence = {
  subjectId?: string;
  subjectKind?: string;
  roomGeometryPresent?: boolean;
  hudPresent?: boolean;
  extraActorIds?: string[];
  meshCount?: number;
  usesProductRenderer?: boolean;
  label?: string;
  frameCoverage?: number;
};

type SubjectSpec = {
  subjectId: string;
  subjectKind: "furniture_builder" | "runtime_posture" | "posture_on_furniture" | "glb";
  builder?: "patient_stretcher" | "patient_chair";
  posture?: "supine";
  bodyGlb?: string;
  inclineDegrees?: number;
  label?: string;
};

const DEFAULT_BODY = "generated-humanoids/ed_chest_pain_adult_cast.glb";
const VIEWPORT = { width: 1280, height: 960 } as const;

/** Cache so contract suite can call inspect multiple times without re-booting. */
let cachedRun: HarnessRun | null = null;
let cacheKey: string | null = null;

function subjectUrl(baseUrl: string, spec: SubjectSpec): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/") }isolated-subject.html?${params.toString()}`;
}

/** 2×2 (or N-col) labelled contact sheet via Playwright HTML composite — no sharp. */
export async function buildContactSheet(input: {
  page: Page;
  cells: Array<{ imagePath: string; label: string }>;
  outPath: string;
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
}): Promise<string> {
  const columns = input.columns ?? 2;
  const cellW = input.cellWidth ?? 640;
  const cellH = input.cellHeight ?? 480;
  const labelH = 36;
  const rows = Math.ceil(input.cells.length / columns);
  const width = columns * cellW;
  const height = rows * (cellH + labelH);

  const cellsHtml: string[] = [];
  for (const cell of input.cells) {
    const b64 = (await readFile(cell.imagePath)).toString("base64");
    cellsHtml.push(
      `<div style="width:${cellW}px;height:${cellH + labelH}px;background:#0f1613;box-sizing:border-box">`
        + `<div style="height:${labelH}px;line-height:${labelH}px;padding:0 12px;color:#e8f5ef;`
        + `font:16px/36px Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden">`
        + `${escapeHtml(cell.label)}</div>`
        + `<img src="data:image/png;base64,${b64}" width="${cellW}" height="${cellH}" `
        + `style="display:block;object-fit:contain;background:#18211d"/>`
        + `</div>`,
    );
  }

  const html =
    `<!doctype html><html><head><meta charset="utf-8"/><style>`
    + `html,body{margin:0;background:#0f1613}`
    + `.grid{display:grid;grid-template-columns:repeat(${columns},${cellW}px);width:${width}px;height:${height}px}`
    + `</style></head><body><div class="grid">${cellsHtml.join("")}</div></body></html>`;

  await mkdir(path.dirname(input.outPath), { recursive: true });
  await input.page.setViewportSize({ width, height });
  await input.page.setContent(html, { waitUntil: "load" });
  await input.page.locator(".grid").screenshot({ path: input.outPath });
  return input.outPath;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function captureSubject(input: {
  page: Page;
  baseUrl: string;
  spec: SubjectSpec;
  imagePath: string;
}): Promise<RenderedSubject> {
  const url = subjectUrl(input.baseUrl, input.spec);
  await input.page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const handle = await input.page.waitForFunction(
    () => {
      const evidence = (window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: PageEvidence;
      }).__openClinXrIsolatedSubjectEvidence;
      return evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0
        ? evidence
        : null;
    },
    null,
    { timeout: 120_000 },
  );
  const evidence = (await handle.jsonValue()) as PageEvidence;
  await mkdir(path.dirname(input.imagePath), { recursive: true });
  const canvas = input.page.locator("#isolated-subject-capture-canvas");
  if (await canvas.count()) {
    await canvas.screenshot({ path: input.imagePath });
  } else {
    await input.page.screenshot({ path: input.imagePath });
  }
  const frameCoverage =
    typeof evidence.frameCoverage === "number" && Number.isFinite(evidence.frameCoverage)
      ? evidence.frameCoverage
      : 0;
  return {
    subjectId: input.spec.subjectId,
    subjectKind: input.spec.subjectKind,
    imagePath: input.imagePath,
    frameCoverage,
    roomGeometryPresent: evidence.roomGeometryPresent === true,
    hudPresent: evidence.hudPresent === true,
    extraActorIds: Array.isArray(evidence.extraActorIds) ? evidence.extraActorIds : [],
  };
}

/**
 * Default proving run: stretcher, chair, supine body, and semi-Fowler 0/15/30/45° sweep.
 * ONE portless boot, ONE browser.
 */
export async function runIsolatedSubjectHarness(options?: {
  cwd?: string;
  outputRoot?: string;
  force?: boolean;
}): Promise<HarnessRun> {
  const cwd = options?.cwd ?? process.cwd();
  const force = options?.force === true;
  const key = path.resolve(cwd);
  if (!force && cachedRun && cacheKey === key) {
    return cachedRun;
  }

  const t0 = Date.now();
  const runId = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const outRoot = path.join(cwd, options?.outputRoot ?? DEFAULT_EVIDENCE_ROOT, runId);
  const latestRoot = path.join(cwd, options?.outputRoot ?? DEFAULT_EVIDENCE_ROOT, "latest");
  const issueRoot = path.join(cwd, ISSUE_EVIDENCE_ROOT);
  await mkdir(outRoot, { recursive: true });
  await mkdir(latestRoot, { recursive: true });
  await mkdir(issueRoot, { recursive: true });

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;
  let boots = 0;
  let browsers = 0;

  try {
    boots += 1;
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd,
      readyTimeoutMs: 180_000,
    });

    browsers += 1;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { ...VIEWPORT },
      deviceScaleFactor: 1,
    });

    const baseSubjects: SubjectSpec[] = [
      {
        subjectId: "ed_stretcher",
        subjectKind: "furniture_builder",
        builder: "patient_stretcher",
        label: "ED stretcher (builder)",
      },
      {
        subjectId: "clinic_chair",
        subjectKind: "furniture_builder",
        builder: "patient_chair",
        label: "Clinic chair (builder)",
      },
      {
        subjectId: "supine_humanoid",
        subjectKind: "posture_on_furniture",
        builder: "patient_stretcher",
        posture: "supine",
        bodyGlb: DEFAULT_BODY,
        inclineDegrees: 0,
        label: "Supine on deck",
      },
    ];

    const subjects: RenderedSubject[] = [];
    for (const spec of baseSubjects) {
      const imagePath = path.join(outRoot, "subjects", `${spec.subjectId}.png`);
      const rendered = await captureSubject({
        page,
        baseUrl: server.url,
        spec,
        imagePath,
      });
      // Store repo-relative path for reports.
      subjects.push({
        ...rendered,
        imagePath: path.relative(cwd, rendered.imagePath).replaceAll("\\", "/"),
      });
    }

    const inclineValues = [0, 15, 30, 45];
    const sweepSubjects: RenderedSubject[] = [];
    const sheetCells: Array<{ imagePath: string; label: string }> = [];
    for (const deg of inclineValues) {
      const spec: SubjectSpec = {
        subjectId: `supine_incline_${deg}`,
        subjectKind: "posture_on_furniture",
        builder: "patient_stretcher",
        posture: "supine",
        bodyGlb: DEFAULT_BODY,
        inclineDegrees: deg,
        label: `Semi-Fowler ${deg}°`,
      };
      const imagePath = path.join(outRoot, "sweeps", "semi_fowler_incline", `${deg}deg.png`);
      const rendered = await captureSubject({
        page,
        baseUrl: server.url,
        spec,
        imagePath,
      });
      const rel = path.relative(cwd, rendered.imagePath).replaceAll("\\", "/");
      sweepSubjects.push({ ...rendered, imagePath: rel });
      subjects.push({ ...rendered, imagePath: rel });
      sheetCells.push({ imagePath: rendered.imagePath, label: `${deg}° incline` });
    }

    const contactAbs = path.join(outRoot, "sweeps", "semi_fowler_incline", "contact-sheet.png");
    await buildContactSheet({ page, cells: sheetCells, outPath: contactAbs, columns: 2 });
    // Also copy contact sheet + key singles into issue-163 for grading.
    const issueSheet = path.join(issueRoot, "semi-fowler-incline-contact-sheet.png");
    await writeFile(issueSheet, await readFile(contactAbs));
    for (const s of subjects.filter((x) =>
      ["ed_stretcher", "clinic_chair", "supine_humanoid"].includes(x.subjectId),
    )) {
      const abs = path.join(cwd, s.imagePath);
      await writeFile(path.join(issueRoot, `${s.subjectId}.png`), await readFile(abs));
    }
    for (const deg of inclineValues) {
      const abs = path.join(outRoot, "sweeps", "semi_fowler_incline", `${deg}deg.png`);
      await writeFile(path.join(issueRoot, `semi-fowler-${deg}deg.png`), await readFile(abs));
    }

    const run: HarnessRun = {
      subjects,
      sweeps: [
        {
          sweepId: "semi_fowler_incline",
          parameter: "inclineDegrees",
          values: inclineValues,
          contactSheetPath: path.relative(cwd, contactAbs).replaceAll("\\", "/"),
          subjects: sweepSubjects,
        },
      ],
      devServerBoots: boots,
      browserLaunches: browsers,
      wallClockMs: Date.now() - t0,
      usesProductRenderer: true,
    };

    const reportPath = path.join(outRoot, "harness-run.json");
    await writeFile(reportPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await writeFile(path.join(latestRoot, "harness-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(issueRoot, "harness-run.json"),
      `${JSON.stringify(run, null, 2)}\n`,
      "utf8",
    );

    cachedRun = run;
    cacheKey = key;
    return run;
  } finally {
    if (browser) await browser.close();
    if (server) server.proc.kill("SIGTERM");
  }
}

/**
 * Contract entry — inspectIsolatedSubjectHarness().
 * Cached after first successful run in-process so the three `it` cases share one boot.
 */
export async function inspectIsolatedSubjectHarness(): Promise<HarnessRun> {
  return runIsolatedSubjectHarness();
}

// CLI
const isMain = process.argv[1]
  && (import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))
    || import.meta.url.includes("isolated-subject-harness"));

if (isMain) {
  runIsolatedSubjectHarness({ force: true })
    .then((run) => {
      console.log(JSON.stringify({
        subjects: run.subjects.length,
        sweeps: run.sweeps.length,
        devServerBoots: run.devServerBoots,
        browserLaunches: run.browserLaunches,
        wallClockMs: run.wallClockMs,
        usesProductRenderer: run.usesProductRenderer,
        contactSheet: run.sweeps[0]?.contactSheetPath,
        kinds: [...new Set(run.subjects.map((s) => s.subjectKind))],
      }, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
