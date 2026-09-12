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
} from "./assemble-station-room-grade-set.js";
import {
  BEIGE_CEILING,
  FRAMING_REPORT_REL,
  INTERIOR_CELLS_DIR_REL,
  INTERIOR_CONTACT_SHEET_REL,
  INTERIOR_SD_FLOOR,
  KNOWN_GOOD_CASE_IDS,
  measureInteriorCenter,
  parseFramingHeadline,
  parseFramingStations,
} from "./interior-frame-metrics.js";

/**
 * OBSERVABLE: 2 of 15 station-environment captures at native 1440×900 show only
 * the doorway wall — flat beige plaster filling the 3D canvas, Pre-Encounter
 * board still in frame, no furniture, no actors. Thumbnails on the contact
 * sheet hide this; native resolution does not.
 *
 * MEASURED 2026-09-12 on docs/openclinxr/humanoid-vetting-captures/station-rooms-2026-09-12/
 * center region {left:0.22, top:0.12, width:0.44, height:0.70}, Rec.601 luma:
 *
 *   case                                      sd    beige%
 *   peds_asthma_parent_anxiety_v1            7.4    100.0     WALL
 *   stepdown_sepsis_nurse_escalation_v1     24.5     93.0     WALL
 *   ob_headache_preeclampsia_triage_v1      44.9      5.9     interior (next-lowest sd)
 *   postop_fever_consult_pressure_v1        63.6     29.8     known-good
 *   ward_delirium_med_rec_v1                60.7     43.6     known-good
 *
 * Full-viewport sd does NOT separate them (peds 37.4 vs ward 61.7) because the
 * Pre-Encounter board on the left supplies variance. The defect is SHAPE: the
 * center of the canvas is plaster.
 *
 * sd floor = sqrt(24.5 × 44.9) = 33.17 (geometric midpoint of the binding pair).
 * beige ceiling = (93.0 + 47.1) / 2 = 70.05 (wall min vs highest interior beige).
 *
 * KNOWN-GOOD: postop_fever_consult_pressure_v1 and ward_delirium_med_rec_v1
 * show room depth with furniture and multiple actors in frame.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `reframeCameraForRoom` floors the interior stand-off at 2× the known-good ED
 * bay +Z thickness (0.1245 m) and no longer photographs a rejected (wall-blocked)
 * viewpoint. `assemble-station-room-interior-sheet.ts` recaptures every shipped
 * station into station-rooms-interior-2026-09-12/ and composes
 * station-rooms-interior-contact-sheet-2026-09-12.png.
 *
 * claimScope: native interior-framed captures of the fifteen shipped stations
 *   plus one labelled contact sheet; center-viewport occupancy vs the wall/interior
 *   binding pair.
 * notEvidenceFor: whether any environment genuinely lacks clinical furniture;
 *   Quest readiness; whether the rooms read as clinically plausible spaces.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPORT_PATH = path.join(REPO_ROOT, FRAMING_REPORT_REL);
const CONTACT_SHEET_PATH = path.join(REPO_ROOT, INTERIOR_CONTACT_SHEET_REL);
const DOORWAY_CELLS_DIR = path.join(REPO_ROOT, CELLS_DIR_REL);

describe("the station capture frames the room interior", () => {
  it("(0) VACUITY GUARD: the cells headline is the row count, not a restated 15", () => {
    const fake = [
      "# x",
      "- cells: 15",
      "## Stations",
      "### `a`",
      "- image: docs/a.png",
      "- environmentId: env_a",
      "- bytes: 10",
      "- centerSd: 80.0",
      "- beigePct: 10.0",
      "- edgePct: 5.0",
      "- framesInterior: true",
      "### `b`",
      "- image: docs/b.png",
      "- environmentId: env_b",
      "- bytes: 20",
      "- centerSd: 8.0",
      "- beigePct: 99.0",
      "- edgePct: 0.1",
      "- framesInterior: false",
    ].join("\n");
    const headline = parseFramingHeadline(fake);
    const rows = parseFramingStations(fake);
    expect(headline).toBe(15);
    expect(rows.map((row) => row.caseId)).toEqual(["a", "b"]);
    expect(rows.length).not.toBe(headline);
    expect(rows[0]?.framesInterior).toBe(true);
    expect(rows[1]?.framesInterior).toBe(false);
  });

  it("(1) INVERTED GUARD: the doorway-wall cells still measure as walls, known-good as interiors", () => {
    const wallIds = ["peds_asthma_parent_anxiety_v1", "stepdown_sepsis_nurse_escalation_v1"] as const;
    for (const id of wallIds) {
      const abs = path.join(DOORWAY_CELLS_DIR, `${id}-room.png`);
      expect(existsSync(abs), `missing doorway-wall cell ${id}`).toBe(true);
      const metrics = measureInteriorCenter(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${id} did not decode`).not.toBeNull();
      expect(metrics?.framesInterior, `${id} no longer measures as a wall; restore the 2026-09-12 doorway-wall PNG`).toBe(
        false,
      );
    }
    for (const id of KNOWN_GOOD_CASE_IDS) {
      const abs = path.join(DOORWAY_CELLS_DIR, `${id}-room.png`);
      expect(existsSync(abs), `missing known-good cell ${id}`).toBe(true);
      const metrics = measureInteriorCenter(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${id} did not decode`).not.toBeNull();
      expect(metrics?.sd, `${id} known-good sd collapsed`).toBeGreaterThan(INTERIOR_SD_FLOOR);
      expect(metrics?.beigePct, `${id} known-good beige rose to wall`).toBeLessThan(BEIGE_CEILING);
      expect(metrics?.framesInterior, `${id} known-good no longer frames interior`).toBe(true);
    }
  });

  it("(2) every shipped station has a native interior cell that clears the wall/interior pair", () => {
    expect(existsSync(REPORT_PATH), `missing ${FRAMING_REPORT_REL}`).toBe(true);
    const body = readFileSync(REPORT_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    const rows = parseFramingStations(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseFramingHeadline(body);
    expect(headline, "no cells: N headline").toBe(population.length);
    expect(headline, "headline disagrees with ### rows").toBe(rows.length);
    for (const row of rows) {
      expect(row.imageRel.startsWith(`${INTERIOR_CELLS_DIR_REL}/`), `${row.caseId} image not under interior cells dir`).toBe(
        true,
      );
      const abs = path.join(REPO_ROOT, row.imageRel);
      expect(existsSync(abs), `missing interior cell ${row.imageRel}`).toBe(true);
      const bytes = statSync(abs).size;
      expect(bytes, `${row.caseId} interior PNG is empty`).toBeGreaterThan(0);
      expect(bytes, `${row.caseId} bytes field disagrees with disk`).toBe(row.bytes);
      const metrics = measureInteriorCenter(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${row.caseId} interior cell did not decode`).not.toBeNull();
      expect(metrics?.sd, `${row.caseId} centerSd ${String(metrics?.sd)} <= floor ${String(INTERIOR_SD_FLOOR)}`).toBeGreaterThan(
        INTERIOR_SD_FLOOR,
      );
      expect(
        metrics?.beigePct,
        `${row.caseId} beigePct ${String(metrics?.beigePct)} >= ceiling ${String(BEIGE_CEILING)}`,
      ).toBeLessThan(BEIGE_CEILING);
      expect(metrics?.framesInterior, `${row.caseId} still frames the doorway wall`).toBe(true);
      expect(row.framesInterior, `${row.caseId} report framesInterior disagrees with pixels`).toBe(true);
      expect(row.environmentId.length, `${row.caseId} missing environmentId`).toBeGreaterThan(0);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped the residual").toMatch(/clinically plausible spaces/i);
  });

  it("(3) the interior contact sheet exists, clears the card byte floor, and is a 5×3 labelled grid", () => {
    expect(existsSync(CONTACT_SHEET_PATH), `missing ${INTERIOR_CONTACT_SHEET_REL}`).toBe(true);
    const bytes = statSync(CONTACT_SHEET_PATH).size;
    expect(bytes, `${INTERIOR_CONTACT_SHEET_REL} is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(
      CONTACT_SHEET_MIN_BYTES,
    );
    const decoded = decodePng(new Uint8Array(readFileSync(CONTACT_SHEET_PATH)));
    expect(decoded, "interior contact sheet is not a decodable PNG").not.toBeNull();
    const cellCount = parseFramingStations(readFileSync(REPORT_PATH, "utf8")).length;
    const gridRows = Math.ceil(cellCount / CONTACT_SHEET_COLUMNS);
    expect(decoded?.w).toBe(CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH);
    expect(decoded?.h).toBe(gridRows * (CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT));
  });
});
