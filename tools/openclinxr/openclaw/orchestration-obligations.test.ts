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
  unwiredObligationsIn: (
    obligations: readonly {
      id: string;
      symbol: string;
      fromModule: string;
      requiredCallers: readonly string[];
      sources: Readonly<Record<string, string>>;
    }[],
  ) => string[];
};

describe("declared orchestration obligations stay wired", () => {
  // Still planted: on a clean tree this assertion fails (no violations to flag). it.fails keeps the
  // suite green while encoding the negative case. If a required caller drops its invocation, this
  // assertion starts passing and vitest fails the suite ("Expect test to fail") — same signal as
  // the positive test below going red. Flip to plain `it` only if the negative is re-expressed with
  // an injected broken obligation rather than the live tree.
  it.fails("flags an obligation whose required caller never invokes the symbol", async () => {
    const { unwiredObligations } = await load();
    // The historical case: runMergeKill existed, exited 2 correctly, and integrate never called it.
    const violations = unwiredObligations(process.cwd());
    expect(violations.join(" ")).toMatch(/never invokes|not called|unwired/i);
  });

  it("passes when every declared obligation is actually invoked", async () => {
    const { unwiredObligations } = await load();
    // Seeded obligations are wired on the live land path; the registry must stay clean.
    expect(unwiredObligations(process.cwd())).toEqual([]);
  });

  it("registry stays small and curated rather than scanning every export", async () => {
    const { ORCHESTRATION_OBLIGATIONS } = await load();
    // A scan-shaped registry would reintroduce the 79% failure. Obligations are declared per layer.
    expect(ORCHESTRATION_OBLIGATIONS.length).toBeGreaterThan(0);
    expect(ORCHESTRATION_OBLIGATIONS.length).toBeLessThan(40);
    for (const o of ORCHESTRATION_OBLIGATIONS) {
      expect(o.requiredCallers.length, `${o.id} must name who has to call it`).toBeGreaterThan(0);
    }
  });
});

describe("invocation is a CALL, not a mention (#37)", () => {
  /**
   * #36's checker could not fail. Probe: remove the `runMergeKill(...)` call from integrate.ts,
   * leave the import line — 0 violations. `symbolAppears` word-matched the whole file, so the
   * import at line 7 satisfied an obligation the call at line 93 was supposed to.
   *
   * The fault was the contract, not the worker: it required "passes when wired" and "registry stays
   * small", never "fails when unwired". A rule that cannot fail is worthless, which is the thing I
   * had insisted on all day for everyone else's work.
   *
   * Peer review then killed my repair too. Stripping `^\s*import` lines leaves multi-line import
   * bodies, re-exports, comments and string literals all counting as wired — and breaks the other
   * direction for aliased imports. Its calibration: the cheap-string prior was correct against
   * scanning 233 exports and wrong here, where the unit is ~4 curated symbols across few callers.
   *
   * These take an INJECTED registry so the flagging path is provable without breaking the repo —
   * the live-tree test can only ever assert the passing direction.
   */
  const fixture = (source: string) => [{
    id: "probe", symbol: "runMergeKill", fromModule: "m.ts", requiredCallers: ["caller.ts"],
    sources: { "caller.ts": source },
  }];

  it("flags a caller that only IMPORTS the symbol and never calls it", async () => {
    const { unwiredObligationsIn } = await load();
    expect(unwiredObligationsIn(fixture(`import { runMergeKill } from "./m.js";\nexport const x = 1;`)))
      .toHaveLength(1);
  });

  it("flags a MULTI-LINE import where the symbol sits on its own line", async () => {
    const { unwiredObligationsIn } = await load();
    expect(unwiredObligationsIn(fixture(`import {\n  runMergeKill,\n} from "./m.js";\nexport const x = 1;`)))
      .toHaveLength(1);
  });

  it("flags a bare RE-EXPORT, which forwards the symbol without invoking it", async () => {
    const { unwiredObligationsIn } = await load();
    expect(unwiredObligationsIn(fixture(`export { runMergeKill } from "./m.js";`))).toHaveLength(1);
  });

  it("flags a mention in a COMMENT or string literal", async () => {
    const { unwiredObligationsIn } = await load();
    expect(unwiredObligationsIn(fixture(`// we should call runMergeKill here\nconst s = "runMergeKill";`)))
      .toHaveLength(1);
  });

  it("passes when the symbol is actually CALLED", async () => {
    const { unwiredObligationsIn } = await load();
    expect(unwiredObligationsIn(fixture(`import { runMergeKill } from "./m.js";\nconst r = runMergeKill({});`)))
      .toEqual([]);
  });
});
