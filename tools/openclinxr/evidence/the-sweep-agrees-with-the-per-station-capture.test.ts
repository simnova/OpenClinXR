/**
 * #507 — MEASURE ONLY. Two landed instruments disagree about the same station on the same tree.
 * `reject_measured` closes this successfully. Do not "fix" the number.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#507)` block below; do not rewrite these tables.
 *
 * SAME STATION (primary_care_dyslipidemia_joint_pain_v1), SAME COMMIT, TWO INSTRUMENTS:
 *
 *   ui-xr-environment-room-capture.ts   one server boot per invocation, one station
 *     RUN1..RUN5  cam=3.01,1.70,2.44  rejected=(empty)  median 23.0 · 23.0 · 23.0 · 23.0 · 23.0
 *     BIT-IDENTICAL five times — camera, rejection list and luminance.
 *
 *   station-luminance-sweep.ts          one server boot, all 15 stations in sequence
 *     median 16 · 0 · 23 · 17   (committed report + three fresh runs)
 *
 * The shape any explanation must fit: in the SWEEP, 13 of 15 stations are bit-exact across four
 * samples and only this one moves. "The sweep races" in general does NOT fit that.
 *
 * WHY IT MATTERS BEYOND ONE NUMBER: `no-shipped-station-captures-darker-than-it-did.test.ts` on
 * main was floored from a sweep run. Fourteen floors reproduce; the `primary_care` floor of 0 is an
 * artefact of the racing instrument (the station's true value is 23). A landed gate therefore
 * passes or fails on which instrument ran.
 *
 * TWO CANDIDATES, UNRANKED, AND THEY MAY BOTH BE WRONG (§6l). I have been wrong about this
 * station's mechanism twice already — once calling it a #503 regression, once calling the station
 * flaky when the instrument is:
 *   - the sweep reuses a page/context across stations, so state from the predecessor leaks in
 *   - the sweep's per-station settle is shorter than the per-station path's, and this room is slow
 * Do not take a rank from me. Measure the running scene.
 *
 * claimScope: whether a tracked report names why the two instruments disagree.
 * notEvidenceFor: that either instrument is correct, or that any station's luminance is right.
 *
 * ## FIXED (#507) — 2026-08-21
 *
 * Reproduced the non-determinism, FALSIFIED the inferred fallback-camera race. Focused re-measure
 * (tools/openclinxr/evidence/sweep-determinism-measure.ts, same helpers both instruments import):
 * primary_care region median 23/23/23/17/16 (sweep-style, one server) and 17/21/23/21/23
 * (per-station-style, fresh server each) — the sweep varies (spread 7) AND the per-station path
 * varies (spread 6), so the header's "per-station 23.0 five times" did not reproduce. Every one of
 * the ten frame notes reads roomCam(derived)=3.01,<Y>,2.44 with an empty rejected list: the
 * generated room was loaded and the derived interior camera framed each time, so the room-load race
 * reaching the fallback camera never fired. Control: ed_chest_pain_priority_v1 sweep-style was
 * bit-exact at 36 across 4 captures in the same environment — the variance is specific to
 * primary_care's rendered scene, present in BOTH instruments, not a sweep defect and not general
 * capture noise. The deeper cause of primary_care's scene-level variance is NOT DETERMINED (not the
 * camera, not the room load; left for a follow-up, since actor-bound motion alone does not explain
 * it — the control's actors also moved while its luminance stayed fixed).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPORT = "tools/openclinxr/evidence/sweep-determinism-report.json";
const VERDICTS = ["mechanism_named", "reject_measured", "inconclusive_blocked", "other"] as const;
const STATION = "primary_care_dyslipidemia_joint_pain_v1";

describe("#507 the sweep agrees with the per-station capture, or we know why not", () => {
  it("the two instruments both exist — this contract is about a real disagreement", () => {
    expect(existsSync("tools/openclinxr/evidence/station-luminance-sweep.ts")).toBe(true);
    expect(existsSync("tools/openclinxr/evidence/ui-xr-environment-room-capture.ts")).toBe(true);
  });

  it("(1) a tracked report names the mechanism, or honestly rejects", () => {
    expect(existsSync(REPORT), `${REPORT} must exist and be TRACKED (#396)`).toBe(true);
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as Record<string, unknown>;

    expect(VERDICTS, `verdict must be one of ${VERDICTS.join("|")}`).toContain(r.verdict);

    // Every verdict carries the SAME evidence burden, so rejecting is honest rather than cheap.
    expect(typeof r.mechanism).toBe("string");
    expect(String(r.mechanism).length, "one sentence minimum naming what differs").toBeGreaterThan(60);
    expect(String(r.locator ?? ""), "a file:line, a named call, or a number — not a story").toMatch(/[:\d]/);

    // NON-VACUITY: the worker must re-measure BOTH instruments repeatedly, not cite my header.
    const sweep = r.sweepSamples as number[] | undefined;
    const per = r.perStationSamples as number[] | undefined;
    expect(Array.isArray(sweep) && sweep.length >= 3, ">=3 fresh SWEEP samples required").toBe(true);
    expect(Array.isArray(per) && per.length >= 3, ">=3 fresh PER-STATION samples required").toBe(true);
    expect(String(r.station)).toBe(STATION);

    // The disagreement must be reproduced, not asserted: the sweep must vary OR the report must
    // say explicitly that it no longer does (which is itself a finding worth having).
    const spread = Math.max(...sweep!) - Math.min(...sweep!);
    const perSpread = Math.max(...per!) - Math.min(...per!);
    expect(typeof r.reproduced, "state whether you reproduced the disagreement").toBe("boolean");
    if (r.reproduced === true) expect(spread, "reproduced=true needs a real sweep spread").toBeGreaterThan(2);
    expect(perSpread, "the per-station path was bit-exact for me; if it moved for you, say so in mechanism")
      .toBeGreaterThanOrEqual(0);

    expect(String(r.reproducedBy ?? ""), "a command someone else can re-run").toContain("pnpm");
  });
});
