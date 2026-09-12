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
  CLEAR_CELLS_DIR_REL,
  WHOLE_CELLS_DIR_REL,
  WHOLE_CONTACT_SHEET_REL,
  WHOLE_KNOWN_GOOD_CASE_IDS,
  WHOLE_NAMED_FAIL_CASE_ID,
  WHOLE_REPORT_REL,
  measureOcclusionAndContainment,
  parseBeforeStations,
  parseClearHeadline,
  parseClearStations,
} from "./occlusion-and-containment-metrics.js";

/**
 * OBSERVABLE: framesClear gates standing containment on the LEFT edge alone.
 * The 2026-09-12 CLEAR recapture is 15/15 framesClear while standing blobs
 * still clip other canvas edges. Native 1440×900, 3D canvas x[0, 0.68)
 * y[0.08, 0.88):
 *
 *   peds_asthma_parent_anxiety_v1 — largest standing touchRight and
 *     touchBottom (CLEAR after L/R/B = n/Y/Y). Wrongly named known-good
 *     on the left-only slice.
 *   11 of 15 CLEAR after-frames anyStandingTouchBottom; 1 of 15
 *     anyStandingTouchRight (peds). Title count 10/7 is the visual
 *     grade; the instrument's anyB/anyR on CLEAR is 11/1.
 *
 * framesClear cannot see right/bottom/top: contained = !touchLeft.
 *
 * KNOWN-GOOD (after whole recapture, any L/R/T/B = n/n/n/n):
 *   clinic_abdominal_pain_interpreter_v1,
 *   ob_headache_preeclampsia_triage_v1,
 *   primary_care_dyslipidemia_joint_pain_v1,
 *   telehealth_diabetes_health_literacy_v1,
 *   ward_delirium_med_rec_v1.
 * NOT peds_asthma_parent_anxiety_v1.
 *
 * Recumbent bed actors may clip an edge — that carve-out stays.
 *
 * OUT OF SCOPE: environment / furniture / actor placement / lighting;
 * raising or lowering existing interior or actor-band thresholds.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `contained` stays !touchLeft (framesClear). `fourEdgeContained` /
 * `framesWhole` gate all four edges on every standing blob.
 * `refineCameraForOcclusionAndContainment` projects the standing AABB
 * corners and will not keep a left-only viewpoint. Recapture lands
 * station-rooms-whole-2026-09-12/ and
 * station-rooms-whole-contact-sheet-2026-09-12.png.
 *
 * ## FIXED (handback) — 2026-09-12
 *
 * Doorway-side orbit only (camera z >= actor look z). Rejects a camera whose
 * look-ray hits the pre-encounter / scenario-expectation panel from behind
 * (mirrored text). Scores mean facing deg so actors face the camera.
 * Table splits skinned L/R/T/B (framesWhole) from any L/R/T/B (furniture
 * blobs). adult residual is a room constraint with numbers.
 *
 * claimScope: native four-edge recapture of the fifteen shipped stations
 *   plus one labelled contact sheet; standing-blob L/R/T/B vs CLEAR cells.
 * notEvidenceFor: whether any room admits no camera position satisfying all
 *   four measures; whether the rooms read as clinically plausible spaces;
 *   Quest readiness.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPORT_PATH = path.join(REPO_ROOT, WHOLE_REPORT_REL);
const CONTACT_SHEET_PATH = path.join(REPO_ROOT, WHOLE_CONTACT_SHEET_REL);

describe("the station capture contains standing actors on all four edges", () => {
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
      "- largestStandingTouchRight: false",
      "- largestStandingTouchBottom: false",
      "- largestStandingTouchTop: false",
      "- anyStandingTouchLeft: false",
      "- anyStandingTouchRight: false",
      "- anyStandingTouchBottom: false",
      "- anyStandingTouchTop: false",
      "- largestStandingContained: true",
      "- fourEdgeContained: true",
      "- framesClear: true",
      "- framesWhole: true",
      "### `b`",
      "- image: docs/b.png",
      "- environmentId: env_b",
      "- bytes: 20",
      "- centerFigPct: 12.0",
      "- centerPlasterPct: 10.0",
      "- doorPct: 0.0",
      "- wallOccluded: false",
      "- doorOccluded: false",
      "- unobstructed: true",
      "- standingCount: 1",
      "- largestStandingSkinPct: 20.0",
      "- largestStandingTouchLeft: false",
      "- largestStandingTouchRight: true",
      "- largestStandingTouchBottom: true",
      "- largestStandingTouchTop: false",
      "- anyStandingTouchLeft: false",
      "- anyStandingTouchRight: true",
      "- anyStandingTouchBottom: true",
      "- anyStandingTouchTop: false",
      "- largestStandingContained: true",
      "- fourEdgeContained: false",
      "- framesClear: true",
      "- framesWhole: false",
    ].join("\n");
    const headline = parseClearHeadline(fake);
    const rows = parseClearStations(fake);
    expect(headline).toBe(15);
    expect(rows.map((row) => row.caseId)).toEqual(["a", "b"]);
    expect(rows.length).not.toBe(headline);
    expect(rows[0]?.framesWhole).toBe(true);
    expect(rows[1]?.framesClear).toBe(true);
    expect(rows[1]?.framesWhole).toBe(false);
  });

  it("(1) INVERTED GUARD: CLEAR peds still fails four-edge; framesClear still left-only", () => {
    const pedsAbs = path.join(REPO_ROOT, CLEAR_CELLS_DIR_REL, `${WHOLE_NAMED_FAIL_CASE_ID}-room.png`);
    expect(existsSync(pedsAbs), `missing CLEAR cell ${WHOLE_NAMED_FAIL_CASE_ID}`).toBe(true);
    const peds = measureOcclusionAndContainment(new Uint8Array(readFileSync(pedsAbs)));
    expect(peds, `${WHOLE_NAMED_FAIL_CASE_ID} did not decode`).not.toBeNull();
    expect(peds?.framesClear, `${WHOLE_NAMED_FAIL_CASE_ID} lost left-only framesClear; restore the CLEAR PNG`).toBe(
      true,
    );
    expect(peds?.largestStandingTouchRight, `${WHOLE_NAMED_FAIL_CASE_ID} no longer touches right; restore the CLEAR PNG`).toBe(
      true,
    );
    expect(peds?.largestStandingTouchBottom, `${WHOLE_NAMED_FAIL_CASE_ID} no longer touches bottom; restore the CLEAR PNG`).toBe(
      true,
    );
    expect(
      peds?.fourEdgeContained,
      `${WHOLE_NAMED_FAIL_CASE_ID} skinned standing now four-edge contained; restore the CLEAR PNG`,
    ).toBe(false);
    expect(peds?.framesWhole, `${WHOLE_NAMED_FAIL_CASE_ID} now framesWhole; restore the CLEAR PNG`).toBe(false);

    const obAbs = path.join(
      REPO_ROOT,
      CLEAR_CELLS_DIR_REL,
      "ob_headache_preeclampsia_triage_v1-room.png",
    );
    expect(existsSync(obAbs), "missing CLEAR ob cell").toBe(true);
    const ob = measureOcclusionAndContainment(new Uint8Array(readFileSync(obAbs)));
    expect(ob, "ob CLEAR did not decode").not.toBeNull();
    expect(ob?.framesWhole, "ob CLEAR four-edge control failed; instrument over-fires").toBe(true);
  });

  it("(2) every shipped station has a native whole cell that contains every standing actor on all four edges", () => {
    expect(existsSync(REPORT_PATH), `missing ${WHOLE_REPORT_REL}`).toBe(true);
    const body = readFileSync(REPORT_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    const rows = parseClearStations(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseClearHeadline(body);
    expect(headline, "no cells: N headline").toBe(population.length);
    expect(headline, "headline disagrees with ### rows").toBe(rows.length);
    for (const row of rows) {
      expect(row.imageRel.startsWith(`${WHOLE_CELLS_DIR_REL}/`), `${row.caseId} image not under whole cells dir`).toBe(
        true,
      );
      const abs = path.join(REPO_ROOT, row.imageRel);
      expect(existsSync(abs), `missing whole cell ${row.imageRel}`).toBe(true);
      const bytes = statSync(abs).size;
      expect(bytes, `${row.caseId} whole PNG is empty`).toBeGreaterThan(0);
      expect(bytes, `${row.caseId} bytes field disagrees with disk`).toBe(row.bytes);
      const png = new Uint8Array(readFileSync(abs));
      const metrics = measureOcclusionAndContainment(png);
      expect(metrics, `${row.caseId} whole cell did not decode`).not.toBeNull();
      expect(metrics?.unobstructed, `${row.caseId} still has a wall or door in the look`).toBe(true);
      expect(row.framesWhole, `${row.caseId} report framesWhole disagrees with pixels`).toBe(
        metrics?.framesWhole === true,
      );
      expect(row.environmentId.length, `${row.caseId} missing environmentId`).toBeGreaterThan(0);
    }
    expect(body, "report dropped adult_abdominal_pain_v1").toMatch(/adult_abdominal_pain_v1/);
    const doorwayKnownGood = [
      "clinic_abdominal_pain_interpreter_v1",
      "ob_headache_preeclampsia_triage_v1",
      "primary_care_dyslipidemia_joint_pain_v1",
      "ward_delirium_med_rec_v1",
    ];
    for (const id of doorwayKnownGood) {
      const row = rows.find((item) => item.caseId === id);
      expect(row, `known-good ${id} missing from after rows`).toBeDefined();
      expect(row?.framesWhole, `${id} known-good is not framesWhole on doorway-side camera`).toBe(true);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped the residual").toMatch(/no camera position satisfying all four measures/i);
  });

  it("(3) the whole contact sheet exists, clears the card byte floor, and is a 5×3 labelled grid", () => {
    expect(existsSync(CONTACT_SHEET_PATH), `missing ${WHOLE_CONTACT_SHEET_REL}`).toBe(true);
    const bytes = statSync(CONTACT_SHEET_PATH).size;
    expect(bytes, `${WHOLE_CONTACT_SHEET_REL} is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(
      CONTACT_SHEET_MIN_BYTES,
    );
    const decoded = decodePng(new Uint8Array(readFileSync(CONTACT_SHEET_PATH)));
    expect(decoded, "whole contact sheet is not a decodable PNG").not.toBeNull();
    const cellCount = parseClearStations(readFileSync(REPORT_PATH, "utf8")).length;
    const gridRows = Math.ceil(cellCount / CONTACT_SHEET_COLUMNS);
    expect(decoded?.w).toBe(CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH);
    expect(decoded?.h).toBe(gridRows * (CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT));
  });

  it("(4) BEFORE/AFTER: named CLEAR cell fails four-edge; after rows pass; peds is not known-good", () => {
    const body = readFileSync(REPORT_PATH, "utf8");
    expect(body, "report dropped ## Before").toMatch(/^## Before \(/m);
    expect(body, "report dropped ## Before / after table").toMatch(/^## Before \/ after/m);
    const before = parseBeforeStations(body);
    const after = parseClearStations(body);
    const population = shippedStationIds();
    expect(before.map((row) => row.caseId)).toEqual(population);
    expect(after.map((row) => row.caseId)).toEqual(population);

    const pedsBefore = before.find((row) => row.caseId === WHOLE_NAMED_FAIL_CASE_ID);
    expect(pedsBefore, "before table dropped peds_asthma_parent_anxiety_v1").toBeDefined();
    expect(pedsBefore?.framesWhole, "peds before measures WHOLE — instrument does not bite").toBe(false);
    expect(pedsBefore?.largestStandingTouchRight, "peds before must stay right-clipped").toBe(true);
    expect(pedsBefore?.largestStandingTouchBottom, "peds before must stay bottom-clipped").toBe(true);

    expect(after.find((row) => row.caseId === WHOLE_NAMED_FAIL_CASE_ID)?.framesWhole).toBe(true);
    expect((WHOLE_KNOWN_GOOD_CASE_IDS as readonly string[]).includes(WHOLE_NAMED_FAIL_CASE_ID)).toBe(
      false,
    );
    expect(after.find((row) => row.caseId === "clinic_abdominal_pain_interpreter_v1")?.framesWhole).toBe(
      true,
    );
  });

  it("(5) table splits skinned vs any blobs; ed_chest contradiction is named", () => {
    const body = readFileSync(REPORT_PATH, "utf8");
    expect(body).toMatch(/skinned L\/R\/T\/B/);
    expect(body).toMatch(/any L\/R\/T\/B/);
    expect(body).toMatch(/ed_chest_pain_priority_v1 can be whole true while/);
    const after = parseClearStations(body);
    const chest = after.find((row) => row.caseId === "ed_chest_pain_priority_v1");
    expect(chest, "missing ed_chest_pain_priority_v1").toBeDefined();
    if (chest?.framesWhole === true && (chest.anyStandingTouchLeft || chest.anyStandingTouchTop || chest.anyStandingTouchBottom)) {
      expect(chest.skinnedTouchLeft || chest.skinnedTouchTop || chest.skinnedTouchBottom).toBe(false);
    }
  });

  it("(6) doorway-side recapture is not behind the placard; facing is reported", () => {
    const body = readFileSync(REPORT_PATH, "utf8");
    expect(body).toMatch(/placardBack/);
    expect(body).toMatch(/meanFacingDeg/);
    const after = parseClearStations(body);
    const named = [
      "oncology_bad_news_family_v1",
      "ed_stroke_alert_handoff_v1",
      "telehealth_diabetes_health_literacy_v1",
      "stepdown_sepsis_nurse_escalation_v1",
      "psych_suicidal_ideation_safety_v1",
      "ward_delirium_med_rec_v1",
      "primary_care_dyslipidemia_joint_pain_v1",
    ];
    for (const id of named) {
      const row = after.find((item) => item.caseId === id);
      expect(row, `missing ${id}`).toBeDefined();
      expect(row?.placardBack, `${id} still photographs the placard back`).toBe(false);
    }
    expect(body).toMatch(/adult_abdominal_pain_v1/);
  });
});
