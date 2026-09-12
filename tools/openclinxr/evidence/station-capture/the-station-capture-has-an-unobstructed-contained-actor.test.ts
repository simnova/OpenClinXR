import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.js";
import { shippedStationIds } from "../ui-xr-environment-room-capture.js";
import {
  CONTACT_SHEET_CELL_HEIGHT,
  CONTACT_SHEET_CELL_WIDTH,
  CONTACT_SHEET_COLUMNS,
  CONTACT_SHEET_LABEL_HEIGHT,
  CONTACT_SHEET_MIN_BYTES,
} from "./assemble-station-room-grade-set.js";
import {
  ACTOR_CELLS_DIR_REL,
  CLEAR_CELLS_DIR_REL,
  CLEAR_CONTACT_SHEET_REL,
  CLEAR_KNOWN_GOOD_CASE_IDS,
  CLEAR_REPORT_REL,
  DOOR_OCCLUDED_CASE_IDS,
  DOOR_PCT_CEILING,
  STANDING_SKIN_FLOOR,
  WALL_CENTER_PLASTER_FLOOR,
  WALL_OCCLUDED_CASE_ID,
  measureOcclusionAndContainment,
  parseBeforeStations,
  parseClearHeadline,
  parseClearStations,
} from "./occlusion-and-containment-metrics.js";

/**
 * OBSERVABLE: two 2026-09-12 actor frames still pass framesActors (a head-band
 * figure percentage) while a wall or door fills the camera and a standing
 * actor is sliced by the left frame edge. Native 1440×900:
 *
 *   adult_abdominal_pain_v1 — beige plaster with AO triangles occupies the
 *     look centre (centerPlaster 59.13%, centerFig 0%); the only standing
 *     figure is cut at the left edge (no head, skinInHeadBand 0.3%).
 *   ed_chest_pain_priority_v1 / v2 — a saturated red door occupies 26% of the
 *     3D canvas; the bed patient is left-sliced (no head).
 *
 * framesActors cannot see either defect: adult headFigurePct 5.49 and
 * ed_chest 30.52 both clear HEAD_FIGURE_FLOOR 4.17.
 *
 * KNOWN-GOOD: peds_asthma_parent_anxiety_v1 and
 * stepdown_sepsis_nurse_escalation_v1 show standing actors with a clear line
 * from the camera (centerFig 11.01 / 17.94, doorPct 0, largest standing
 * !touchLeft with skin 9.4 / 26.1). Recumbent bed actors may clip the left
 * edge — that is not this defect.
 *
 * OUT OF SCOPE: environment / furniture / actor placement / lighting;
 * raising or lowering existing interior or actor-band thresholds. UI text
 * bleeding over the canvas (clinic / stepdown title overlay) is named, not
 * fixed here.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `refineCameraForOcclusionAndContainment` orbits inside the interior AABB
 * until standing actors (AABB height >= 1.15 m) are unoccluded and not
 * left-clipped. `assemble-station-room-clear-sheet.ts` recaptures every
 * shipped station into station-rooms-clear-2026-09-12/ and composes
 * station-rooms-clear-contact-sheet-2026-09-12.png.
 *
 * claimScope: native refined-interior captures of the fifteen shipped
 *   stations plus one labelled contact sheet; per-actor standing-blob
 *   containment and wall/door occlusion vs the 2026-09-12 actor-frame pair.
 * notEvidenceFor: whether any room admits no camera position satisfying all
 *   four measures; whether the rooms read as clinically plausible spaces;
 *   Quest readiness.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPORT_PATH = path.join(REPO_ROOT, CLEAR_REPORT_REL);
const CONTACT_SHEET_PATH = path.join(REPO_ROOT, CLEAR_CONTACT_SHEET_REL);

describe("the station capture has an unobstructed contained actor", () => {
  it("(0) VACUITY GUARD: the cells headline is the row count, not a restated 15", () => {
    const fake = [
      "# x",
      "- cells: 15",
      "## Stations",
      "### `a`",
      "- image: docs/a.png",
      "- environmentId: env_a",
      "- bytes: 10",
      "- centerFigPct: 12.0",
      "- centerPlasterPct: 10.0",
      "- doorPct: 0.0",
      "- wallOccluded: false",
      "- doorOccluded: false",
      "- unobstructed: true",
      "- standingCount: 1",
      "- largestStandingSkinPct: 20.0",
      "- largestStandingTouchLeft: false",
      "- largestStandingContained: true",
      "- framesClear: true",
      "### `b`",
      "- image: docs/b.png",
      "- environmentId: env_b",
      "- bytes: 20",
      "- centerFigPct: 0.0",
      "- centerPlasterPct: 90.0",
      "- doorPct: 0.0",
      "- wallOccluded: true",
      "- doorOccluded: false",
      "- unobstructed: false",
      "- standingCount: 1",
      "- largestStandingSkinPct: 0.2",
      "- largestStandingTouchLeft: true",
      "- largestStandingContained: false",
      "- framesClear: false",
    ].join("\n");
    const headline = parseClearHeadline(fake);
    const rows = parseClearStations(fake);
    expect(headline).toBe(15);
    expect(rows.map((row) => row.caseId)).toEqual(["a", "b"]);
    expect(rows.length).not.toBe(headline);
    expect(rows[0]?.framesClear).toBe(true);
    expect(rows[1]?.framesClear).toBe(false);
  });

  it("(1) INVERTED GUARD: the wall and door actor cells still fail, known-good still clear", () => {
    const wallAbs = path.join(REPO_ROOT, ACTOR_CELLS_DIR_REL, `${WALL_OCCLUDED_CASE_ID}-room.png`);
    expect(existsSync(wallAbs), `missing wall actor cell ${WALL_OCCLUDED_CASE_ID}`).toBe(true);
    const wall = measureOcclusionAndContainment(new Uint8Array(readFileSync(wallAbs)));
    expect(wall, `${WALL_OCCLUDED_CASE_ID} did not decode`).not.toBeNull();
    expect(wall?.wallOccluded, `${WALL_OCCLUDED_CASE_ID} no longer measures as a wall; restore the 2026-09-12 actor PNG`).toBe(
      true,
    );
    expect(
      wall?.centerPlasterPct,
      `${WALL_OCCLUDED_CASE_ID} centerPlasterPct dropped off the wall`,
    ).toBeGreaterThan(WALL_CENTER_PLASTER_FLOOR);
    expect(wall?.framesClear, `${WALL_OCCLUDED_CASE_ID} now frames clear; restore the actor PNG`).toBe(false);

    for (const id of DOOR_OCCLUDED_CASE_IDS) {
      const abs = path.join(REPO_ROOT, ACTOR_CELLS_DIR_REL, `${id}-room.png`);
      expect(existsSync(abs), `missing door actor cell ${id}`).toBe(true);
      const metrics = measureOcclusionAndContainment(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${id} did not decode`).not.toBeNull();
      expect(metrics?.doorOccluded, `${id} no longer measures as a door; restore the 2026-09-12 actor PNG`).toBe(true);
      expect(metrics?.doorPct, `${id} doorPct dropped off the door`).toBeGreaterThan(DOOR_PCT_CEILING);
      expect(metrics?.framesClear, `${id} now frames clear; restore the actor PNG`).toBe(false);
    }

    for (const id of CLEAR_KNOWN_GOOD_CASE_IDS) {
      const abs = path.join(REPO_ROOT, ACTOR_CELLS_DIR_REL, `${id}-room.png`);
      expect(existsSync(abs), `missing known-good actor cell ${id}`).toBe(true);
      const metrics = measureOcclusionAndContainment(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${id} did not decode`).not.toBeNull();
      expect(metrics?.unobstructed, `${id} known-good became occluded`).toBe(true);
      expect(
        metrics?.largestStandingContained,
        `${id} known-good largest standing no longer contained (skin floor ${String(STANDING_SKIN_FLOOR)})`,
      ).toBe(true);
      expect(metrics?.framesClear, `${id} known-good no longer frames clear`).toBe(true);
    }
  });

  it("(2) every shipped station has a native clear cell that is unobstructed and contains its largest standing actor", () => {
    expect(existsSync(REPORT_PATH), `missing ${CLEAR_REPORT_REL}`).toBe(true);
    const body = readFileSync(REPORT_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    const rows = parseClearStations(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseClearHeadline(body);
    expect(headline, "no cells: N headline").toBe(population.length);
    expect(headline, "headline disagrees with ### rows").toBe(rows.length);
    for (const row of rows) {
      expect(row.imageRel.startsWith(`${CLEAR_CELLS_DIR_REL}/`), `${row.caseId} image not under clear cells dir`).toBe(
        true,
      );
      const abs = path.join(REPO_ROOT, row.imageRel);
      expect(existsSync(abs), `missing clear cell ${row.imageRel}`).toBe(true);
      const bytes = statSync(abs).size;
      expect(bytes, `${row.caseId} clear PNG is empty`).toBeGreaterThan(0);
      expect(bytes, `${row.caseId} bytes field disagrees with disk`).toBe(row.bytes);
      const png = new Uint8Array(readFileSync(abs));
      const metrics = measureOcclusionAndContainment(png);
      expect(metrics, `${row.caseId} clear cell did not decode`).not.toBeNull();
      expect(metrics?.unobstructed, `${row.caseId} still has a wall or door in the look`).toBe(true);
      expect(
        metrics?.largestStandingContained,
        `${row.caseId} largest standing actor still sliced (skin ${String(metrics?.standing[0]?.skinInHeadBandPct)} touchL ${String(metrics?.standing[0]?.touchLeft)})`,
      ).toBe(true);
      expect(metrics?.framesClear, `${row.caseId} still fails framesClear`).toBe(true);
      expect(row.framesClear, `${row.caseId} report framesClear disagrees with pixels`).toBe(true);
      expect(row.largestStandingTouchRight, `${row.caseId} missing touchRight in report`).toBe(
        metrics?.largestStandingTouchRight === true,
      );
      expect(row.largestStandingTouchBottom, `${row.caseId} missing touchBottom in report`).toBe(
        metrics?.largestStandingTouchBottom === true,
      );
      expect(row.anyStandingTouchRight, `${row.caseId} missing anyStandingTouchRight in report`).toBe(
        metrics?.anyStandingTouchRight === true,
      );
      expect(row.anyStandingTouchBottom, `${row.caseId} missing anyStandingTouchBottom in report`).toBe(
        metrics?.anyStandingTouchBottom === true,
      );
      expect(row.environmentId.length, `${row.caseId} missing environmentId`).toBeGreaterThan(0);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped the residual").toMatch(/no camera position satisfying all four measures/i);
  });

  it("(3) the clear contact sheet exists, clears the card byte floor, and is a 5×3 labelled grid", () => {
    expect(existsSync(CONTACT_SHEET_PATH), `missing ${CLEAR_CONTACT_SHEET_REL}`).toBe(true);
    const bytes = statSync(CONTACT_SHEET_PATH).size;
    expect(bytes, `${CLEAR_CONTACT_SHEET_REL} is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(
      CONTACT_SHEET_MIN_BYTES,
    );
    const decoded = decodePng(new Uint8Array(readFileSync(CONTACT_SHEET_PATH)));
    expect(decoded, "clear contact sheet is not a decodable PNG").not.toBeNull();
    const cellCount = parseClearStations(readFileSync(REPORT_PATH, "utf8")).length;
    const gridRows = Math.ceil(cellCount / CONTACT_SHEET_COLUMNS);
    expect(decoded?.w).toBe(CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH);
    expect(decoded?.h).toBe(gridRows * (CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT));
  });

  it("(4) BEFORE/AFTER: named actor-frame PNGs fail the new instrument; after rows pass", () => {
    const body = readFileSync(REPORT_PATH, "utf8");
    expect(body, "report dropped ## Before").toMatch(/^## Before \(/m);
    expect(body, "report dropped ## Before / after table").toMatch(/^## Before \/ after/m);
    const before = parseBeforeStations(body);
    const after = parseClearStations(body);
    const population = shippedStationIds();
    expect(before.map((row) => row.caseId)).toEqual(population);
    expect(after.map((row) => row.caseId)).toEqual(population);

    const adultBefore = before.find((row) => row.caseId === WALL_OCCLUDED_CASE_ID);
    expect(adultBefore, "before table dropped adult_abdominal_pain_v1").toBeDefined();
    expect(adultBefore?.wallOccluded, "adult before must stay a wall failure").toBe(true);
    expect(adultBefore?.framesClear, "adult before measures CLEAN — instrument does not bite").toBe(
      false,
    );

    const chestBefore = before.find((row) => row.caseId === "ed_chest_pain_priority_v1");
    expect(chestBefore, "before table dropped ed_chest_pain_priority_v1").toBeDefined();
    expect(chestBefore?.doorOccluded, "ed_chest v1 before must stay a door failure").toBe(true);
    expect(chestBefore?.framesClear, "ed_chest v1 before measures CLEAN — instrument does not bite").toBe(
      false,
    );

    expect(after.find((row) => row.caseId === WALL_OCCLUDED_CASE_ID)?.framesClear).toBe(true);
    expect(after.find((row) => row.caseId === "ed_chest_pain_priority_v1")?.framesClear).toBe(true);

    const psychAfter = after.find((row) => row.caseId === "psych_suicidal_ideation_safety_v1");
    expect(
      psychAfter?.largestStandingTouchBottom ?? psychAfter?.anyStandingTouchBottom,
      "psych after should still report bottom clipping",
    ).toBe(true);
  });
});
