/**
 * Recapture the fifteen shipped stations after the occlusion/containment refine
 * and assemble one labelled contact sheet. Does not change rooms, lights,
 * materials, population, wait budgets, or existing actor/interior thresholds.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildContactSheet } from "../isolated-subject-harness.js";
import {
  captureStationEnvironmentRooms,
  shippedStationIds,
  type RoomCaptureManifest,
} from "../ui-xr-environment-room-capture.js";
import {
  CONTACT_SHEET_CELL_HEIGHT,
  CONTACT_SHEET_CELL_WIDTH,
  CONTACT_SHEET_COLUMNS,
  CONTACT_SHEET_MIN_BYTES,
} from "./assemble-station-room-grade-set.js";
import {
  BEFORE_CELLS_DIR_REL,
  BEFORE_TREE_SHA,
  CLEAR_CELLS_DIR_REL,
  CLEAR_CONTACT_SHEET_REL,
  CLEAR_KNOWN_GOOD_CASE_IDS,
  CLEAR_REPORT_REL,
  DOOR_PCT_CEILING,
  STANDING_SKIN_FLOOR,
  WALL_CENTER_PLASTER_FLOOR,
  WALL_OCCLUDED_CASE_ID,
  measureOcclusionAndContainment,
  type ClearStationRow,
  type OcclusionContainmentMetrics,
} from "./occlusion-and-containment-metrics.js";
import { BEIGE_CEILING, INTERIOR_SD_FLOOR, measureInteriorCenter } from "./interior-frame-metrics.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function yn(value: boolean): string {
  return value ? "Y" : "n";
}

function stationBlock(station: ClearStationRow): string {
  return [
    `### \`${station.caseId}\``,
    `- image: ${station.imageRel}`,
    `- environmentId: ${station.environmentId}`,
    `- bytes: ${String(station.bytes)}`,
    `- centerFigPct: ${station.centerFigPct.toFixed(2)}`,
    `- centerPlasterPct: ${station.centerPlasterPct.toFixed(2)}`,
    `- doorPct: ${station.doorPct.toFixed(2)}`,
    `- wallOccluded: ${String(station.wallOccluded)}`,
    `- doorOccluded: ${String(station.doorOccluded)}`,
    `- unobstructed: ${String(station.unobstructed)}`,
    `- standingCount: ${String(station.standingCount)}`,
    `- largestStandingSkinPct: ${station.largestStandingSkinPct.toFixed(2)}`,
    `- largestStandingTouchLeft: ${String(station.largestStandingTouchLeft)}`,
    `- largestStandingTouchRight: ${String(station.largestStandingTouchRight)}`,
    `- largestStandingTouchBottom: ${String(station.largestStandingTouchBottom)}`,
    `- anyStandingTouchRight: ${String(station.anyStandingTouchRight)}`,
    `- anyStandingTouchBottom: ${String(station.anyStandingTouchBottom)}`,
    `- largestStandingContained: ${String(station.largestStandingContained)}`,
    `- framesClear: ${String(station.framesClear)}`,
    "",
  ].join("\n");
}

function comparisonTable(
  before: readonly ClearStationRow[],
  after: readonly ClearStationRow[],
): string {
  const header = [
    "| case | before wall | after wall | before door | after door | before unob | after unob | before clear | after clear | before L/R/B | after L/R/B | after anyR/anyB |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const lines = after.map((aft) => {
    const bef = before.find((row) => row.caseId === aft.caseId);
    const bLRB = bef
      ? `${yn(bef.largestStandingTouchLeft)}/${yn(bef.largestStandingTouchRight)}/${yn(bef.largestStandingTouchBottom)}`
      : "—";
    const aLRB = `${yn(aft.largestStandingTouchLeft)}/${yn(aft.largestStandingTouchRight)}/${yn(aft.largestStandingTouchBottom)}`;
    const aAny = `${yn(aft.anyStandingTouchRight)}/${yn(aft.anyStandingTouchBottom)}`;
    return `| ${aft.caseId} | ${String(bef?.wallOccluded ?? "—")} | ${String(aft.wallOccluded)} | ${String(bef?.doorOccluded ?? "—")} | ${String(aft.doorOccluded)} | ${String(bef?.unobstructed ?? "—")} | ${String(aft.unobstructed)} | ${String(bef?.framesClear ?? "—")} | ${String(aft.framesClear)} | ${bLRB} | ${aLRB} | ${aAny} |`;
  });
  return [...header, ...lines].join("\n");
}

export function rowFromMetrics(
  caseId: string,
  imageRel: string,
  environmentId: string,
  bytes: number,
  metrics: OcclusionContainmentMetrics,
): ClearStationRow {
  const largest = metrics.standing[0];
  return {
    caseId,
    imageRel,
    environmentId,
    bytes,
    centerFigPct: metrics.centerFigPct,
    centerPlasterPct: metrics.centerPlasterPct,
    doorPct: metrics.doorPct,
    wallOccluded: metrics.wallOccluded,
    doorOccluded: metrics.doorOccluded,
    unobstructed: metrics.unobstructed,
    standingCount: metrics.standing.length,
    largestStandingSkinPct: largest?.skinInHeadBandPct ?? 0,
    largestStandingTouchLeft: largest?.touchLeft ?? false,
    largestStandingTouchRight: metrics.largestStandingTouchRight,
    largestStandingTouchBottom: metrics.largestStandingTouchBottom,
    largestStandingTouchTop: metrics.largestStandingTouchTop,
    anyStandingTouchRight: metrics.anyStandingTouchRight,
    anyStandingTouchBottom: metrics.anyStandingTouchBottom,
    anyStandingTouchTop: metrics.anyStandingTouchTop,
    anyStandingTouchLeft: metrics.anyStandingTouchLeft,
    largestStandingContained: metrics.largestStandingContained,
    fourEdgeContained: metrics.fourEdgeContained,
    skinnedTouchLeft: metrics.skinnedTouchLeft,
    skinnedTouchRight: metrics.skinnedTouchRight,
    skinnedTouchTop: metrics.skinnedTouchTop,
    skinnedTouchBottom: metrics.skinnedTouchBottom,
    framesClear: metrics.framesClear,
    framesWhole: metrics.framesWhole,
    placardBack: null,
    meanFacingDeg: null,
    framesActors: null,
  };
}

export function renderClearReport(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly ClearStationRow[];
  beforeStations?: readonly ClearStationRow[];
}): string {
  const sections = input.stations.map((station) => stationBlock(station));
  const before = input.beforeStations ?? [];
  const beforeSections = before.map((station) => stationBlock(station));
  const clearCount = input.stations.filter((row) => row.framesClear).length;
  const beforeFailCount = before.filter((row) => !row.framesClear).length;
  const namedBefore = before.filter(
    (row) =>
      row.caseId === WALL_OCCLUDED_CASE_ID || row.caseId.startsWith("ed_chest_pain_priority_"),
  );
  const namedBeforeFail = namedBefore.filter((row) => !row.framesClear);
  return [
    "# Station room occlusion and containment (2026-09-12)",
    "",
    "Instrument + recapture. Each shipped station is photographed with the",
    "elevated interior camera, then refineCameraForOcclusionAndContainment",
    "orbits inside the interior AABB until standing actors (world AABB height",
    ">= 1.15 m) are unoccluded and not left-clipped. Rooms, lights, materials,",
    "population, wait budgets, and existing interior/actor-band thresholds are",
    "unchanged. UI text bleeding over the canvas is named, not fixed here.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- generatedAt: ${input.generatedAt}`,
    `- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment`,
    `- compositor: buildContactSheet (isolated-subject-harness.ts)`,
    `- populationSource: shippedStationIds()`,
    `- population: ${String(input.stations.length)}`,
    `- cells: ${String(input.stations.length)}`,
    `- clearCells: ${String(clearCount)}`,
    `- beforeSource: ${BEFORE_CELLS_DIR_REL} at \`${BEFORE_TREE_SHA}\``,
    `- beforeFailCount: ${String(beforeFailCount)}`,
    `- namedBeforeFailCount: ${String(namedBeforeFail.length)} of ${String(namedBefore.length)}`,
    `- columns: ${String(input.columns)}`,
    `- cellWidth: ${String(input.cellWidth)}`,
    `- cellHeight: ${String(input.cellHeight)}`,
    `- contactSheet: ${input.contactSheetRel}`,
    `- contactSheetBytes: ${String(input.contactSheetBytes)}`,
    `- wallCenterPlasterFloor: ${WALL_CENTER_PLASTER_FLOOR.toFixed(2)} (sqrt(59.13 × 34.90))`,
    `- doorPctCeiling: ${DOOR_PCT_CEILING.toFixed(2)} (sqrt(26.20 × 7.69))`,
    `- standingSkinFloor: ${STANDING_SKIN_FLOOR.toFixed(2)} (sqrt(0.3 × 26.1))`,
    `- knownGood: ${CLEAR_KNOWN_GOOD_CASE_IDS.join(", ")}`,
    `- canvas: x 0..0.68 y 0.08..0.88`,
    "",
    "Count formula: cells = count(### `caseId` rows under ## Stations). framesClear",
    "= unobstructed (not wallOccluded and not doorOccluded) AND largest standing",
    "blob contained (!touchLeft). touchRight and touchBottom are reported, not",
    "gated. Per-actor blobs, not a band percentage. Recumbent bed actors may",
    "clip the left edge. HUD text overlay on the right of the 3D canvas is",
    "named, not gated.",
    "",
    `## Before (${BEFORE_CELLS_DIR_REL} at \`${BEFORE_TREE_SHA}\`)`,
    "",
    "Same instrument on the actor-frame PNGs this branch replaced. Named",
    "failures must stay failures here or the instrument does not bite.",
    "",
    ...beforeSections,
    "## Before / after",
    "",
    comparisonTable(before, input.stations),
    "",
    "L/R/B = largest standing blob touchLeft / touchRight / touchBottom on the",
    "3D canvas (x 0..0.68, y 0.08..0.88). anyR/anyB = any standing blob. Right",
    "and bottom are reported only; they do not enter framesClear.",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: native refined-interior captures of the fifteen shipped stations",
    "plus one labelled contact sheet; per-actor standing-blob containment and",
    "wall/door occlusion vs the 2026-09-12 actor-frame binding pair; before/after",
    `on ${BEFORE_CELLS_DIR_REL}.`,
    "notEvidenceFor: whether any room admits no camera position satisfying all",
    "four measures; whether the rooms read as clinically plausible spaces; Quest readiness;",
    "whether a sub-threshold sleeve at the canvas/HUD seam is a standing blob.",
    "",
    `CLAIM: ${String(namedBeforeFail.length)} of ${String(namedBefore.length)} named before-frames fail framesClear; ${String(clearCount)} of ${String(input.stations.length)} after-frames pass framesClear (!touchLeft). touchRight/touchBottom reported, not gated.`,
    "NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
  ].join("\n");
}

export async function assembleStationRoomClearSheet(): Promise<{
  contactSheetPath: string;
  reportPath: string;
  stations: ClearStationRow[];
}> {
  const caseIds = shippedStationIds();
  if (caseIds.length === 0) {
    throw new Error(
      "shippedStationIds() is empty; no learner-runtime-bundle.v1.json under apps/ui-xr/public/xr-assets/generated",
    );
  }
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-clear-${process.pid}-${Date.now()}`,
  );
  mkdirSync(jobTmp, { recursive: true });
  const reuseDir = process.env.OPENCLINXR_CLEAR_CAPTURE_DIR;
  const captureDir = reuseDir && reuseDir.length > 0 ? reuseDir : path.join(jobTmp, "capture");
  mkdirSync(captureDir, { recursive: true });

  const manifest: RoomCaptureManifest = reuseDir && reuseDir.length > 0
    ? JSON.parse(readFileSync(path.join(captureDir, "capture-manifest.json"), "utf8")) as RoomCaptureManifest
    : await captureStationEnvironmentRooms({
      scenarioIds: caseIds,
      outputDir: captureDir,
    });
  if (manifest.entries.length !== caseIds.length) {
    throw new Error(
      `capture wrote ${String(manifest.entries.length)} entries, expected ${String(caseIds.length)}`,
    );
  }

  const cellsDir = path.join(REPO_ROOT, CLEAR_CELLS_DIR_REL);
  mkdirSync(cellsDir, { recursive: true });

  const stations: ClearStationRow[] = [];
  const sheetCells: Array<{ imagePath: string; label: string }> = [];
  for (const caseId of caseIds) {
    const entry = manifest.entries.find((row) => row.scenarioId === caseId);
    if (entry === undefined) {
      throw new Error(`capture manifest missing ${caseId}`);
    }
    const src = path.join(captureDir, entry.imagePath);
    const destName = `${caseId}-room.png`;
    const dest = path.join(cellsDir, destName);
    copyFileSync(src, dest);
    const bytes = statSync(dest).size;
    const imageRel = `${CLEAR_CELLS_DIR_REL}/${destName}`;
    const png = new Uint8Array(readFileSync(dest));
    const metrics = measureOcclusionAndContainment(png);
    if (!metrics) {
      throw new Error(`could not decode clear cell ${imageRel}`);
    }
    const interior = measureInteriorCenter(png);
    if (!interior?.framesInterior) {
      throw new Error(
        `${caseId} clear recapture lost interior framing (centerSd=${String(interior?.sd)} beigePct=${String(interior?.beigePct)}; floors ${String(INTERIOR_SD_FLOOR)}/${String(BEIGE_CEILING)})`,
      );
    }
    stations.push(
      rowFromMetrics(caseId, imageRel, entry.liveShell.environmentId, bytes, metrics),
    );
    sheetCells.push({
      imagePath: dest,
      label: `${caseId}  ${entry.liveShell.environmentId}`,
    });
  }

  const contactAbs = path.join(REPO_ROOT, CLEAR_CONTACT_SHEET_REL);
  mkdirSync(path.dirname(contactAbs), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH, height: 800 },
      deviceScaleFactor: 1,
    });
    await buildContactSheet({
      page,
      cells: sheetCells,
      outPath: contactAbs,
      columns: CONTACT_SHEET_COLUMNS,
      cellWidth: CONTACT_SHEET_CELL_WIDTH,
      cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    });
  } finally {
    await browser.close();
  }

  const contactSheetBytes = statSync(contactAbs).size;
  if (contactSheetBytes < CONTACT_SHEET_MIN_BYTES) {
    throw new Error(
      `${CLEAR_CONTACT_SHEET_REL} is ${String(contactSheetBytes)} bytes, below card min-bytes ${String(CONTACT_SHEET_MIN_BYTES)}`,
    );
  }

  const beforeStations: ClearStationRow[] = [];
  for (const station of stations) {
    const beforeRel = `${BEFORE_CELLS_DIR_REL}/${station.caseId}-room.png`;
    const beforeAbs = path.join(REPO_ROOT, beforeRel);
    const beforePng = new Uint8Array(readFileSync(beforeAbs));
    const beforeMetrics = measureOcclusionAndContainment(beforePng);
    if (!beforeMetrics) {
      throw new Error(`could not decode before cell ${beforeRel}`);
    }
    beforeStations.push(
      rowFromMetrics(
        station.caseId,
        beforeRel,
        station.environmentId,
        statSync(beforeAbs).size,
        beforeMetrics,
      ),
    );
  }

  const report = renderClearReport({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: CLEAR_CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
    beforeStations,
  });
  const reportPath = path.join(REPO_ROOT, CLEAR_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(
    `wrote ${CLEAR_CONTACT_SHEET_REL} (${String(contactSheetBytes)} bytes)\nwrote ${CLEAR_REPORT_REL}\n`,
  );
  return { contactSheetPath: contactAbs, reportPath, stations };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("assemble-station-room-clear-sheet.ts")
    || process.argv[1].endsWith("assemble-station-room-clear-sheet.js"));

if (isDirectRun) {
  assembleStationRoomClearSheet().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
