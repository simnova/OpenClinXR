/**
 * Recapture the fifteen shipped stations so standing actors sit inside all
 * four 3D-canvas edges, then assemble one labelled contact sheet. Does not
 * change rooms, lights, materials, population, wait budgets, or existing
 * interior/actor-band thresholds. Recumbent blobs stay ungated.
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
import { rowFromMetrics } from "./assemble-station-room-clear-sheet.js";
import { measureActorFrame } from "./actor-frame-metrics.js";
import { BEIGE_CEILING, INTERIOR_SD_FLOOR, measureInteriorCenter } from "./interior-frame-metrics.js";
import {
  CLEAR_CELLS_DIR_REL,
  WHOLE_CELLS_DIR_REL,
  WHOLE_CONTACT_SHEET_REL,
  WHOLE_KNOWN_GOOD_CASE_IDS,
  WHOLE_NAMED_FAIL_CASE_ID,
  WHOLE_REPORT_REL,
  measureOcclusionAndContainment,
  type ClearStationRow,
} from "./occlusion-and-containment-metrics.js";

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

function anyLrtb(row: ClearStationRow): string {
  return `${yn(row.anyStandingTouchLeft)}/${yn(row.anyStandingTouchRight)}/${yn(row.anyStandingTouchTop)}/${yn(row.anyStandingTouchBottom)}`;
}

function skinnedLrtb(row: ClearStationRow): string {
  return `${yn(row.skinnedTouchLeft)}/${yn(row.skinnedTouchRight)}/${yn(row.skinnedTouchTop)}/${yn(row.skinnedTouchBottom)}`;
}

function parseRefineNote(note: string): { placardBack: boolean | null; meanFacingDeg: number | null } {
  const placard = note.match(/placardBack=([01])/);
  const facing = note.match(/meanFacingDeg=([0-9.]+)/);
  return {
    placardBack: placard ? placard[1] === "1" : null,
    meanFacingDeg: facing ? Number(facing[1]) : null,
  };
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
    `- largestStandingTouchTop: ${String(station.largestStandingTouchTop)}`,
    `- anyStandingTouchLeft: ${String(station.anyStandingTouchLeft)}`,
    `- anyStandingTouchRight: ${String(station.anyStandingTouchRight)}`,
    `- anyStandingTouchBottom: ${String(station.anyStandingTouchBottom)}`,
    `- anyStandingTouchTop: ${String(station.anyStandingTouchTop)}`,
    `- largestStandingContained: ${String(station.largestStandingContained)}`,
    `- fourEdgeContained: ${String(station.fourEdgeContained)}`,
    `- skinnedTouchLeft: ${String(station.skinnedTouchLeft)}`,
    `- skinnedTouchRight: ${String(station.skinnedTouchRight)}`,
    `- skinnedTouchTop: ${String(station.skinnedTouchTop)}`,
    `- skinnedTouchBottom: ${String(station.skinnedTouchBottom)}`,
    `- framesClear: ${String(station.framesClear)}`,
    `- framesWhole: ${String(station.framesWhole)}`,
    `- placardBack: ${station.placardBack === null ? "null" : String(station.placardBack)}`,
    `- meanFacingDeg: ${station.meanFacingDeg === null ? "null" : station.meanFacingDeg.toFixed(1)}`,
    `- framesActors: ${station.framesActors === null ? "null" : String(station.framesActors)}`,
    "",
  ].join("\n");
}

function residualNote(stations: readonly ClearStationRow[]): string {
  const adult = stations.find((row) => row.caseId === "adult_abdominal_pain_v1");
  const adultLine = adult?.framesWhole
    ? `adult_abdominal_pain_v1 now framesWhole on the doorway-side camera (skinned L/R/T/B=${skinnedLrtb(adult)} skinPct=${adult.largestStandingSkinPct.toFixed(2)} placardBack=${String(adult.placardBack)} meanFacingDeg=${adult.meanFacingDeg === null ? "null" : adult.meanFacingDeg.toFixed(1)}).`
    : adult
      ? [
          `Residual adult_abdominal_pain_v1: framesWhole=false on the doorway-side camera.`,
          `skinned L/R/T/B=${skinnedLrtb(adult)} skinPct=${adult.largestStandingSkinPct.toFixed(2)}`,
          `unobstructed=${String(adult.unobstructed)} framesActors=${String(adult.framesActors)}`,
          `placardBack=${String(adult.placardBack)} meanFacingDeg=${adult.meanFacingDeg === null ? "null" : adult.meanFacingDeg.toFixed(1)}.`,
          "CLEAR skinned blob already touched bottom (n/n/n/Y, skin 9.4). A behind-placard retreat is refused.",
        ].join(" ")
      : "";
  const residual = stations.filter((row) => !row.framesWhole && row.caseId !== "adult_abdominal_pain_v1");
  const rest = residual.map((row) => {
    return [
      `Residual ${row.caseId}: framesWhole=false on the doorway-side camera.`,
      `skinned L/R/T/B=${skinnedLrtb(row)} skinPct=${row.largestStandingSkinPct.toFixed(2)}`,
      `unobstructed=${String(row.unobstructed)} framesActors=${String(row.framesActors)}`,
      `placardBack=${String(row.placardBack)} meanFacingDeg=${row.meanFacingDeg === null ? "null" : row.meanFacingDeg.toFixed(1)}.`,
      "A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.",
    ].join(" ");
  });
  return [adultLine, ...rest].filter((line) => line.length > 0).join("\n");
}

function comparisonTable(
  before: readonly ClearStationRow[],
  after: readonly ClearStationRow[],
): string {
  const header = [
    "| case | before whole | after whole | before skinned L/R/T/B | after skinned L/R/T/B | before any L/R/T/B | after any L/R/T/B | placardBack | meanFacingDeg |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const lines = after.map((aft) => {
    const bef = before.find((row) => row.caseId === aft.caseId);
    const facing = aft.meanFacingDeg === null ? "—" : aft.meanFacingDeg.toFixed(1);
    const placard = aft.placardBack === null ? "—" : String(aft.placardBack);
    return `| ${aft.caseId} | ${String(bef?.framesWhole ?? "—")} | ${String(aft.framesWhole)} | ${bef ? skinnedLrtb(bef) : "—"} | ${skinnedLrtb(aft)} | ${bef ? anyLrtb(bef) : "—"} | ${anyLrtb(aft)} | ${placard} | ${facing} |`;
  });
  return [...header, ...lines].join("\n");
}

export function renderWholeReport(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly ClearStationRow[];
  beforeStations: readonly ClearStationRow[];
}): string {
  const sections = input.stations.map((station) => stationBlock(station));
  const beforeSections = input.beforeStations.map((station) => stationBlock(station));
  const wholeCount = input.stations.filter((row) => row.framesWhole).length;
  const beforeFailCount = input.beforeStations.filter((row) => !row.framesWhole).length;
  const namedBefore = input.beforeStations.filter((row) => row.caseId === WHOLE_NAMED_FAIL_CASE_ID);
  const namedBeforeFail = namedBefore.filter((row) => !row.framesWhole);
  const beforeBottom = input.beforeStations.filter((row) => row.anyStandingTouchBottom).length;
  const beforeRight = input.beforeStations.filter((row) => row.anyStandingTouchRight).length;
  return [
    "# Station room four-edge containment (2026-09-12)",
    "",
    "Instrument + recapture. framesClear still gates the left edge only.",
    "framesWhole requires the largest skinned standing blob (skinInHeadBandPct",
    "> STANDING_SKIN_FLOOR) inside all four 3D-canvas edges. Recumbent",
    "blobs stay ungated. Rooms, lights, materials, population, wait budgets,",
    "and existing interior/actor-band thresholds are unchanged.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- generatedAt: ${input.generatedAt}`,
    `- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment`,
    `- compositor: buildContactSheet (isolated-subject-harness.ts)`,
    `- populationSource: shippedStationIds()`,
    `- population: ${String(input.stations.length)}`,
    `- cells: ${String(input.stations.length)}`,
    `- wholeCells: ${String(wholeCount)}`,
    `- beforeSource: ${CLEAR_CELLS_DIR_REL}`,
    `- beforeFailCount: ${String(beforeFailCount)}`,
    `- namedBeforeFailCount: ${String(namedBeforeFail.length)} of ${String(namedBefore.length)}`,
    `- beforeAnyStandingTouchBottom: ${String(beforeBottom)}`,
    `- beforeAnyStandingTouchRight: ${String(beforeRight)}`,
    `- columns: ${String(input.columns)}`,
    `- cellWidth: ${String(input.cellWidth)}`,
    `- cellHeight: ${String(input.cellHeight)}`,
    `- contactSheet: ${input.contactSheetRel}`,
    `- contactSheetBytes: ${String(input.contactSheetBytes)}`,
    `- knownGood: ${WHOLE_KNOWN_GOOD_CASE_IDS.join(", ")}`,
    `- namedFail: ${WHOLE_NAMED_FAIL_CASE_ID}`,
    `- canvas: x 0..0.68 y 0.08..0.88`,
    "",
    "Count formula: cells = count(### `caseId` rows under ## Stations).",
    "framesWhole = unobstructed AND largest skinned standing blob fourEdgeContained.",
    "skinned L/R/T/B = the largest blob with skinInHeadBandPct > STANDING_SKIN_FLOOR",
    "(the blob framesWhole uses). any L/R/T/B = any standing chroma blob, including",
    "furniture-sized components. ed_chest_pain_priority_v1 can be whole true while",
    "any L/R/T/B is Y because a non-skinned blob clips; that is not a gate bug.",
    "placardBack = pre-encounter / scenario-expectation panel is between camera and",
    "actors with its back face toward the camera (mirrored text). meanFacingDeg =",
    "mean angle between standing-actor heading (-Z) and camera, 0 = facing camera.",
    "HUD overlay on the screenshot right of the 3D canvas is not a frame edge.",
    residualNote(input.stations),
    "",
    `## Before (${CLEAR_CELLS_DIR_REL})`,
    "",
    "Same four-edge instrument on the left-only CLEAR recapture. Named",
    "failures must stay failures here or the instrument does not bite.",
    "",
    ...beforeSections,
    "## Before / after",
    "",
    comparisonTable(input.beforeStations, input.stations),
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: native four-edge recapture of the fifteen shipped stations",
    "plus one labelled contact sheet; standing-blob L/R/T/B vs the 2026-09-12",
    `CLEAR cells under ${CLEAR_CELLS_DIR_REL}.`,
    "notEvidenceFor: whether any room admits no camera position satisfying all",
    "four measures; whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
    `CLAIM: ${String(namedBeforeFail.length)} of ${String(namedBefore.length)} named before-frames fail framesWhole; ${String(beforeBottom)} of ${String(input.beforeStations.length)} before-frames anyStandingTouchBottom; ${String(beforeRight)} of ${String(input.beforeStations.length)} anyStandingTouchRight; ${String(wholeCount)} of ${String(input.stations.length)} after-frames pass framesWhole.`,
    "NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
  ].join("\n");
}

export async function assembleStationRoomWholeSheet(): Promise<{
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
    `ocxr-station-whole-${process.pid}-${Date.now()}`,
  );
  mkdirSync(jobTmp, { recursive: true });
  const reuseDir = process.env.OPENCLINXR_WHOLE_CAPTURE_DIR;
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

  const cellsDir = path.join(REPO_ROOT, WHOLE_CELLS_DIR_REL);
  mkdirSync(cellsDir, { recursive: true });

  const stations: ClearStationRow[] = [];
  const sheetCells: Array<{ imagePath: string; label: string }> = [];
  for (const caseId of caseIds) {
    const entry = manifest.entries.find((manifestRow) => manifestRow.scenarioId === caseId);
    if (entry === undefined) {
      throw new Error(`capture manifest missing ${caseId}`);
    }
    const src = path.join(captureDir, entry.imagePath);
    const destName = `${caseId}-room.png`;
    const dest = path.join(cellsDir, destName);
    copyFileSync(src, dest);
    const bytes = statSync(dest).size;
    const imageRel = `${WHOLE_CELLS_DIR_REL}/${destName}`;
    const png = new Uint8Array(readFileSync(dest));
    const metrics = measureOcclusionAndContainment(png);
    if (!metrics) {
      throw new Error(`could not decode whole cell ${imageRel}`);
    }
    const interior = measureInteriorCenter(png);
    if (!interior?.framesInterior) {
      throw new Error(
        `${caseId} whole recapture lost interior framing (centerSd=${String(interior?.sd)} beigePct=${String(interior?.beigePct)}; floors ${String(INTERIOR_SD_FLOOR)}/${String(BEIGE_CEILING)})`,
      );
    }
    const row = rowFromMetrics(caseId, imageRel, entry.liveShell.environmentId, bytes, metrics);
    const refine = parseRefineNote(entry.liveShell.cameraFraming ?? "");
    const actors = measureActorFrame(png);
    row.placardBack = refine.placardBack;
    row.meanFacingDeg = refine.meanFacingDeg;
    row.framesActors = actors?.framesActors ?? null;
    stations.push(row);
    sheetCells.push({
      imagePath: dest,
      label: `${caseId}  ${entry.liveShell.environmentId}`,
    });
  }

  const contactAbs = path.join(REPO_ROOT, WHOLE_CONTACT_SHEET_REL);
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
      `${WHOLE_CONTACT_SHEET_REL} is ${String(contactSheetBytes)} bytes, below card min-bytes ${String(CONTACT_SHEET_MIN_BYTES)}`,
    );
  }

  const beforeStations: ClearStationRow[] = [];
  for (const station of stations) {
    const beforeRel = `${CLEAR_CELLS_DIR_REL}/${station.caseId}-room.png`;
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

  const report = renderWholeReport({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: WHOLE_CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
    beforeStations,
  });
  const reportPath = path.join(REPO_ROOT, WHOLE_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(
    `wrote ${WHOLE_CONTACT_SHEET_REL} (${String(contactSheetBytes)} bytes)\nwrote ${WHOLE_REPORT_REL}\n`,
  );
  return { contactSheetPath: contactAbs, reportPath, stations };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("assemble-station-room-whole-sheet.ts")
    || process.argv[1].endsWith("assemble-station-room-whole-sheet.js"));

if (isDirectRun) {
  assembleStationRoomWholeSheet().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
