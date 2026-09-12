/**
 * Recapture the fifteen shipped stations with the elevated interior camera and
 * assemble one labelled contact sheet. Does not change rooms, lights, materials,
 * population, wait budgets, or interior-wall thresholds.
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
  ACTOR_CELLS_DIR_REL,
  ACTOR_CONTACT_SHEET_REL,
  ACTOR_FRAMING_REPORT_REL,
  ACTOR_KNOWN_GOOD_CASE_IDS,
  HEAD_FIGURE_FLOOR,
  measureActorFrame,
  type ActorFramingStationRow,
} from "./actor-frame-metrics.js";
import { INTERIOR_SD_FLOOR, BEIGE_CEILING, measureInteriorCenter } from "./interior-frame-metrics.js";

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

export function renderActorFramingReport(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly ActorFramingStationRow[];
}): string {
  const sections = input.stations.map((station) => {
    return [
      `### \`${station.caseId}\``,
      `- image: ${station.imageRel}`,
      `- environmentId: ${station.environmentId}`,
      `- bytes: ${String(station.bytes)}`,
      `- headFigurePct: ${station.headFigurePct.toFixed(2)}`,
      `- floorFloorPct: ${station.floorFloorPct.toFixed(2)}`,
      `- bottomFigurePct: ${station.bottomFigurePct.toFixed(2)}`,
      `- framesActors: ${String(station.framesActors)}`,
      "",
    ].join("\n");
  });
  const actorCount = input.stations.filter((row) => row.framesActors).length;
  return [
    "# Station room actor framing (2026-09-12)",
    "",
    "Instrument + recapture. Each shipped station is photographed with the",
    "elevated interior camera (reframeCameraForRoom: eyeY standing-eye 1.68 m",
    "capped 0.5 m below the ceiling, look y=1.0; 2.0 m readable nearest-actor",
    "floor; zMid candidate ring; floor/ceiling tris do not reject) so people",
    "visible. Rooms, lights, materials, population, wait budgets, and",
    "interior-wall thresholds are unchanged.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- generatedAt: ${input.generatedAt}`,
    `- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom`,
    `- compositor: buildContactSheet (isolated-subject-harness.ts)`,
    `- populationSource: shippedStationIds()`,
    `- population: ${String(input.stations.length)}`,
    `- cells: ${String(input.stations.length)}`,
    `- actorCells: ${String(actorCount)}`,
    `- columns: ${String(input.columns)}`,
    `- cellWidth: ${String(input.cellWidth)}`,
    `- cellHeight: ${String(input.cellHeight)}`,
    `- contactSheet: ${input.contactSheetRel}`,
    `- contactSheetBytes: ${String(input.contactSheetBytes)}`,
    `- headFigureFloor: ${HEAD_FIGURE_FLOOR.toFixed(2)} (sqrt(1.91 × 9.11))`,
    `- knownGood: ${ACTOR_KNOWN_GOOD_CASE_IDS.join(", ")}`,
    `- headBand: y 0.08..0.64 of the 1440×900 frame (upper 70% of 3D canvas)`,
    `- canvas: x 0..0.68 y 0.08..0.88`,
    "",
    "Count formula: cells = count(### `caseId` rows). framesActors = headFigurePct >",
    "headFigureFloor. It is not a clinical grade.",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: native elevated-interior captures of the fifteen shipped stations",
    "plus one labelled contact sheet; upper-canvas figure occupancy vs the",
    "shin-crop / known-good binding pair measured on the 2026-09-12 interior frames.",
    "notEvidenceFor: whether any environment is too small to frame its actors legally;",
    "whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
    `CLAIM: ${String(actorCount)} of ${String(input.stations.length)} shipped station captures frame actors head-to-foot (headFigurePct > ${HEAD_FIGURE_FLOOR.toFixed(2)}).`,
    "NOT TESTED: Whether any environment is too small to frame its actors legally; whether the rooms read as clinically plausible spaces; Quest readiness.",
    "",
  ].join("\n");
}

export async function assembleStationRoomActorSheet(): Promise<{
  contactSheetPath: string;
  reportPath: string;
  stations: ActorFramingStationRow[];
}> {
  const caseIds = shippedStationIds();
  if (caseIds.length === 0) {
    throw new Error(
      "shippedStationIds() is empty; no learner-runtime-bundle.v1.json under apps/ui-xr/public/xr-assets/generated",
    );
  }
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-actors-${process.pid}-${Date.now()}`,
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

  const cellsDir = path.join(REPO_ROOT, ACTOR_CELLS_DIR_REL);
  mkdirSync(cellsDir, { recursive: true });

  const stations: ActorFramingStationRow[] = [];
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
    const imageRel = `${ACTOR_CELLS_DIR_REL}/${destName}`;
    const png = new Uint8Array(readFileSync(dest));
    const metrics = measureActorFrame(png);
    if (!metrics) {
      throw new Error(`could not decode actor cell ${imageRel}`);
    }
    const interior = measureInteriorCenter(png);
    if (!interior?.framesInterior) {
      throw new Error(
        `${caseId} actor recapture no longer frames the interior (centerSd=${String(interior?.sd)} beigePct=${String(interior?.beigePct)}; floors ${String(INTERIOR_SD_FLOOR)}/${String(BEIGE_CEILING)})`,
      );
    }
    stations.push({
      caseId,
      imageRel,
      environmentId: entry.liveShell.environmentId,
      bytes,
      headFigurePct: metrics.headFigurePct,
      floorFloorPct: metrics.floorFloorPct,
      bottomFigurePct: metrics.bottomFigurePct,
      framesActors: metrics.framesActors,
    });
    sheetCells.push({
      imagePath: dest,
      label: `${caseId}  ${entry.liveShell.environmentId}`,
    });
  }

  const contactAbs = path.join(REPO_ROOT, ACTOR_CONTACT_SHEET_REL);
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
      `${ACTOR_CONTACT_SHEET_REL} is ${String(contactSheetBytes)} bytes, below card min-bytes ${String(CONTACT_SHEET_MIN_BYTES)}`,
    );
  }

  const report = renderActorFramingReport({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: ACTOR_CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
  });
  const reportPath = path.join(REPO_ROOT, ACTOR_FRAMING_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(
    `wrote ${ACTOR_CONTACT_SHEET_REL} (${String(contactSheetBytes)} bytes)\nwrote ${ACTOR_FRAMING_REPORT_REL}\n`,
  );
  return { contactSheetPath: contactAbs, reportPath, stations };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("assemble-station-room-actor-sheet.ts")
    || process.argv[1].endsWith("assemble-station-room-actor-sheet.js"));

if (isDirectRun) {
  assembleStationRoomActorSheet().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
