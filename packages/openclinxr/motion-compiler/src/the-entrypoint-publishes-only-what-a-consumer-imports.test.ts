import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * PSR-09's closure criterion is `pnpm arch:public-surface:acceptance` returning `close`. MEASURED on
 * main 2026-09-14 it returns `refuse`, and criterion 5 names this package first:
 *
 *   criterion 5 (reviewed-execution): FAIL: group psr-01c not applied: extra:
 *   packages/openclinxr/motion-compiler. publishes unapproved MotionGlbBakeClip,
 *   MotionGlbBakeTrack, MotionGlbReadback, bakeMotionProgramToGlb, readMotionGlb
 *
 * THAT REPORT IS TRUNCATED AT FIVE (gates.ts:435 emits failures.slice(0, 5) per group). Computed
 * from the tree instead: src/index.ts publishes EIGHT symbols and only TWO carry approved keep rows
 * (planMotionProgram, ScenarioMotionCompileInput), so SIX are unapproved — the sixth,
 * readMotionGlbClipId, is the one the report drops.
 *
 * AN INDEPENDENT REVIEW (a session that authored none of the rows) checked each against its
 * consumers and found three with NO consumer outside this package:
 *
 *   symbol                 external consumer                                          verdict
 *   MotionGlbBakeClip      capability-gateway/src/motion-manifest-publication.ts:6     KEEP
 *   bakeMotionProgramToGlb capability-gateway/src/motion-manifest-publication.ts:5     KEEP
 *   readMotionGlbClipId    capability-gateway/src/motion-manifest-publication.ts:5     KEEP
 *   MotionGlbBakeTrack     none                                                        CUT
 *   MotionGlbReadback      none — only the return type of readMotionGlb                CUT
 *   readMotionGlb          none — the bake test loads ./motion-glb-bake.js directly    CUT
 *
 * VERIFIED SEPARATELY before planting this: the only references to those three outside this package
 * are a comment in an unrelated test. `bake!.readMotionGlb` in
 * the-bake-produces-a-glb-the-runtime-loads.test.ts reaches the MODULE, not the entrypoint, so the
 * re-export can go without touching it. src/motion-glb-bake.ts is an internal shim; the surface
 * meter reads src/index.ts, which is why this test asserts on that file.
 *
 * Cutting an unused export is what the reduction programme exists to do. Approving one would spend
 * a review slot admitting API nobody imports.
 *
 * SCOPE, stated so this card is not credited with more than it does: this removes three of the
 * seven unapproved symbols. Four remain (the three KEEPs above plus playManifestMotionClip in
 * xr-humanoid-animation) and need a genuine admission route, which is a separate card. Criterion 6
 * is NOT addressed here — it fails at rootExportsAtMost 1227 > 1000 and separately because
 * exceptions/psr-08-residual.json uses a retired shape (kind/measuredAfterPsr08/... rather than
 * target/measured/threshold/reviewedBy). Three fewer exports cannot close a 227 gap.
 *
 * Clause (1) is the RED. Clauses (0), (2) and (3) pass today and MUST keep passing — they are what
 * refuses a cut that takes the consumed symbols with it. Do not delete this header; append a
 * `## FIXED` block below.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = join(HERE, "index.ts");

/** The three the independent review found have no consumer outside this package. */
const CUT = ["MotionGlbBakeTrack", "MotionGlbReadback", "readMotionGlb"] as const;

/** Approved keeps plus the three with real external consumers. All must survive. */
const KEEP = [
  "planMotionProgram",
  "ScenarioMotionCompileInput",
  "bakeMotionProgramToGlb",
  "readMotionGlbClipId",
  "MotionGlbBakeClip",
] as const;

function entrypointSource(): string {
  return readFileSync(ENTRYPOINT, "utf8");
}

/** A whole-word hit, so `readMotionGlb` does not match inside `readMotionGlbClipId`. */
function publishes(source: string, symbol: string): boolean {
  return new RegExp(`\\b${symbol}\\b`, "u").test(source);
}

describe("the entrypoint publishes only what a consumer imports", () => {
  // (0) VACUITY GUARD. If index.ts were empty or unreadable, clause (1) would pass for the wrong
  // reason. This pins that the five kept symbols are named there, so a pass of (1) is about the
  // cut and never about a missing file.
  // ## FIXED (bothy-tsk_e133db2e0e13d261): this guard originally pinned all EIGHT symbols named in
  // index.ts (CUT + KEEP) as the pre-fix inventory. The cut removed the three CUT symbols from the
  // entrypoint, so the guard now pins the five KEEP symbols — same anti-vacuity strength, updated
  // inventory. Clause (1) below asserts the CUT absence.
  it("(0) the entrypoint exists and names the five kept symbols", () => {
    const src = entrypointSource();
    expect(src.length, "index.ts is empty — clause (1) would pass vacuously").toBeGreaterThan(100);
    for (const symbol of KEEP) {
      expect(publishes(src, symbol), `${symbol} is not named in index.ts — this guard is stale`).toBe(true);
    }
  });

  // (1) RED — the three symbols with no external consumer must leave the entrypoint.
  // MEASURED as plain `it(` on 2026-09-14: 1 failed | 3 passed, the failure reading
  // "index.ts still publishes MotionGlbBakeTrack, which has no consumer outside this package".
  // Marked it.fails so the suite is green while the defect stands. THE FIX MUST CONVERT IT BACK
  // TO `it(` — the card's live: rule fails while any it.fails clause remains, so a green run here
  // is not evidence of repair.
  it("(1) does not publish the three symbols nothing outside this package imports", () => {
    const src = entrypointSource();
    for (const symbol of CUT) {
      expect(publishes(src, symbol), `index.ts still publishes ${symbol}, which has no consumer outside this package`).toBe(false);
    }
  });

  // (2) COUNTERWEIGHT — the cut must not take the consumed symbols with it.
  it("(2) still publishes every symbol a real consumer imports", () => {
    const src = entrypointSource();
    for (const symbol of KEEP) {
      expect(publishes(src, symbol), `index.ts dropped ${symbol}, which capability-gateway or the approved rows require`).toBe(true);
    }
  });

  // (3) COUNTERWEIGHT — and the value exports must still be callable, not merely present as text.
  it("(3) the consumed value exports remain callable through the entrypoint", async () => {
    const mod = (await import("./index.js")) as Record<string, unknown>;
    expect(typeof mod["bakeMotionProgramToGlb"], "bakeMotionProgramToGlb must stay callable").toBe("function");
    expect(typeof mod["readMotionGlbClipId"], "readMotionGlbClipId must stay callable").toBe("function");
    expect(typeof mod["planMotionProgram"], "planMotionProgram must stay callable").toBe("function");
  });
});

/**
 * ## FIXED (bothy-tsk_e133db2e0e13d261) — removed MotionGlbBakeTrack, MotionGlbReadback and
 * readMotionGlb from src/index.ts (value re-export drops readMotionGlb; type re-export keeps
 * only MotionGlbBakeClip). KEEP set untouched: planMotionProgram, ScenarioMotionCompileInput,
 * bakeMotionProgramToGlb, readMotionGlbClipId and MotionGlbBakeClip still publish through the
 * entrypoint. Clause (0) guard re-pinned from the eight-symbol pre-fix inventory to the five
 * KEEP symbols (same anti-vacuity strength); clause (2) pins the KEEP presence and clause (3)
 * the KEEP callability. Internal shim src/motion-glb-bake.ts and src/bake/motion-glb-bake.ts
 * unchanged — bake test loads ./motion-glb-bake.js directly, so readMotionGlb stays reachable
 * there. Four unapproved symbols remain (three KEEPs + playManifestMotionClip) and criterion 6
 * (rootExportsAtMost 1227 > 1000) is not addressed; acceptance still returns refuse.
 */
