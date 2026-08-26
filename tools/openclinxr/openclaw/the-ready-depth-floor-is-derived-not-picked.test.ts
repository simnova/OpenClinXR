/**
 * `READY_DEPTH_TARGET = 10` is a bare literal, and it has fired in 33 consecutive audits.
 *
 * It sits between two constants that BOTH carry measured derivations — `CHRONIC_AFTER` cites
 * clause 11, `PERSISTENCE_WINDOW` cites a dated incident with the number it produced. The
 * undocumented one is the one that never clears. #654 names this and was deliberately left
 * un-operationalized because "writing a contract for this today would require inventing the exact
 * thresholds that are the defect."
 *
 * MEASURED 2026-08-26 from worker-sessions.jsonl — 183 paired spawn/terminal dispatches, ~162h:
 *
 *     concurrent workers   share of wall-clock
 *     0                    63.9%
 *     1                    31.7%
 *     2                     4.0%
 *     3 (MAX EVER)          0.4%
 *
 * So a floor of 10 is 3.3x the maximum concurrency this pipeline has ever reached, and ~10x its
 * typical load. A finding that fires against a number with no basis is not a signal; 33 audits of
 * "short by 8" is what an ignored gauge looks like.
 *
 * THE DERIVATION. The floor's only job is to stop a dequeue starving. A dequeue starves when the
 * ready set is smaller than the number of lanes that can be filled at once — that is the observed
 * max concurrency, and it is measured rather than chosen. Below it a lane provably idles for want
 * of a card; at or above it, no lane does.
 *
 * NO BUFFER IS ADDED ON TOP, deliberately. A buffer hedges refill latency, and deriving one needs
 * a refill-rate measurement. The only such data is 12 windows of ready-set membership (~10h):
 * 3 cards left, 0 entered, 0.00 cards/hour. That is too thin to derive a buffer from, and picking
 * one would repeat the exact defect this contract exists to fix.
 *
 * THE ANTI-GAUGE-SERVING CHECK IS CLAUSE (2). A previous consult caught this loop serving its own
 * gauge, and lowering a floor until a finding goes quiet is precisely that. It does not go quiet:
 * productForward is 2 against a derived floor of 3, so the finding still fires — with information
 * this time instead of without.
 *
 * claimScope: the provenance of the number and the shape of the derivation.
 * notEvidenceFor: that 3 is the right long-run floor. It is the right floor for the concurrency
 * this pipeline has actually reached. If lanes scale, the measurement must be re-taken — which is
 * the point of deriving it from a measurement rather than typing a literal.
 */
import { describe, it, expect } from "vitest";
import {
  READY_DEPTH_TARGET,
  OBSERVED_MAX_CONCURRENT_WORKERS,
  deriveReadyDepthTarget,
} from "./supervisor-audit.js";
import { readFileSync } from "node:fs";

describe("the ready-depth floor is derived, not picked", () => {
  // (1) THE HOLE: the exported target must BE the derivation applied to the measured input,
  //     not a literal that happens to equal it.
  it("is the derivation applied to the measured concurrency", () => {
    expect(typeof deriveReadyDepthTarget).toBe("function");
    expect(READY_DEPTH_TARGET).toBe(deriveReadyDepthTarget(OBSERVED_MAX_CONCURRENT_WORKERS));
    const src = readFileSync("tools/openclinxr/openclaw/supervisor-audit.ts", "utf8");
    expect(src, "READY_DEPTH_TARGET must not be a bare literal again")
      .not.toMatch(/export const READY_DEPTH_TARGET\s*=\s*\d+\s*;/u);
  });

  // (2) ANTI-GAUGE-SERVING COUNTERWEIGHT. Lowering a floor until the finding stops firing is the
  //     trap. The current ready depth is 2; a floor that admits it would have silenced a real
  //     signal. Without this clause the contract passes for ANY floor including 0 or 1.
  it("still refuses the CURRENT ready depth", () => {
    const audit = JSON.parse(
      readFileSync(".openclinxr/openclaw/supervisor-audit-latest.json", "utf8"),
    ) as { readyDepth: { productForward: number } };
    expect(audit.readyDepth.productForward, "fixture moot if the depth already meets any floor")
      .toBeLessThan(OBSERVED_MAX_CONCURRENT_WORKERS);
    expect(
      audit.readyDepth.productForward < READY_DEPTH_TARGET,
      "the derived floor must still fire on today's depth — a floor tuned until a finding goes "
        + "quiet is the gauge serving itself, which a prior consult already caught this loop doing",
    ).toBe(true);
  });

  // (3) COUNTERWEIGHT: a nonsense concurrency must throw, not yield a floor of 0. A zero floor is
  //     worse than a wrong one — the finding can never fire again and the gauge dies silently.
  it("refuses a concurrency that would produce a floor nothing can fail", () => {
    for (const bad of [0, -1, 0.5, Number.NaN]) {
      expect(() => deriveReadyDepthTarget(bad), `${bad} must be refused`).toThrow(/concurren/iu);
    }
  });

  // (4) The measured input carries provenance in the source, so the next person can re-take it.
  it("records where the concurrency measurement came from", () => {
    const src = readFileSync("tools/openclinxr/openclaw/supervisor-audit.ts", "utf8");
    expect(src).toMatch(/worker-sessions\.jsonl/u);
    expect(src).toMatch(/183 paired/u);
  });
});
