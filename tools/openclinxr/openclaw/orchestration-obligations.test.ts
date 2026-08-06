import { describe, expect, it } from "vitest";

/**
 * Declared orchestration obligations — the gateable half of "pieces built, left unconnected".
 *
 * That class recurred SIX times in one day, always in same-day code: merge-kill exited 2 with
 * nothing calling it; integrate passed `contract: null` while the report existed; a "single source
 * of truth" vocabulary constant the evaluator never read; integrationEvents built to replace
 * subject-regexing while the scorecard kept regexing; and two checkers that landed with zero callers.
 *
 * The obvious rule was measured and DIED: "an export with no importer outside its own file and test"
 * flags 184 of 233 exports here (79%). Most exports in a tools module exist for their own unit test,
 * which is normal. A rule flagging four fifths of a directory is either permanently frozen or
 * useless — the same error as freezing failing tests by count instead of by file.
 *
 * The six incidents share a narrower predicate: something was sold as a RUNTIME OBLIGATION — a gate,
 * an SSOT, a land-path step, an honesty check — and no production caller on that path invoked it.
 * `classifyArchitectureInvocation` being test-only is fine; `runMergeKill` never called by integrate
 * is not. There is no free signal separating those, so intent has to be DECLARED: a small curated
 * registry, not a scan.
 */
const load = async () => (await import("./orchestration-obligations.js")) as {
  ORCHESTRATION_OBLIGATIONS: readonly { id: string; symbol: string; requiredCallers: readonly string[] }[];
  unwiredObligations: (repoRoot: string) => string[];
};

describe("declared orchestration obligations stay wired", () => {
  it.fails("flags an obligation whose required caller never invokes the symbol", async () => {
    const { unwiredObligations } = await load();
    // The historical case: runMergeKill existed, exited 2 correctly, and integrate never called it.
    const violations = unwiredObligations(process.cwd());
    expect(violations.join(" ")).toMatch(/never invokes|not called|unwired/i);
  });

  it.fails("passes when every declared obligation is actually invoked", async () => {
    const { unwiredObligations } = await load();
    // All six historical obligations are wired on main today, so the live registry must be clean.
    expect(unwiredObligations(process.cwd())).toEqual([]);
  });

  it.fails("registry stays small and curated rather than scanning every export", async () => {
    const { ORCHESTRATION_OBLIGATIONS } = await load();
    // A scan-shaped registry would reintroduce the 79% failure. Obligations are declared per layer.
    expect(ORCHESTRATION_OBLIGATIONS.length).toBeGreaterThan(0);
    expect(ORCHESTRATION_OBLIGATIONS.length).toBeLessThan(40);
    for (const o of ORCHESTRATION_OBLIGATIONS) {
      expect(o.requiredCallers.length, `${o.id} must name who has to call it`).toBeGreaterThan(0);
    }
  });
});
