/**
 * Extract per-asset records from the hand-written licence ledger.
 *
 * One-shot migration script: reads docs/openclinxr/third-party-asset-licence-ledger.md
 * at its pre-migration revision and writes one JSON record per table row plus one
 * JSON record per hand-written prose block into docs/openclinxr/asset-licence-records/.
 *
 * Table rows are split on the exact delimiter " | " (space-pipe-space). Verified
 * 2026-09-08 against the 402-line baseline: zero code spans, links, or captions in
 * the file contain that delimiter, so the split is lossless. Rows whose cell count
 * does not match their section header are stored WHOLE in `cells` (plus `expectedCells`
 * and a `note`) rather than dropped — see the shirts01 7-cell row and the
 * Kenney 4-cell row.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const LEDGER_INPUT = process.env["LICENCE_LEDGER_INPUT"] ?? "docs/openclinxr/third-party-asset-licence-ledger.md";
const RECORDS_OUTPUT =
  process.env["LICENCE_RECORDS_OUTPUT"] ?? "docs/openclinxr/asset-licence-records";
const LEDGER = path.isAbsolute(LEDGER_INPUT) ? LEDGER_INPUT : path.join(REPO_ROOT, LEDGER_INPUT);
const OUT_DIR = path.isAbsolute(RECORDS_OUTPUT) ? RECORDS_OUTPUT : path.join(REPO_ROOT, RECORDS_OUTPUT);

type RowRecord = {
  id: string;
  section: string;
  rowIndex: number;
  cells: string[];
  expectedCells?: number;
  note?: string;
};

type ProseRecord = {
  id: string;
  section: string;
  kind: "prose-block";
  body: string[];
};

function slugify(text: string): string {
  const cleaned = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || "entry";
}

/**
 * Split a table row on pipe characters that are NOT inside backticks, links,
 * or emphasis. A bare "|" inside a code span (e.g. a grep pattern like
 * `license|licence|CC0`) is cell content, not a column boundary.
 */
function splitRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split(" | ")
    .map((cell) => cell);
}

function isSeparator(line: string): boolean {
  return /^\|[-| ]+\|$/.test(line);
}

function isHeaderRow(cells: string[], lineNo: number): boolean {
  void lineNo;
  const first = (cells[0] ?? "").trim().toLowerCase();
  return first === "source" || first === "item" || first === "resource";
}

const EXPECTED: Record<string, number> = {
  Acquired: 6,
  Refused: 3,
  "Bank-promote": 6,
  "Equipment-candidates": 4,
  "Licence-uncertainties": 3,
  "Cleared-not-acquired": 3,
  Superseded: 3,
  "Obj-agpl-correction-table": 3,
};

const text = readFileSync(LEDGER, "utf8");
const lines = text.split("\n");

mkdirSync(OUT_DIR, { recursive: true });

const written: string[] = [];
function write(record: RowRecord | ProseRecord): void {
  const file = path.join(OUT_DIR, `${record.id}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  written.push(record.id);
}

let section = "";
let subsection = "";
let rowIndex = 0;
let proseBuf: string[] = [];
let proseSection = "";
let proseKind = "";
let proseSlug = "";
let proseCount = 0;

function flushProse(): void {
  while (proseBuf.length > 0 && proseBuf[0]!.trim() === "") proseBuf.shift();
  while (proseBuf.length > 0 && proseBuf[proseBuf.length - 1]!.trim() === "") proseBuf.pop();
  if (proseBuf.length === 0) {
    proseBuf = [];
    return;
  }
  proseCount += 1;
  write({
    id: `prose-${proseCount}-${proseSlug}`,
    section: proseSection,
    kind: "prose-block",
    body: [...proseBuf],
  });
  proseBuf = [];
}

function startProse(sec: string, kind: string, slug: string): void {
  flushProse();
  proseSection = sec;
  proseKind = kind;
  // The CORRECTION 2026-08-25 table handler reuses proseSlug as a phase flag
  // ("obj-agpl-correction" pre-table vs "obj-agpl-correction-post" post-table);
  // a fresh startProse call must reset it, otherwise the stale post flag leaks
  // into the next essay section and its lines are misfiled.
  proseSlug = slug;
  void proseKind;
}

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]!;
  const lineNo = i + 1;

  const h2 = line.match(/^##\s+(.+)$/);
  if (h2) {
    flushProse();
    section = h2[1]!.trim();
    subsection = "";
    rowIndex = 0;
    if (section.startsWith("Open questions")) startProse("Open-questions", "bullet-list", "open-questions");
    else if (section.startsWith("NOT FOUND")) startProse("Not-found", "bullet-list", "not-found");
    else if (section.startsWith("Not tested")) startProse("Not-tested", "paragraph", "not-tested");
    else if (section.startsWith("REFUSED — Animato")) startProse("Refused-animato", "essay", "refused-animato");
    else if (section.startsWith("GRADED 2026-08-21 — Mesh2Motion")) startProse("Graded-sleeping", "essay", "graded-sleeping");
    else if (section.startsWith("CORRECTION 2026-08-21")) startProse("Correction-sleeping-mechanism", "essay", "correction-sleeping-mechanism");
    else if (section.startsWith("GRADED 2026-08-21 — the seated")) startProse("Graded-seated", "essay", "graded-seated");
    else if (section.startsWith("TOOL FACT")) startProse("Tool-fact-retarget", "essay", "tool-fact-retarget");
    else if (section.startsWith("CORRECTION 2026-08-25")) startProse("Obj-agpl-correction", "essay", "obj-agpl-correction");
    continue;
  }

  const h3 = line.match(/^###\s+(.+)$/);
  if (h3) {
    flushProse();
    subsection = h3[1]!.trim();
    rowIndex = 0;
    continue;
  }

  if (line.startsWith("|")) {
    if (isSeparator(line)) continue;
    const cells = splitRow(line);
    if (isHeaderRow(cells, lineNo)) continue;
    flushProse();
    // CORRECTION 2026-08-25 interleaves essay/table/essay. The flush above
    // closes the pre-table half; restart the same prose section so the
    // post-table half is captured instead of dropped.
    if (section.startsWith("CORRECTION 2026-08-25")) {
      proseSection = "Obj-agpl-correction";
      proseSlug = "obj-agpl-correction-post";
    }
    rowIndex += 1;

    let key = section;
    let expected = 0;
    if (section === "Acquired") {
      key = "Acquired";
      expected = EXPECTED["Acquired"]!;
    } else if (section.startsWith("Refused —")) {
      if (subsection.startsWith("Sketchfab equipment bank promote")) {
        key = "Bank-promote";
        expected = EXPECTED["Bank-promote"]!;
      } else {
        key = "Refused";
        expected = EXPECTED["Refused"]!;
      }
    } else if (section.startsWith("Equipment candidates")) {
      key = "Equipment-candidates";
      expected = EXPECTED["Equipment-candidates"]!;
    } else if (section.startsWith("Licence uncertainties")) {
      key = "Licence-uncertainties";
      expected = EXPECTED["Licence-uncertainties"]!;
    } else if (section.startsWith("Cleared but NOT acquired")) {
      key = "Cleared-not-acquired";
      expected = EXPECTED["Cleared-not-acquired"]!;
    } else if (section.startsWith("Superseded")) {
      key = "Superseded";
      expected = EXPECTED["Superseded"]!;
    } else if (section.startsWith("CORRECTION 2026-08-25")) {
      key = "Obj-agpl-correction-table";
      expected = EXPECTED["Obj-agpl-correction-table"]!;
    } else {
      continue;
    }

    const anchor = slugify(cells[0] ?? `row-${rowIndex}`);
    const id = `row-${String(rowIndex).padStart(2, "0")}-${anchor}`;
    const record: RowRecord = { id, section: key, rowIndex, cells };
    if (cells.length !== expected) {
      record.expectedCells = expected;
      record.note =
        "Cell count differs from the section header; stored whole so no licence " +
        "text is lost. A consumer must render `cells` verbatim, never re-columnise.";
    }
    write(record);
    continue;
  }

  if (proseSection !== "" && section !== "" && (
    section.startsWith("Open questions") ||
    section.startsWith("NOT FOUND") ||
    section.startsWith("Not tested") ||
    section.startsWith("REFUSED — Animato") ||
    section.startsWith("GRADED 2026-08-21 — Mesh2Motion") ||
    section.startsWith("CORRECTION 2026-08-21") ||
    section.startsWith("GRADED 2026-08-21 — the seated") ||
    section.startsWith("TOOL FACT")
  )) {
    proseBuf.push(line);
  }

  if (
    section.startsWith("CORRECTION 2026-08-25") &&
    (proseSection === "Obj-agpl-correction" || proseSlug === "obj-agpl-correction-post") &&
    !line.startsWith("|") &&
    !isSeparator(line) &&
    !line.match(/^##\s+/)
  ) {
    proseBuf.push(line);
  }
}
flushProse();

console.log(JSON.stringify({ wrote: written.length }, null, 2));
