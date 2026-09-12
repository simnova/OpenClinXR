/**
 * Recapture the fifteen shipped stations with the interior-framing camera and
 * assemble one labelled contact sheet. Does not change rooms, lights, materials,
 * population, or wait budgets.
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
  BEIGE_CEILING,
  FRAMING_REPORT_REL,
  INTERIOR_CELLS_DIR_REL,
  INTERIOR_CONTACT_SHEET_REL,
  INTERIOR_SD_FLOOR,
  KNOWN_GOOD_CASE_IDS,
  measureInteriorCenter,
  type FramingStationRow,
} from "./interior-frame-metrics.js";

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

export function renderFramingReport(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly FramingStationRow[];
}): string {
  const sections = input.stations.map((station) => {
    return [
      `### \`${station.caseId}\``,
      `- image: ${station.imageRel}`,
      `- environmentId: ${station.environmentId}`,
      `- bytes: ${String(station.bytes)}`,
      `- centerSd: ${station.sd.toFixed(1)}`,
      `- beigePct: ${station.beigePct.toFixed(1)}`,
      `- edgePct: ${station.edgePct.toFixed(1)}`,
      `- framesInterior: ${String(station.framesInterior)}`,
      "",
    ].join("\n");
  });
  const interiorCount = input.stations.filter((row) => row.framesInterior).length;
  return [
    "# Station room interior framing (2026-09-12)",
    "",
    "Instrument + recapture. Each shipped station is photographed with the",
    "interior-framing camera (reframeCameraForRoom: min stand-off 2× known-good",
    "ED +Z thickness 0.1245 m; no rejected-viewpoint pool) and assembled into",
    "one labelled contact sheet. Rooms, lights, materials, population, and",
    "wait budgets are unchanged.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- generatedAt: ${input.generatedAt}`,
    `- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom`,
    `- compositor: buildContactSheet (isolated-subject-harness.ts)`,
    `- populationSource: shippedStationIds()`,
    `- population: ${String(input.stations.length)}`,
    `- cells: ${String(input.stations.length)}`,
    `- interiorCells: ${String(interiorCount)}`,
    `- columns: ${String(input.columns)}`,
    `- cellWidth: ${String(input.cellWidth)}`,
    `- cellHeight: ${String(input.cellHeight)}`,
    `- contactSheet: ${input.contactSheetRel}`,
    `- contactSheetBytes: ${String(input.contactSheetBytes)}`,
    `- interiorSdFloor: ${INTERIOR_SD_FLOOR.toFixed(2)} (sqrt(24.5 × 44.9))`,
    `- beigeCeiling: ${BEIGE_CEILING.toFixed(2)} ((93.0 + 47.1) / 2)`,
    `- knownGood: ${KNOWN_GOOD_CASE_IDS.join(", ")}`,
    `- centerRegion: left 0.22 top 0.12 width 0.44 height 0.70 of the 1440×900 frame`,
    "",
    "Count formula: cells = count(### `caseId` rows). framesInterior = centerSd >",
    "interiorSdFloor AND beigePct < beigeCeiling. It is not a clinical grade.",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: native interior-framed captures of the fifteen shipped stations",
    "plus one labelled contact sheet; center-viewport occupancy vs the wall/interior",
    "binding pair measured on the 2026-09-12 doorway-wall frames.",
    "notEvidenceFor: whether any environment genuinely lacks clinical furniture;",
    "Quest readiness; whether the rooms read as clinically plausible spaces.",
    "",
    `CLAIM: ${String(interiorCount)} of ${String(input.stations.length)} shipped station captures frame the room interior (centerSd > ${INTERIOR_SD_FLOOR.toFixed(2)}, beigePct < ${BEIGE_CEILING.toFixed(2)}).`,
    "NOT TESTED: Whether any environment genuinely lacks clinical furniture; Quest readiness; whether the rooms read as clinically plausible spaces.",
    "",
  ].join("\n");
}

export async function assembleStationRoomInteriorSheet(): Promise<{
  contactSheetPath: string;
  reportPath: string;
  stations: FramingStationRow[];
}> {
  const caseIds = shippedStationIds();
  if (caseIds.length === 0) {
    throw new Error(
      "shippedStationIds() is empty; no learner-runtime-bundle.v1.json under apps/ui-xr/public/xr-assets/generated",
    );
  }
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-interior-${process.pid}-${Date.now()}`,
  );
  mkdirSync(jobTmp, { recursive: true });
  const captureDir = path.join(jobTmp, "capture");
  mkdirSync(captureDir, { recursive: true });

  const manifest: RoomCaptureManifest = await captureStationEnvironmentRooms({
    scenarioIds: caseIds,
    outputDir: captureDir,
  });
  if (manifest.entries.length !== caseIds.length) {
    throw new Error(
      `capture wrote ${String(manifest.entries.length)} entries, expected ${String(caseIds.length)}`,
    );
  }

  const cellsDir = path.join(REPO_ROOT, INTERIOR_CELLS_DIR_REL);
  mkdirSync(cellsDir, { recursive: true });

  const stations: FramingStationRow[] = [];
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
    const imageRel = `${INTERIOR_CELLS_DIR_REL}/${destName}`;
    const metrics = measureInteriorCenter(new Uint8Array(readFileSync(dest)));
    if (!metrics) {
      throw new Error(`could not decode interior cell ${imageRel}`);
    }
    stations.push({
      caseId,
      imageRel,
      environmentId: entry.liveShell.environmentId,
      bytes,
      sd: metrics.sd,
      beigePct: metrics.beigePct,
      edgePct: metrics.edgePct,
      framesInterior: metrics.framesInterior,
    });
    sheetCells.push({
      imagePath: dest,
      label: `${caseId}  ${entry.liveShell.environmentId}`,
    });
  }

  const contactAbs = path.join(REPO_ROOT, INTERIOR_CONTACT_SHEET_REL);
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
      `${INTERIOR_CONTACT_SHEET_REL} is ${String(contactSheetBytes)} bytes, below card min-bytes ${String(CONTACT_SHEET_MIN_BYTES)}`,
    );
  }

  const report = renderFramingReport({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: INTERIOR_CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
  });
  const reportPath = path.join(REPO_ROOT, FRAMING_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(
    `wrote ${INTERIOR_CONTACT_SHEET_REL} (${String(contactSheetBytes)} bytes)\nwrote ${FRAMING_REPORT_REL}\n`,
  );
  return { contactSheetPath: contactAbs, reportPath, stations };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("assemble-station-room-interior-sheet.ts")
    || process.argv[1].endsWith("assemble-station-room-interior-sheet.js"));

if (isDirectRun) {
  assembleStationRoomInteriorSheet().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
