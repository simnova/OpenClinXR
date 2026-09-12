/**
 * Copy the fifteen rendered station rooms into tracked PNGs and one labelled
 * contact sheet. Uses captureStationEnvironmentRooms and buildContactSheet
 * unchanged. Does not grade appearance, change wait budgets, or repair rooms.
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
import { parseStationRows } from "./sweep-renders-after-client-graph-fix.js";

export const CONTACT_SHEET_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-contact-sheet-2026-09-12.png";
export const GRADE_SET_REL =
  "tools/openclinxr/evidence/station-capture/station-room-grade-set-2026-09-12.md";
export const CELLS_DIR_REL =
  "docs/openclinxr/humanoid-vetting-captures/station-rooms-2026-09-12";

/** Card min-bytes:200000 — a 15-cell labelled sheet of 1440×900 captures, not a fitted floor. */
export const CONTACT_SHEET_MIN_BYTES = 200_000;
export const CONTACT_SHEET_COLUMNS = 5;
export const CONTACT_SHEET_CELL_WIDTH = 640;
export const CONTACT_SHEET_CELL_HEIGHT = 400;
export const CONTACT_SHEET_LABEL_HEIGHT = 36;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export type GradeSetStation = {
  caseId: string;
  imageRel: string;
  environmentId: string;
  bytes: number;
  durationMs: number | null;
};

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

export function parseGradeSetCellHeadline(body: string): number | null {
  const match = body.match(/^- cells: (\d+)$/m);
  if (!match) return null;
  return Number(match[1]);
}

export function parseGradeSetStations(body: string): GradeSetStation[] {
  const rows: GradeSetStation[] = [];
  const heading = /^### `([^`]+)`$/gm;
  const ids: Array<{ id: string; index: number }> = [];
  for (const match of body.matchAll(heading)) {
    const id = match[1];
    if (id === undefined || match.index === undefined) continue;
    ids.push({ id, index: match.index });
  }
  for (let i = 0; i < ids.length; i += 1) {
    const start = ids[i];
    if (start === undefined) continue;
    const end = ids[i + 1]?.index ?? body.length;
    const block = body.slice(start.index, end);
    const imageRel = block.match(/^- image: (.+)$/m)?.[1]?.trim() ?? "";
    const environmentId = block.match(/^- environmentId: (.+)$/m)?.[1]?.trim() ?? "";
    const bytes = Number(block.match(/^- bytes: (\d+)$/m)?.[1] ?? "NaN");
    const durationRaw = block.match(/^- durationMs: (.+)$/m)?.[1]?.trim() ?? "";
    const durationMs = durationRaw === "(none)" ? null : Number(durationRaw);
    rows.push({
      caseId: start.id,
      imageRel,
      environmentId,
      bytes,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
    });
  }
  return rows;
}

function durationByCaseFromSweep(body: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of parseStationRows(body)) {
    if (Number.isFinite(row.durationMs)) map.set(row.caseId, row.durationMs);
  }
  return map;
}

export function renderGradeSet(input: {
  treeSha: string;
  generatedAt: string;
  contactSheetRel: string;
  contactSheetBytes: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  stations: readonly GradeSetStation[];
}): string {
  const sections = input.stations.map((station) => {
    const duration = station.durationMs === null ? "(none)" : String(station.durationMs);
    return [
      `### \`${station.caseId}\``,
      `- image: ${station.imageRel}`,
      `- environmentId: ${station.environmentId}`,
      `- bytes: ${String(station.bytes)}`,
      `- durationMs: ${duration}`,
      "",
    ].join("\n");
  });
  return [
    "# Station room grade set (2026-09-12)",
    "",
    "Instrument-only. The fifteen shipped station-environment captures are copied",
    "to tracked PNGs and assembled into one labelled contact sheet so a human can",
    "look at them. This file does not grade appearance, change capture code,",
    "predicates, or budgets, or fix anything a capture reveals.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- generatedAt: ${input.generatedAt}`,
    `- renderer: captureStationEnvironmentRooms scene-overview (unchanged)`,
    `- compositor: buildContactSheet (isolated-subject-harness.ts)`,
    `- populationSource: shippedStationIds()`,
    `- population: ${String(input.stations.length)}`,
    `- cells: ${String(input.stations.length)}`,
    `- columns: ${String(input.columns)}`,
    `- cellWidth: ${String(input.cellWidth)}`,
    `- cellHeight: ${String(input.cellHeight)}`,
    `- contactSheet: ${input.contactSheetRel}`,
    `- contactSheetBytes: ${String(input.contactSheetBytes)}`,
    "",
    "Count formula: cells = count(### `caseId` rows). It is not a pixel grade.",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: tracked copies of the fifteen shipped station-environment captures",
    "plus one labelled contact sheet assembled from those copies.",
    "notEvidenceFor: whether any room reads as a clinical space; capture-code,",
    "predicate, or wait-budget changes; Quest readiness; pixel quality.",
    "",
    `CLAIM: ${String(input.stations.length)} shipped station rooms are tracked PNGs and one contact sheet.`,
    "NOT TESTED: Whether any room reads as a clinical space — that judgement is the orchestrator's and is not made here.",
    "",
  ].join("\n");
}

export async function assembleStationRoomGradeSet(): Promise<{
  contactSheetPath: string;
  gradeSetPath: string;
  stations: GradeSetStation[];
}> {
  const caseIds = shippedStationIds();
  if (caseIds.length === 0) {
    throw new Error(
      "shippedStationIds() is empty; no learner-runtime-bundle.v1.json under apps/ui-xr/public/xr-assets/generated",
    );
  }
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-grade-set-${process.pid}-${Date.now()}`,
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

  const cellsDir = path.join(REPO_ROOT, CELLS_DIR_REL);
  mkdirSync(cellsDir, { recursive: true });
  const sweepPath = path.join(
    REPO_ROOT,
    "tools/openclinxr/evidence/station-capture/render-sweep-after-the-client-graph-fix-2026-09-12.md",
  );
  const sweepDurations = durationByCaseFromSweep(readFileSync(sweepPath, "utf8"));

  const stations: GradeSetStation[] = [];
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
    const imageRel = `${CELLS_DIR_REL}/${destName}`;
    stations.push({
      caseId,
      imageRel,
      environmentId: entry.liveShell.environmentId,
      bytes,
      durationMs: sweepDurations.get(caseId) ?? null,
    });
    sheetCells.push({
      imagePath: dest,
      label: `${caseId}  ${entry.liveShell.environmentId}`,
    });
  }

  const contactAbs = path.join(REPO_ROOT, CONTACT_SHEET_REL);
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
      `${CONTACT_SHEET_REL} is ${String(contactSheetBytes)} bytes, below card min-bytes ${String(CONTACT_SHEET_MIN_BYTES)}`,
    );
  }

  const gradeSet = renderGradeSet({
    treeSha: gitSha(),
    generatedAt: manifest.generatedAt,
    contactSheetRel: CONTACT_SHEET_REL,
    contactSheetBytes,
    columns: CONTACT_SHEET_COLUMNS,
    cellWidth: CONTACT_SHEET_CELL_WIDTH,
    cellHeight: CONTACT_SHEET_CELL_HEIGHT,
    stations,
  });
  const gradeSetPath = path.join(REPO_ROOT, GRADE_SET_REL);
  writeFileSync(gradeSetPath, gradeSet, "utf8");
  process.stdout.write(
    `wrote ${CONTACT_SHEET_REL} (${String(contactSheetBytes)} bytes)\nwrote ${GRADE_SET_REL}\n`,
  );
  return { contactSheetPath: contactAbs, gradeSetPath, stations };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("assemble-station-room-grade-set.ts")
    || process.argv[1].endsWith("assemble-station-room-grade-set.js"));

if (isDirectRun) {
  assembleStationRoomGradeSet().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
