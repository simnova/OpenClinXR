import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * DIAGNOSIS (immutable). The deterministic branch scheduler is built, unit-tested, and reachable by
 * nothing.
 *
 * MEASURED 2026-09-15 at main 8985a870:
 *
 *   evaluateBranchScheduler / composeAdmittedLearnerEventPath  ZERO consumers. Every grep hit
 *     outside branch-scheduler/ is that module's own dist/ output or a prose comment.
 *   scenario-runtime/src/index.ts                              does not export it.
 *   scenario-runtime/package.json                              root export only, no subpath.
 *   scenario-fixtures / exam-assembly / apps/ui-xr             no file authors a FrozenCaseSeed
 *                                                              or an AuthoredBranchTransition.
 *
 * So it is sealed inside its own package with no case data and no call site.
 *
 * THE CARD THAT BUILT IT SAID SO ITSELF. tsk_a529ed79b8d301d7 is done/Landed/merged, and its
 * objective required: "Compose the scheduler into one real scenario-runtime path." That composition
 * does not exist. Its six proofs were three `exists:` rules and three package-level `test` runs —
 * none of which can observe whether anything was composed. Files present, unit tests green,
 * deliverable absent, and no proof in the set could tell the difference.
 *
 * THE OWNER'S DECISION, 2026-09-15, which this contract encodes rather than reopens: dependency
 * injection through ScenarioRuntime. The runtime owns the canonical scheduler shapes and accepts
 * frozen seed/policy configuration from the composition root; appendLearnerEvent invokes the
 * scheduler and records its decision; fixture and app code map authored case data into that input.
 * branch-scheduler stays PRIVATE to the package — no new public export, no new subpath. Telemetry
 * and review continue to consume recorded provenance at their existing structural boundaries.
 *
 * THE PRECEDENT IS IN THE SAME TYPE. ScenarioRuntimeOptions (runtime-types.ts:303-318) already
 * carries two optional composition-root injections, `conversationPolicy?` and `encounterAdmission?`.
 * Its own comment at :326-332 states the principle this card exists to satisfy: "Adapter selection
 * is a composition-root decision, not a library default" — written about a seam that existed while
 * "nothing can reach it". That is this defect, described by the repo about itself.
 *
 * WHY SOURCE-TEXT. The composition is a wiring property: does the option exist, does the seam call
 * the scheduler, does the session carry the state across calls. A behavioural test belongs in the
 * same change as the wiring and is required by the run: proofs; this file is the structural gate
 * that a later green cannot satisfy by leaving the seam unwired.
 *
 * claimScope: that ScenarioRuntime accepts branch seed/policy configuration from its composition
 *   root, that appendLearnerEvent invokes the scheduler, and that branch state persists on the
 *   session between calls.
 * notEvidenceFor: whether any authored branch is clinically sound; assessment validity; scoring;
 *   exam equivalence; that branching improves anything. No case content is authored here.
 */

/**
 * Resolved the way the sibling boundary suite in this package does
 * (`the-planner-stays-inside-its-boundary.test.ts`): a URL relative to this module, handed straight
 * to readFileSync. No path join, no import.meta.dirname — neither appears anywhere else in
 * scenario-runtime/src, and a lone idiom in one file is a maintenance trap.
 */
const RUNTIME_TYPES = new URL("../runtime-types.ts", import.meta.url);
const SCENARIO_RUNTIME = new URL("../scenario-runtime.ts", import.meta.url);
const PACKAGE_INDEX = new URL("../index.ts", import.meta.url);
const PACKAGE_MANIFEST = new URL("../../package.json", import.meta.url);

function read(file: URL): string {
  return readFileSync(file, "utf8");
}

describe("the branch scheduler is reachable from the composition root", () => {
  it("(1) ScenarioRuntimeOptions accepts branch seed/policy configuration", () => {
    const types = read(RUNTIME_TYPES);
    const start = types.indexOf("export type ScenarioRuntimeOptions");
    expect(start, "ScenarioRuntimeOptions must exist").toBeGreaterThan(-1);
    const block = types.slice(start, types.indexOf("};", start) + 2);
    expect(
      /branchScheduling\?:/u.test(block),
      "ScenarioRuntimeOptions carries no branchScheduling? field. The owner's decision is injection "
        + "through ScenarioRuntime, alongside the existing conversationPolicy? and "
        + "encounterAdmission? composition-root options.",
    ).toBe(true);
  });

  it("(2) appendLearnerEvent invokes the scheduler on the admitted event it already writes", () => {
    const runtime = read(SCENARIO_RUNTIME);
    const start = runtime.indexOf("appendLearnerEvent(stationRunId: string");
    expect(start, "appendLearnerEvent must exist").toBeGreaterThan(-1);
    const body = runtime.slice(start, runtime.indexOf("\n  }", start) + 4);
    // The module's own header names this seam: composeAdmittedLearnerEventPath folds "the same
    // records ScenarioRuntime.appendLearnerEvent already writes to the ledger".
    expect(
      /composeAdmittedLearnerEventPath|evaluateBranchScheduler/u.test(body),
      "appendLearnerEvent does not reach the scheduler. Its own module header names this method as "
        + "the composition seam; wiring anywhere else contradicts the design note.",
    ).toBe(true);
  });

  it("(3) branch state persists on the session, so a fold is not restarted every call", () => {
    const types = read(RUNTIME_TYPES);
    const start = types.indexOf("export type SessionRecord");
    expect(start, "SessionRecord must exist").toBeGreaterThan(-1);
    const block = types.slice(start, types.indexOf("};", start) + 2);
    // Without this the scheduler is called with a fresh initial state each time and can never
    // advance — the shape of a wiring that looks connected and computes nothing.
    expect(
      /branchState/u.test(block),
      "SessionRecord carries no branch state. A scheduler handed a fresh initial state on every "
        + "call cannot fold an event sequence, and would pass a naive call-site assertion while "
        + "advancing nothing.",
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: branch-scheduler stays private — no new public export or subpath", () => {
    const index = read(PACKAGE_INDEX);
    expect(
      index.includes("branch-scheduler"),
      "the owner's decision keeps branch-scheduler PRIVATE to the package and exposes behaviour "
        + "through the existing ScenarioRuntime surface; exporting it from index.ts widens the "
        + "public surface the reduction plan is shrinking",
    ).toBe(false);

    const pkg = read(PACKAGE_MANIFEST);
    const exportsBlock = pkg.slice(pkg.indexOf('"exports"'), pkg.indexOf('"scripts"'));
    expect(
      exportsBlock.includes("branch-scheduler"),
      "no new package.json subpath export for branch-scheduler",
    ).toBe(false);
  });

  it("(5) COUNTERWEIGHT: the existing composition-root injections are not displaced", () => {
    const types = read(RUNTIME_TYPES);
    const start = types.indexOf("export type ScenarioRuntimeOptions");
    const block = types.slice(start, types.indexOf("};", start) + 2);
    // Adding an option must not be done by rewriting the type and dropping its neighbours.
    for (const kept of ["scenario:", "ledger:", "conversationPolicy?:", "encounterAdmission?:"]) {
      expect(block.includes(kept), `${kept} must survive`).toBe(true);
    }
  });
});
