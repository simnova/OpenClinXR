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
  ACTOR_CONTACT_SHEET_REL,
  ACTOR_CROP_CASE_ID,
  ACTOR_FRAMING_REPORT_REL,
  ACTOR_KNOWN_GOOD_CASE_IDS,
  HEAD_FIGURE_FLOOR,
  INTERIOR_CELLS_DIR_REL,
  measureActorFrame,
  parseActorFramingHeadline,
  parseActorFramingStations,
} from "./actor-frame-metrics.js";
import { measureInteriorCenter } from "./interior-frame-metrics.js";

/**
 * OBSERVABLE: the interior-2026-09-12 oncology frame photographs a doorway-side
 * actor from the shin down (pink trousers + shoes, no head). The camera stands
 * knee-high and too close. Thumbnails hide this; native 1440×900 does not.
 *
 * MEASURED 2026-09-12 on docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/
 * 3D canvas x[0, 0.68) y[0.08, 0.88), head band y[0.08, 0.52), Rec.601 + chroma:
 *
 *   case                                      headFig%
 *   oncology_bad_news_family_v1                  1.91     SHIN-CROP
 *   clinic_abdominal_pain_interpreter_v1         9.11     next full-body
 *   stepdown_sepsis_nurse_escalation_v1         14.91     known-good
 *   peds_asthma_parent_anxiety_v1               24.45     known-good
 *
 * head floor = sqrt(1.91 × 9.11) = 4.17 (geometric midpoint of crop vs next
 * full-body interior). Equal-ratio gap; not fitted to a recapture.
 *
 * KNOWN-GOOD: peds_asthma_parent_anxiety_v1 and stepdown_sepsis_nurse_escalation_v1
 * in the same interior set show a bed, a child and attending adults at a readable
 * distance.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `reframeCameraForRoom` uses standing-eye 1.68 m (look y=1.0), a 2.0 m
 * readable nearest-actor floor, a zMid ring, and a doorway-midline fallback
 * that steps X off a wall-blocked look-ray. `assemble-station-room-actor-sheet.ts`
 * recaptures every shipped station into station-rooms-actors-2026-09-12/ and
 * composes station-rooms-actors-contact-sheet-2026-09-12.png.
 *
 * claimScope: native elevated-interior captures of the fifteen shipped stations
 *   plus one labelled contact sheet; upper-canvas figure occupancy vs the
 *   shin-crop / known-good binding pair.
 * notEvidenceFor: whether any environment is too small to frame its actors
 *   legally; whether the rooms read as clinically plausible spaces; Quest readiness.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPORT_PATH = path.join(REPO_ROOT, ACTOR_FRAMING_REPORT_REL);
const CONTACT_SHEET_PATH = path.join(REPO_ROOT, ACTOR_CONTACT_SHEET_REL);

describe("the station capture frames actors head to foot", () => {
  it("(0) VACUITY GUARD: the cells headline is the row count, not a restated 15", () => {
    const fake = [
      "# x",
      "- cells: 15",
      "## Stations",
      "### `a`",
      "- image: docs/a.png",
      "- environmentId: env_a",
      "- bytes: 10",
      "- headFigurePct: 20.0",
      "- floorFloorPct: 70.0",
      "- bottomFigurePct: 5.0",
      "- framesActors: true",
      "### `b`",
      "- image: docs/b.png",
      "- environmentId: env_b",
      "- bytes: 20",
      "- headFigurePct: 0.5",
      "- floorFloorPct: 90.0",
      "- bottomFigurePct: 4.0",
      "- framesActors: false",
    ].join("\n");
    const headline = parseActorFramingHeadline(fake);
    const rows = parseActorFramingStations(fake);
    expect(headline).toBe(15);
    expect(rows.map((row) => row.caseId)).toEqual(["a", "b"]);
    expect(rows.length).not.toBe(headline);
    expect(rows[0]?.framesActors).toBe(true);
    expect(rows[1]?.framesActors).toBe(false);
  });

  it("(1) INVERTED GUARD: the shin-crop interior cell still fails, known-good still frames actors", () => {
    const cropAbs = path.join(REPO_ROOT, INTERIOR_CELLS_DIR_REL, `${ACTOR_CROP_CASE_ID}-room.png`);
    expect(existsSync(cropAbs), `missing shin-crop interior cell ${ACTOR_CROP_CASE_ID}`).toBe(true);
    const crop = measureActorFrame(new Uint8Array(readFileSync(cropAbs)));
    expect(crop, `${ACTOR_CROP_CASE_ID} did not decode`).not.toBeNull();
    expect(
      crop?.framesActors,
      `${ACTOR_CROP_CASE_ID} no longer measures as a shin-crop; restore the 2026-09-12 interior PNG`,
    ).toBe(false);
    expect(crop?.headFigurePct, `${ACTOR_CROP_CASE_ID} headFigurePct rose off the crop`).toBeLessThan(
      HEAD_FIGURE_FLOOR,
    );
    for (const id of ACTOR_KNOWN_GOOD_CASE_IDS) {
      const abs = path.join(REPO_ROOT, INTERIOR_CELLS_DIR_REL, `${id}-room.png`);
      expect(existsSync(abs), `missing known-good interior cell ${id}`).toBe(true);
      const metrics = measureActorFrame(new Uint8Array(readFileSync(abs)));
      expect(metrics, `${id} did not decode`).not.toBeNull();
      expect(
        metrics?.headFigurePct,
        `${id} known-good headFigurePct collapsed below floor ${String(HEAD_FIGURE_FLOOR)}`,
      ).toBeGreaterThan(HEAD_FIGURE_FLOOR);
      expect(metrics?.framesActors, `${id} known-good no longer frames actors`).toBe(true);
    }
  });

  it("(2) every shipped station has a native actor cell that clears the shin-crop pair and still frames the interior", () => {
    expect(existsSync(REPORT_PATH), `missing ${ACTOR_FRAMING_REPORT_REL}`).toBe(true);
    const body = readFileSync(REPORT_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    const rows = parseActorFramingStations(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseActorFramingHeadline(body);
    expect(headline, "no cells: N headline").toBe(population.length);
    expect(headline, "headline disagrees with ### rows").toBe(rows.length);
    for (const row of rows) {
      expect(row.imageRel.startsWith(`${ACTOR_CELLS_DIR_REL}/`), `${row.caseId} image not under actor cells dir`).toBe(
        true,
      );
      const abs = path.join(REPO_ROOT, row.imageRel);
      expect(existsSync(abs), `missing actor cell ${row.imageRel}`).toBe(true);
      const bytes = statSync(abs).size;
      expect(bytes, `${row.caseId} actor PNG is empty`).toBeGreaterThan(0);
      expect(bytes, `${row.caseId} bytes field disagrees with disk`).toBe(row.bytes);
      const png = new Uint8Array(readFileSync(abs));
      const metrics = measureActorFrame(png);
      expect(metrics, `${row.caseId} actor cell did not decode`).not.toBeNull();
      expect(
        metrics?.headFigurePct,
        `${row.caseId} headFigurePct ${String(metrics?.headFigurePct)} <= floor ${String(HEAD_FIGURE_FLOOR)}`,
      ).toBeGreaterThan(HEAD_FIGURE_FLOOR);
      expect(metrics?.framesActors, `${row.caseId} still crops actors below the shin`).toBe(true);
      expect(row.framesActors, `${row.caseId} report framesActors disagrees with pixels`).toBe(true);
      const interior = measureInteriorCenter(png);
      expect(interior?.framesInterior, `${row.caseId} actor recapture lost interior framing`).toBe(true);
      expect(row.environmentId.length, `${row.caseId} missing environmentId`).toBeGreaterThan(0);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped the residual").toMatch(/clinically plausible spaces/i);
  });

  it("(3) the actor contact sheet exists, clears the card byte floor, and is a 5×3 labelled grid", () => {
    expect(existsSync(CONTACT_SHEET_PATH), `missing ${ACTOR_CONTACT_SHEET_REL}`).toBe(true);
    const bytes = statSync(CONTACT_SHEET_PATH).size;
    expect(bytes, `${ACTOR_CONTACT_SHEET_REL} is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(
      CONTACT_SHEET_MIN_BYTES,
    );
    const decoded = decodePng(new Uint8Array(readFileSync(CONTACT_SHEET_PATH)));
    expect(decoded, "actor contact sheet is not a decodable PNG").not.toBeNull();
    const cellCount = parseActorFramingStations(readFileSync(REPORT_PATH, "utf8")).length;
    const gridRows = Math.ceil(cellCount / CONTACT_SHEET_COLUMNS);
    expect(decoded?.w).toBe(CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH);
    expect(decoded?.h).toBe(gridRows * (CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT));
  });
});
