import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shippedStationIds } from "../ui-xr-environment-room-capture.js";
import {
  isAllowedSweepClass,
  parseRenderedHeadline,
  parseStationRows,
  SWEEP_OUTCOMES,
  SWEEP_REPORT_REL,
} from "./sweep-renders-after-client-graph-fix.js";

/**
 * OBSERVABLE: after the client-graph fix, one station (ed_chest_pain_priority_v2)
 * renders in 20 s with a written manifest. The other fourteen have not been
 * captured, so the render frontier is an anecdote.
 *
 * This file asserts the sequential sweep report names every shipped station and
 * a closed-vocab class per row. It does not re-run the capture (duration is a
 * wait-budget, out of scope).
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-12
 *
 * `sweep-renders-after-client-graph-fix.ts` captures each shippedStationIds()
 * entry one at a time and writes render-sweep-after-the-client-graph-fix-2026-09-12.md.
 * rendered = count(rows where outcome=rendered). Failures keep pageDiagnostics.
 *
 * claimScope: the count of shipped stations whose station-environment capture
 *   resolves on this tree after the client-graph fix.
 * notEvidenceFor: pixel grade of any rendered room; wait-budget changes; repairs.
 */

const REPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
  SWEEP_REPORT_REL,
);

describe("the fifteen stations are counted after the client-graph fix", () => {
  it("(0) VACUITY GUARD: the headline is the row count, not a restated 15", () => {
    const fake = [
      "# x",
      "- rendered: 15 of 15",
      "## Stations",
      "### `a`",
      "- outcome: timeout",
      "- classification: page exception",
      "- durationMs: 10",
      "### `b`",
      "- outcome: rendered",
      "- classification: did not stop",
      "- durationMs: 20",
    ].join("\n");
    const headline = parseRenderedHeadline(fake);
    const rows = parseStationRows(fake);
    expect(headline).toEqual({ rendered: 15, of: 15 });
    expect(rows.map((row) => row.outcome)).toEqual(["timeout", "rendered"]);
    const counted = rows.filter((row) => row.outcome === "rendered").length;
    expect(counted).not.toBe(headline?.rendered);
  });

  it("(1) the sweep report exists, is ≥1200 bytes, and names every shipped station", () => {
    expect(existsSync(REPORT_PATH), `missing ${SWEEP_REPORT_REL}`).toBe(true);
    const bytes = statSync(REPORT_PATH).size;
    // Floor is the card's min-bytes:1200, not a fitted size.
    expect(bytes, `${SWEEP_REPORT_REL} is ${bytes} bytes`).toBeGreaterThanOrEqual(1200);
    const body = readFileSync(REPORT_PATH, "utf8");
    const population = shippedStationIds();
    expect(population.length, "shipped bundle population is not fifteen").toBe(15);
    expect(population, "known-good ED case dropped out of the population").toContain(
      "ed_chest_pain_priority_v2",
    );
    const rows = parseStationRows(body);
    expect(rows.map((row) => row.caseId)).toEqual(population);
    const headline = parseRenderedHeadline(body);
    expect(headline, "no rendered: N of M headline").not.toBeNull();
    expect(headline?.of).toBe(population.length);
    const counted = rows.filter((row) => row.outcome === "rendered").length;
    expect(headline?.rendered, "headline disagrees with outcome=rendered rows").toBe(counted);
    for (const row of rows) {
      expect(SWEEP_OUTCOMES as readonly string[], `outcome ${row.outcome}`).toContain(row.outcome);
      expect(isAllowedSweepClass(row.classification), `class ${row.classification}`).toBe(true);
      expect(Number.isFinite(row.durationMs), `${row.caseId} missing durationMs`).toBe(true);
      expect(row.durationMs, `${row.caseId} durationMs is negative`).toBeGreaterThanOrEqual(0);
    }
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
    expect(body, "report dropped one-at-a-time capture").toMatch(/one at a time/i);
  });
});
