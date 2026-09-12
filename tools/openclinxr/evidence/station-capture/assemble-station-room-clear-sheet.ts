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
  CLEAR_CELLS_DIR_REL,
  CLEAR_CONTACT_SHEET_REL,
  CLEAR_KNOWN_GOOD_CASE_IDS,
  CLEAR_REPORT_REL,
  DOOR_PCT_CEILING,
  STANDING_SKIN_FLOOR,
  WALL_CENTER_PLASTER_FLOOR,
  measureOcclusionAndContainment,
  type ClearStationRow,
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

export function renderClearReport(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly ClearStationRow[];
}): string {
  const sections = input.stations.map((station) => {
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
      `- largestStandingContained: ${String(station.largestStandingContained)}`,
      `- framesClear: ${String(station.framesClear)}`,
      "",
    ].join("\n");
  });
  const clearCount = input.stations.filter((row) => row.framesClear).length;
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
    "Count formula: cells = count(### `caseId` rows). framesClear = unobstructed",
    "(not wallOccluded and not doorOccluded) AND largest standing blob contained",
    "(!touchLeft and skinInHeadBandPct > standingSkinFloor). Per-actor blobs, not",
    "a band percentage. Recumbent bed actors may clip the left edge. HUD text",
    "overlay on the right of the 3D canvas is named, not gated.",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: native refined-interior captures of the fifteen shipped stations",
    "plus one labelled contact sheet; per-actor standing-blob containment and",
    "wall/door occlusion vs the 2026-09-12 actor-frame binding pair.",
    "notEvidenceFor: whether any room admits no camera position satisfying all",
    "four measures; whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
    `CLAIM: ${String(clearCount)} of ${String(input.stations.length)} shipped station captures have an unobstructed view of standing actors contained in the frame.`,
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
    const largest = metrics.standing[0];
    stations.push({
      caseId,
      imageRel,
      environmentId: entry.liveShell.environmentId,
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
      largestStandingContained: metrics.largestStandingContained,
      framesClear: metrics.framesClear,
    });
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

  const report = renderClearReport({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: CLEAR_CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
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
