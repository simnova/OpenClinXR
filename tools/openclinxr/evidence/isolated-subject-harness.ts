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
/** #262 equipment reference packs — same evidence root as the pack report + pre-fix. */
export const EQUIPMENT_PACK_EVIDENCE_ROOT = ".openclinxr/evidence/issue-262";

/** Reference-pack capture views (#262) — mirrors the #232 pack view set + back. */
export type CaptureView =
  | "front"
  | "side"
  | "three_quarter_left"
  | "three_quarter_right"
  | "back";

export type RenderedSubject = {
  subjectId: string;
  subjectKind: string;
  imagePath: string;
  frameCoverage: number;
  /** #270: larger projected AABB extent as a fraction of the square frame (pack views only). */
  frameSpanFraction: number | null;
  roomGeometryPresent: boolean;
  hudPresent: boolean;
  extraActorIds: string[];
  /** True when the neutral ground plane was in the scene (#265 subject-only discriminator). */
  groundPlanePresent: boolean;
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
  frameSpanFraction?: number | null;
  groundPlanePresent?: boolean;
};

type SubjectSpec = {
  subjectId: string;
  subjectKind:
    | "furniture_builder"
    | "runtime_posture"
    | "posture_on_furniture"
    | "glb"
    | "equipment_builder";
  builder?: "patient_stretcher" | "patient_chair";
  /** equipment_builder id (e.g. iv_pole_equipment) — #262. */
  equipmentId?: string;
  posture?: "supine";
  bodyGlb?: string;
  inclineDegrees?: number;
  /** Camera view for reference-pack renders (#262). Absent = legacy framing. */
  view?: CaptureView;
  /** When true, the lab serializes the rendered subject to a GLB (base64). */
  exportGlb?: boolean;
  /** When true, render without the neutral ground plane — flat background (#265). */
  subjectOnly?: boolean;
  label?: string;
};

/** Square capture size matching the #232 pack shape. */
const PACK_VIEWPORT = { width: 1024, height: 1024 } as const;

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
  // Pack captures are square (#232 shape); legacy subjects keep the 1280×960 frame.
  if (input.spec.view) {
    await input.page.setViewportSize({ width: PACK_VIEWPORT.width, height: PACK_VIEWPORT.height });
  } else {
    await input.page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  }
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
    frameSpanFraction:
      typeof evidence.frameSpanFraction === "number" && Number.isFinite(evidence.frameSpanFraction)
        ? evidence.frameSpanFraction
        : null,
    roomGeometryPresent: evidence.roomGeometryPresent === true,
    hudPresent: evidence.hudPresent === true,
    extraActorIds: Array.isArray(evidence.extraActorIds) ? evidence.extraActorIds : [],
    groundPlanePresent: evidence.groundPlanePresent === true,
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

// ---------------------------------------------------------------------------
// #262 — equipment reference packs from PARAMETRIC RENDERS
// ---------------------------------------------------------------------------

export type EquipmentPackView = RenderedSubject & { view: CaptureView };

export type EquipmentPackRun = {
  equipmentId: string;
  views: EquipmentPackView[];
  contactSheetPath: string;
  /** Repo-relative dir holding the square per-view PNGs (+ parametric-source.glb). */
  packDir: string;
  /** Repo-relative path of the exported parametric source GLB (front view export). */
  parametricSourceGlbPath: string | null;
  devServerBoots: number;
  browserLaunches: number;
  wallClockMs: number;
  usesProductRenderer: boolean;
};

/** #262 default pack subjects. */
export const DEFAULT_PACK_EQUIPMENT_ID = "iv_pole_equipment";
export const DEFAULT_PACK_VIEWS: CaptureView[] = [
  "front",
  "side",
  "three_quarter_left",
  "three_quarter_right",
  "back",
];

/**
 * Render one parametric equipment builder as a square reference pack (#262).
 *
 * ONE portless boot, ONE browser, N views. Views match the #232 pack shape
 * (front/side/two three-quarters, 1024×1024) plus a back view (#254: the rear is
 * where reconstruction fails, and existing packs lack it). The front capture also
 * exports the rendered root to a GLB (`parametric-source.glb`) so the bake output
 * can be compared against the parametric source with the same instrument.
 *
 * ## FIXED (#265)
 * The #262 pack renders showed the subject standing on a lit neutral ground plane
 * (`isolated_neutral_ground`), and TRELLIS reconstructed that ground as geometry —
 * every #262 metric read the floor slab, not a lost pole (verdict withdrawn after
 * the orchestrator graded the pixels). Pack renders are now SUBJECT-ONLY by
 * default: no ground plane, flat background, one variable. Pass `subjectOnly:
 * false` for the legacy grounded shape. `groundPlanePresent` on each rendered view
 * records, from the scene, whether the ground was in frame.
 *
 * Does NOT run TRELLIS — it produces the input the bake consumes.
 */
export async function renderEquipmentReferencePack(options?: {
  cwd?: string;
  equipmentId?: string;
  views?: CaptureView[];
  outputRoot?: string;
  /** Default true (#265) — subject-only renders. Pass false for the legacy grounded pack. */
  subjectOnly?: boolean;
}): Promise<EquipmentPackRun> {
  const cwd = options?.cwd ?? process.cwd();
  const equipmentId = options?.equipmentId ?? DEFAULT_PACK_EQUIPMENT_ID;
  const views = options?.views ?? DEFAULT_PACK_VIEWS;
  const subjectOnly = options?.subjectOnly !== false;
  const outRoot = path.join(cwd, options?.outputRoot ?? EQUIPMENT_PACK_EVIDENCE_ROOT);
  const packDir = path.join(outRoot, "packs", equipmentId);
  const reportRoot = path.join(outRoot, "pack-render-report.json");
  await mkdir(packDir, { recursive: true });

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;
  let boots = 0;
  let browsers = 0;

  const t0 = Date.now();
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
      viewport: { ...PACK_VIEWPORT },
      deviceScaleFactor: 1,
    });

    const renderedViews: EquipmentPackView[] = [];
    let parametricSourceGlbPath: string | null = null;

    for (const view of views) {
      const spec: SubjectSpec = {
        subjectId: `${equipmentId}_${view}`,
        subjectKind: "equipment_builder",
        equipmentId,
        view,
        exportGlb: view === "front",
        subjectOnly,
        label: `${equipmentId} ${view}`,
      };
      const imagePath = path.join(packDir, `${view}.png`);
      const rendered = await captureSubject({
        page,
        baseUrl: server.url,
        spec,
        imagePath,
      });
      const relImage = path.relative(cwd, rendered.imagePath).replaceAll("\\", "/");
      renderedViews.push({ ...rendered, imagePath: relImage, view });

      if (view === "front") {
        const glbBase64 = await page.evaluate(
          () => (window as unknown as { __openClinXrExportedGlbBase64?: string })
            .__openClinXrExportedGlbBase64 ?? null,
        );
        if (glbBase64) {
          const glbPath = path.join(packDir, "parametric-source.glb");
          await writeFile(glbPath, Buffer.from(glbBase64, "base64"));
          parametricSourceGlbPath = path.relative(cwd, glbPath).replaceAll("\\", "/");
        }
      }
    }

    const contactAbs = path.join(outRoot, "packs", equipmentId, "contact-sheet.png");
    await buildContactSheet({
      page,
      cells: renderedViews.map((v) => ({
        imagePath: path.join(cwd, v.imagePath),
        label: v.view,
      })),
      outPath: contactAbs,
      columns: 2,
    });

    const run: EquipmentPackRun = {
      equipmentId,
      views: renderedViews,
      contactSheetPath: path.relative(cwd, contactAbs).replaceAll("\\", "/"),
      packDir: path.relative(cwd, packDir).replaceAll("\\", "/"),
      parametricSourceGlbPath,
      devServerBoots: boots,
      browserLaunches: browsers,
      wallClockMs: Date.now() - t0,
      usesProductRenderer: true,
    };

    await writeFile(reportRoot, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    return run;
  } finally {
    if (browser) await browser.close();
    if (server) server.proc.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// #270 — framing before/after report
// ---------------------------------------------------------------------------

/** #270 worst-case compact subject — the small wall plate the issue is about. */
export const FRAMING_WORST_CASE_EQUIPMENT_ID = "oxygen_wall_port_equipment";
/** #270 default report root. */
export const FRAMING_EVIDENCE_ROOT = ".openclinxr/evidence/issue-270";

export type EquipmentFramingReport = {
  issue: "270";
  measurementKind: string;
  factoryStep: "equipment_generate";
  measuredAt: string;
  reportPath: string;
  floor: {
    derivation: string;
    controlSubjectId: string;
    /** max(frameCoverage) over the control's PRE-FIX views — measured, never invented. */
    controlPreFixMaxCoverage: number;
  };
  assertion: {
    subjectId: string;
    rule: string;
    postFixMaxCoverage: number;
    passed: boolean;
  };
  subjects: Record<
    string,
    {
      role: string;
      views: Array<{
        view: string;
        frameCoverage: number;
        frameSpanFraction: number | null;
        groundPlanePresent: boolean;
      }>;
    }
  >;
  wallClockMs: number;
  notEvidenceFor: string[];
};

/**
 * #270 post-fix framing measurement: render both equipment subjects with the NEW
 * bounds-framing, compare against the measured PRE-FIX before-column, and write
 * `framing-report.json`. Fail-closed — the floor must come from the control's
 * measured pre-fix coverage, never a number chosen after the fact.
 */
export async function writeEquipmentFramingReport(options?: {
  cwd?: string;
  outputRoot?: string;
}): Promise<EquipmentFramingReport> {
  const cwd = options?.cwd ?? process.cwd();
  const outputRoot = options?.outputRoot ?? FRAMING_EVIDENCE_ROOT;
  const preFixPath = path.join(cwd, outputRoot, "pre-fix.json");
  const reportPath = path.join(cwd, outputRoot, "framing-report.json");

  let preFix: {
    subjects?: Record<string, { views?: Array<{ frameCoverage?: number }> }>;
  };
  try {
    preFix = JSON.parse(await readFile(preFixPath, "utf8")) as typeof preFix;
  } catch {
    throw new Error(
      `writeEquipmentFramingReport requires ${preFixPath} (the measured pre-fix before-column) — write it before generating the framing report`,
    );
  }
  const controlViews = preFix.subjects?.[DEFAULT_PACK_EQUIPMENT_ID]?.views;
  if (!controlViews || controlViews.length === 0) {
    throw new Error(
      `pre-fix.json has no measured views for the control ${DEFAULT_PACK_EQUIPMENT_ID} — the floor cannot be derived`,
    );
  }
  const floor = Math.max(...controlViews.map((v) => v.frameCoverage ?? 0));

  const t0 = Date.now();
  const subjects: EquipmentFramingReport["subjects"] = {};
  const subjectRows: Array<[string, string]> = [
    [FRAMING_WORST_CASE_EQUIPMENT_ID, "worst-case small plate (12x19x8.5 cm wall O2 port)"],
    [DEFAULT_PACK_EQUIPMENT_ID, "control (tall pole, iv_pole_equipment)"],
  ];
  for (const [equipmentId, role] of subjectRows) {
    const run = await renderEquipmentReferencePack({ cwd, equipmentId, outputRoot });
    subjects[equipmentId] = {
      role,
      views: run.views.map((v) => ({
        view: v.view,
        frameCoverage: v.frameCoverage,
        frameSpanFraction: v.frameSpanFraction,
        groundPlanePresent: v.groundPlanePresent,
      })),
    };
  }

  const worstCase = subjects[FRAMING_WORST_CASE_EQUIPMENT_ID];
  const postFixMaxCoverage = Math.max(...worstCase.views.map((v) => v.frameCoverage));
  const passed = postFixMaxCoverage > floor;

  const report: EquipmentFramingReport = {
    issue: "270",
    measurementKind:
      "post-fix framing measurement — frameCoverage per view for the same two subjects rendered with the #270 bounds-framing (PACK_FRAME_TARGET 0.8 of the square frame), compared against the pre-fix before-column",
    factoryStep: "equipment_generate",
    measuredAt: new Date().toISOString(),
    reportPath: path.relative(cwd, reportPath).replaceAll("\\", "/"),
    floor: {
      derivation:
        `max(frameCoverage) over the measured control (${DEFAULT_PACK_EQUIPMENT_ID}) PRE-FIX views from ${preFixPath} — a measurement, not an invented threshold`,
      controlSubjectId: DEFAULT_PACK_EQUIPMENT_ID,
      controlPreFixMaxCoverage: floor,
    },
    assertion: {
      subjectId: FRAMING_WORST_CASE_EQUIPMENT_ID,
      rule: `a rendered pack view of ${FRAMING_WORST_CASE_EQUIPMENT_ID} must have frameCoverage > the control's pre-fix max (${floor.toFixed(6)})`,
      postFixMaxCoverage,
      passed,
    },
    subjects,
    wallClockMs: Date.now() - t0,
    notEvidenceFor: [
      "the bake comparison (explicitly out of scope for #270 — framing is one variable, the bake belongs to a later slice once framing and view count are settled)",
      "any mesh-quality claim",
      "clinical accuracy or device equivalence",
    ],
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI — only when this file is the entrypoint (never on import as a dependency).
const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  const argv = process.argv.slice(2);
  const flagValue = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  if (argv.includes("--framing-report")) {
    writeEquipmentFramingReport({ outputRoot: flagValue("--output-root") })
      .then((report) => {
        console.log(JSON.stringify({
          reportPath: report.reportPath,
          assertion: report.assertion,
          subjects: Object.fromEntries(
            Object.entries(report.subjects).map(([id, s]) => [id, {
              role: s.role,
              views: s.views.map((v) => ({ view: v.view, frameCoverage: v.frameCoverage })),
            }]),
          ),
          wallClockMs: report.wallClockMs,
        }, null, 2));
      })
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  } else if (argv.includes("--pack")) {
    const packIdx = argv.indexOf("--pack");
    const equipmentId = argv[packIdx + 1] ?? DEFAULT_PACK_EQUIPMENT_ID;
    renderEquipmentReferencePack({ equipmentId, outputRoot: flagValue("--output-root") })
      .then((run) => {
        console.log(JSON.stringify({
          equipmentId: run.equipmentId,
          views: run.views.map((v) => ({ view: v.view, imagePath: v.imagePath })),
          contactSheetPath: run.contactSheetPath,
          packDir: run.packDir,
          parametricSourceGlbPath: run.parametricSourceGlbPath,
          devServerBoots: run.devServerBoots,
          browserLaunches: run.browserLaunches,
          wallClockMs: run.wallClockMs,
          usesProductRenderer: run.usesProductRenderer,
        }, null, 2));
      })
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  } else {
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
}
