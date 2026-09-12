import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.js";
import { shippedStationIds } from "../ui-xr-environment-room-capture.js";
import {
  CELLS_DIR_REL,
  CONTACT_SHEET_CELL_HEIGHT,
  CONTACT_SHEET_CELL_WIDTH,
  CONTACT_SHEET_COLUMNS,
  CONTACT_SHEET_LABEL_HEIGHT,
  CONTACT_SHEET_MIN_BYTES,
  CONTACT_SHEET_REL,
  GRADE_SET_REL,
  parseGradeSetCellHeadline,
  parseGradeSetStations,
} from "./assemble-station-room-grade-set.js";

/**
 * OBSERVABLE: the fifteen stations rendered (sweep report, 4.0 min, env ids
 * recorded) and nobody can look at them. The PNGs lived in a job tmp and the
 * only durable artifact is a count.
 *
 * This file asserts the grade-set names every shipped station, each listed PNG
 * exists on the tracked path, and the contact sheet clears the card byte floor.
 * It does not re-run the capture (duration is a wait-budget, out of scope) and
 * it does not grade whether any room reads as a clinical space.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `assemble-station-room-grade-set.ts` recaptures via captureStationEnvironmentRooms
 * (unchanged), copies each PNG under docs/openclinxr/humanoid-vetting-captures/station-rooms-2026-09-12/,
 * and composes station-rooms-contact-sheet-2026-09-12.png with buildContactSheet.
 *
 * claimScope: tracked copies of the fifteen shipped station-environment captures
 *   plus one labelled contact sheet.
 * notEvidenceFor: pixel grade of any room; capture-code / predicate / budget changes.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const GRADE_SET_PATH = path.join(REPO_ROOT, GRADE_SET_REL);
const CONTACT_SHEET_PATH = path.join(REPO_ROOT, CONTACT_SHEET_REL);

describe("the fifteen station rooms are one contact sheet", () => {
  it("(0) VACUITY GUARD: the cells headline is the row count, not a restated 15", () => {
    const fake = [
      "# x",
      "- cells: 15",
      "## Stations",
      "### `a`",
      "- image: docs/a.png",
      "- environmentId: env_a",
      "- bytes: 10",
      "### `b`",
      "- image: docs/b.png",
      "- environmentId: env_b",
      "- bytes: 20",
    ].join("\n");
    const headline = parseGradeSetCellHeadline(fake);
    const rows = parseGradeSetStations(fake);
    expect(headline).toBe(15);
    expect(rows.map((row) => row.caseId)).toEqual(["a", "b"]);
    expect(rows.length).not.toBe(headline);
  });

  it("(1) the grade-set names every shipped station and each tracked PNG exists", () => {
    expect(existsSync(GRADE_SET_PATH), `missing ${GRADE_SET_REL}`).toBe(true);
    const body = readFileSync(GRADE_SET_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    const rows = parseGradeSetStations(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseGradeSetCellHeadline(body);
    expect(headline, "no cells: N headline").toBe(population.length);
    expect(headline, "headline disagrees with ### rows").toBe(rows.length);
    for (const row of rows) {
      expect(row.imageRel.startsWith(`${CELLS_DIR_REL}/`), `${row.caseId} image not under cells dir`).toBe(
        true,
      );
      const abs = path.join(REPO_ROOT, row.imageRel);
      expect(existsSync(abs), `missing tracked cell ${row.imageRel}`).toBe(true);
      const bytes = statSync(abs).size;
      expect(bytes, `${row.caseId} tracked PNG is empty`).toBeGreaterThan(0);
      expect(bytes, `${row.caseId} bytes field disagrees with disk`).toBe(row.bytes);
      expect(row.environmentId.length, `${row.caseId} missing environmentId`).toBeGreaterThan(0);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped the orchestrator residual").toMatch(
      /Whether any room reads as a clinical space/i,
    );
  });

  it("(2) the contact sheet exists, clears the card byte floor, and is a 5×3 labelled grid", () => {
    expect(existsSync(CONTACT_SHEET_PATH), `missing ${CONTACT_SHEET_REL}`).toBe(true);
    const bytes = statSync(CONTACT_SHEET_PATH).size;
    expect(bytes, `${CONTACT_SHEET_REL} is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(
      CONTACT_SHEET_MIN_BYTES,
    );
    const decoded = decodePng(new Uint8Array(readFileSync(CONTACT_SHEET_PATH)));
    expect(decoded, "contact sheet is not a decodable PNG").not.toBeNull();
    const cellCount = parseGradeSetStations(readFileSync(GRADE_SET_PATH, "utf8")).length;
    const gridRows = Math.ceil(cellCount / CONTACT_SHEET_COLUMNS);
    expect(decoded?.w).toBe(CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH);
    expect(decoded?.h).toBe(gridRows * (CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT));
  });
});
