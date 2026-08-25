import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  checkRuntimeHumanoidReachability, liveCastAssetPaths, NON_CAST_RUNTIME_ROLES,
} from "./runtime-humanoid-reachability.js";
import {
  listShippedCastScenarioIds, resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

/**
 * OBSERVABLE: four commits on 2026-08-24 improved a published humanoid that nothing loads, and five
 * gates passed all of them. Full account in
 * `docs/openclinxr/postmortem-anny-fixture-polish-2026-08-25.md`.
 *
 * MEASURED, do not re-derive: 14 shipped scenarios resolve to 9 unique assets, all MPFB. The
 * published `generated-humanoids` directory holds 19 GLBs. So 10 published assets are unreachable
 * through the cast resolver, and the four wasted commits went to one of them.
 *
 * THE GATES WERE NOT INDEPENDENT. Pre-commit, dispatch, product-lane, merge-kill and diff
 * classification each accepted a self-description of product relevance — a path, a declared factory
 * step, an attached proof. The product-lane gate in particular equates "stored beneath a product
 * directory" with "consumed by the product". This clause is the consumer graph, which none of them
 * consulted.
 *
 * claimScope: that every published humanoid GLB is either reached by the shipped-bank cast resolver
 *   or declares a non-cast runtimeRole in its own provenance.
 * notEvidenceFor: whether a reached asset is correct, whether a declared role is honest, or anything
 *   about assets outside the published humanoid directories.
 */

const REPO = join(import.meta.dirname, "../../..");
const cast = { listShippedCastScenarioIds, resolveScenarioActorCast };

describe("every published humanoid is cast or declared", () => {
  it("(1) no published humanoid is unreachable AND undeclared", () => {
    const report = checkRuntimeHumanoidReachability(REPO, cast);
    const lines = report.orphans.map((o) => `${o.asset}: ${o.why}`);
    expect(lines,
      `published humanoids nothing loads and which declare no runtimeRole:\n${lines.join("\n")}`)
      .toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the live cast is non-empty — a broken resolver cannot satisfy clause (1)", () => {
    // Without this, deleting the scenario bank or breaking the resolver empties the live set, every
    // asset becomes "unreachable", and someone declares them all non-cast to go green. The floor is
    // the shipped bank's own size, not a number I chose: 14 scenarios resolving to 9 assets today.
    const live = liveCastAssetPaths(cast);
    expect(listShippedCastScenarioIds().length,
      "the shipped bank must enumerate scenarios or this whole check is vacuous").toBeGreaterThan(5);
    expect(live.size, "the cast resolver must reach real assets").toBeGreaterThan(5);
  });

  it("(3) COUNTERWEIGHT: no LIVE-cast asset may declare itself non-cast", () => {
    // Refuses the cheap pass of stamping `runtimeRole: comparator` onto everything. An asset the
    // resolver actually reaches is cast, whatever its sidecar says, and the two disagreeing is a
    // defect rather than a way through.
    const report = checkRuntimeHumanoidReachability(REPO, cast);
    const lying = report.assets
      .filter((a) => a.reachedByResolver && a.declaredRuntimeRole !== null
        && (NON_CAST_RUNTIME_ROLES as readonly string[]).includes(a.declaredRuntimeRole))
      .map((a) => `${a.asset} is cast but declares runtimeRole=${a.declaredRuntimeRole}`);
    expect(lying, lying.join("\n")).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: satisfying this by DELETING the published set is refused", () => {
    // The other cheap pass: delete the orphans and the clause goes green having removed the subject
    // rather than resolved it. A published directory that has shrunk below the live cast cannot be
    // serving the runtime.
    const report = checkRuntimeHumanoidReachability(REPO, cast);
    expect(report.publishedAssetCount,
      "published humanoids must at least cover the live cast").toBeGreaterThanOrEqual(
        Math.min(report.liveCastAssetCount, 8));
  });

  it("(5) VACUITY GUARD: the checker reads the REAL resolver, not a copy", () => {
    // The failure this whole file exists for was a hand-authored population diverging from the live
    // one. If the checker ever grows its own scenario list, this clause is the thing that notices:
    // the injected resolver is the product's, and swapping in an empty one must change the answer.
    const withReal = liveCastAssetPaths(cast).size;
    const withEmpty = liveCastAssetPaths({
      listShippedCastScenarioIds: () => [],
      resolveScenarioActorCast: () => [],
    }).size;
    expect(withReal, "the real resolver must produce a cast").toBeGreaterThan(0);
    expect(withEmpty, "an empty resolver must produce an empty cast — otherwise the population is "
      + "coming from somewhere other than the injected resolver").toBe(0);
  });
});
