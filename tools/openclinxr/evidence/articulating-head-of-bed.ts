/**
 * #159 — articulating head of bed: deck leads, body follows.
 *
 * Uses #163's isolated-subject harness (one Vite boot, product three.js lab,
 * contact sheet). Does NOT write a second capture script.
 *
 * Order: stretcher articulates → plant reads live back plane → sweep 0/15/30/45.
 *
 * claimScope: staging incline articulation + body contact on raised deck.
 * notEvidenceFor: trained-eye hospital-bed fidelity, multi-joint Gatch, clinical
 * positioning correctness, product ship angle (orchestrator grades the sheet).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { buildContactSheet } from "./isolated-subject-harness.js";
import {
  spawnPortlessDevServer, stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";

export const ISSUE_159_EVIDENCE_ROOT = ".openclinxr/evidence/issue-159";
export const INCLINE_VALUES = [0, 15, 30, 45] as const;
const DEFAULT_BODY = "generated-humanoids/ed_chest_pain_adult_cast.glb";
const VIEWPORT = { width: 1280, height: 960 } as const;

export type InclineSample = {
  requestedDeg: number;
  backSectionWorldDeg: number;
  torsoWorldDeg: number;
  backToDeckGapMeters: number;
  pelvisOnSeatSection: boolean;
  railsClippingTorso: boolean;
  framesAdvanced: number;
};

export type ArticulatingHobReport = {
  samples: InclineSample[];
  contactSheetPath: string;
  deckSectionNames: string[];
  wallClockMs: number;
  claimScope: string[];
  notEvidenceFor: string[];
};

type PageHobMeasure = {
  requestedDeg?: number;
  backSectionWorldDeg?: number;
  torsoWorldDeg?: number;
  backToDeckGapMeters?: number;
  pelvisOnSeatSection?: boolean;
  railsClippingTorso?: boolean;
  framesAdvanced?: number;
  deckSectionNames?: string[];
  inclineSsot?: number;
};

type SubjectSpec = {
  subjectId: string;
  subjectKind: "posture_on_furniture";
  builder: "patient_stretcher";
  posture: "supine";
  bodyGlb: string;
  inclineDegrees: number;
  label: string;
};

/** In-process cache so the three contract cases share one boot + one sheet. */
let cachedReport: ArticulatingHobReport | null = null;
let cacheKey: string | null = null;

function subjectUrl(baseUrl: string, spec: SubjectSpec): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/") }isolated-subject.html?${params.toString()}`;
}

async function captureAndMeasure(input: {
  page: Page;
  baseUrl: string;
  deg: number;
  imagePath: string;
}): Promise<{ sample: InclineSample; imagePath: string; deckSectionNames: string[] }> {
  const spec: SubjectSpec = {
    subjectId: `hob_incline_${input.deg}`,
    subjectKind: "posture_on_furniture",
    builder: "patient_stretcher",
    posture: "supine",
    bodyGlb: DEFAULT_BODY,
    inclineDegrees: input.deg,
    label: `HOB ${input.deg}°`,
  };
  const url = subjectUrl(input.baseUrl, spec);
  await input.page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await input.page.waitForFunction(
    () => {
      const win = browserPageWindow as unknown as {
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
        __openClinXrArticulatingHobMeasure?: PageHobMeasure;
      };
      return (
        (win.__openClinXrIsolatedSubjectEvidence?.meshCount ?? 0) > 0
        && win.__openClinXrArticulatingHobMeasure
        && (win.__openClinXrArticulatingHobMeasure.framesAdvanced ?? 0) > 0
      );
    },
    null,
    { timeout: 120_000 },
  );
  const measure = await input.page.evaluate(() => {
    return (browserPageWindow as unknown as { __openClinXrArticulatingHobMeasure?: PageHobMeasure })
      .__openClinXrArticulatingHobMeasure ?? null;
  });
  if (!measure) {
    throw new Error(`No HOB measure at incline ${input.deg}`);
  }
  await mkdir(path.dirname(input.imagePath), { recursive: true });
  const canvas = input.page.locator("#isolated-subject-capture-canvas");
  if (await canvas.count()) {
    await canvas.screenshot({ path: input.imagePath });
  } else {
    await input.page.screenshot({ path: input.imagePath });
  }
  const sample: InclineSample = {
    requestedDeg: input.deg,
    backSectionWorldDeg: Number(measure.backSectionWorldDeg ?? 0),
    torsoWorldDeg: Number(measure.torsoWorldDeg ?? 0),
    backToDeckGapMeters: Number(measure.backToDeckGapMeters ?? 0),
    pelvisOnSeatSection: measure.pelvisOnSeatSection === true,
    railsClippingTorso: measure.railsClippingTorso === true,
    framesAdvanced: Number(measure.framesAdvanced ?? 0),
  };
  const deckSectionNames = Array.isArray(measure.deckSectionNames)
    ? measure.deckSectionNames.filter((n): n is string => typeof n === "string")
    : [];
  return { sample, imagePath: input.imagePath, deckSectionNames };
}

/**
 * Run the articulating-HOB sweep via #163's isolated lab. One boot, four inclines,
 * one contact sheet under issue-159 evidence.
 */
export async function runArticulatingHeadOfBed(options?: {
  cwd?: string;
  force?: boolean;
}): Promise<ArticulatingHobReport> {
  const cwd = options?.cwd ?? process.cwd();
  const force = options?.force === true;
  const key = path.resolve(cwd);
  if (!force && cachedReport && cacheKey === key) {
    return cachedReport;
  }

  const t0 = Date.now();
  const outRoot = path.join(cwd, ISSUE_159_EVIDENCE_ROOT);
  await mkdir(outRoot, { recursive: true });

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { ...VIEWPORT },
      deviceScaleFactor: 1,
    });

    const samples: InclineSample[] = [];
    const sheetCells: Array<{ imagePath: string; label: string }> = [];
    let deckSectionNames: string[] = [];

    for (const deg of INCLINE_VALUES) {
      const imagePath = path.join(outRoot, `articulating-hob-${deg}deg.png`);
      const result = await captureAndMeasure({
        page,
        baseUrl: server.url,
        deg,
        imagePath,
      });
      samples.push(result.sample);
      sheetCells.push({ imagePath: result.imagePath, label: `${deg}° articulating deck` });
      if (result.deckSectionNames.length > deckSectionNames.length) {
        deckSectionNames = result.deckSectionNames;
      }
    }

    const contactAbs = path.join(outRoot, "articulating-hob-contact-sheet.png");
    await buildContactSheet({ page, cells: sheetCells, outPath: contactAbs, columns: 2 });

    const report: ArticulatingHobReport = {
      samples,
      contactSheetPath: path.relative(cwd, contactAbs).replaceAll("\\", "/"),
      deckSectionNames,
      wallClockMs: Date.now() - t0,
      claimScope: ["staging_incline", "articulating_head_of_bed"],
      notEvidenceFor: [
        "trained_eye_hospital_bed_fidelity",
        "multi_joint_articulation",
        "clinical_positioning_correctness",
        "product_ship_incline_degrees",
      ],
    };

    await writeFile(
      path.join(outRoot, "articulating-hob-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    cachedReport = report;
    cacheKey = key;
    return report;
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

/**
 * Contract entry — inspectArticulatingHeadOfBed().
 * Cached after first successful run so three vitest cases share one boot.
 */
export async function inspectArticulatingHeadOfBed(): Promise<ArticulatingHobReport> {
  return runArticulatingHeadOfBed();
}

// CLI — only when this file is the entrypoint (never on import).
const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  runArticulatingHeadOfBed({ force: true })
    .then((report) => {
      console.log(JSON.stringify({
        samples: report.samples,
        contactSheetPath: report.contactSheetPath,
        deckSectionNames: report.deckSectionNames,
        wallClockMs: report.wallClockMs,
      }, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
