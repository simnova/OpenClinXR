import { describe, expect, it } from "vitest";
import {
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

/**
 * OBSERVABLE: the dark-factory's only remaining blocker reports itself in a message that does not say
 * what failed, so nobody can tell which of two repairs it needs.
 *
 * MEASURED 2026-09-03 from the rollup landed at 6f5d05d4, all 15 cases identical:
 *
 *   render   classification: error   artifactPaths: []
 *   "Capture failed for <caseId>: page.waitForFunction: Timeout 180000ms exceeded."
 *   frontierCounts { render: 15 }   — every other station is deterministic except equipment 5/15
 *                                     and world_compile 1/15
 *
 * `ui-xr-environment-room-capture.ts` has TWO waits and both default to 180 s:
 *
 *   waitForStationShell        (:1057)  waits for `__openClinXrDebugScene` to carry an
 *                                       `openClinXrStationEnvironment.environmentId`, or a node named
 *                                       `openclinxr.station-environment-shell`
 *   waitForHumanoidAssetsLoaded (:1089) waits for `__openClinXrSceneAssetEvidence` to report loaded
 *                                       humanoids rather than primitive fallbacks
 *
 * Neither wraps `page.waitForFunction`, so Playwright's own timeout propagates verbatim, and
 * `multi-case-runner.ts:864` catches the whole capture in one `catch` and prints `errMessage(err)`.
 * A shell that never mounted and assets that never finished loading are indistinguishable from the
 * artifact. They are different repairs: the first is a scene that did not boot, the second is an asset
 * load that did not settle.
 *
 * ## KNOWN-GOOD COLUMN — the naming convention already exists in this file
 *
 * `waitForStationShell` ALREADY throws `station shell not ready: ${reading.reason}` on its OTHER
 * failure path, after the wait succeeds but the reading is not ready. So the file establishes that a
 * failure should name itself; the timeout path is the one that does not. This card asks for the same
 * treatment on the path that is actually firing, not for a new convention.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite the
 * measured table.
 *
 * claimScope: whether a timeout from either exported wait identifies which wait it came from while
 *   preserving the underlying cause.
 * notEvidenceFor: why the capture times out — this file makes the failure legible, it does not fix
 *   it; whether render is the right frontier; anything about Blender, the bake, or the other stations.
 */

/** Playwright's own message shape, copied from the rollup note rather than invented. */
const PLAYWRIGHT_TIMEOUT = "page.waitForFunction: Timeout 180000ms exceeded.";

/** A page whose waitForFunction always times out, which is exactly the observed failure. */
const timingOutPage = (): unknown => ({
  waitForFunction: () => Promise.reject(new Error(PLAYWRIGHT_TIMEOUT)),
  evaluate: () => Promise.resolve(undefined),
});

const messageFrom = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
};

describe("a capture timeout names which wait failed", () => {
  it("(0) VACUITY GUARD: the stub really does reject, so a silent pass is impossible", async () => {
    // Without this, both clauses would pass trivially against a stub that resolved: `messageFrom`
    // returns "" and every `toMatch` below would fail for the wrong reason, or worse, a future stub
    // that resolves would make "the message names the wait" vacuously true.
    const msg = await messageFrom(() => waitForStationShell(timingOutPage() as never, 10));
    expect(msg, "the stub did not reject — this file is testing nothing").not.toBe("");
    expect(msg, "the stub's rejection is not the observed Playwright timeout").toContain("Timeout");
  });

  it.fails("(1) RED: a station-shell timeout says it was the station shell", async () => {
    const msg = await messageFrom(() => waitForStationShell(timingOutPage() as never, 10));
    expect(msg, `timeout message does not name the station shell: ${msg}`).toMatch(/station.?shell/iu);
    // COUNTERWEIGHT: naming the wait is cheap if you throw away the cause. The underlying Playwright
    // timeout must survive, or the fix trades one unreadable message for another.
    expect(msg, "the original Playwright timeout was swallowed").toMatch(/Timeout/u);
  });

  it.fails("(2) RED: a humanoid-assets timeout says it was the humanoid assets", async () => {
    const msg = await messageFrom(() => waitForHumanoidAssetsLoaded(timingOutPage() as never, 10));
    expect(msg, `timeout message does not name the humanoid assets: ${msg}`).toMatch(/humanoid|asset/iu);
    expect(msg, "the original Playwright timeout was swallowed").toMatch(/Timeout/u);
  });

  it.fails("(3) RED: the two messages are distinguishable from each other", async () => {
    // Written first as an inverted guard and RUN — it failed, because the two messages are byte
    // identical today. That is the defect itself, so it is a RED. It stays as a separate clause
    // because (1) and (2) are both satisfiable by one message that names BOTH waits
    // ("capture timeout: station shell / humanoid assets"), which would tell a reader nothing.
    const shell = await messageFrom(() => waitForStationShell(timingOutPage() as never, 10));
    const assets = await messageFrom(() => waitForHumanoidAssetsLoaded(timingOutPage() as never, 10));
    expect(shell, "both waits produce the identical message, so the artifact still cannot tell them apart")
      .not.toBe(assets);
  });
});
