import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import {
  assembleDispatchContract,
  assertSafeEnvironment,
  assertWorktreeContractGate,
  buildArgv,
  buildContractPromptAppendix,
  latestSessionFor,
  readSessions,
  assertProofShape,
  recordSession,
  resolveWorkerWorktree,
  WORKTREE_ROOT,
  buildWorktreeIsolationDenies,
} from "./dispatch-worker.js";

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("dispatch-worker argv", () => {
  it("puts the prompt immediately after -p, because -p CONSUMES the next token", () => {
    // The 2026-08-05 incident: `-p --resume <id> "<prompt>"` made --resume the value of -p, and
    // grok aborted with "a value is required for '--single <PROMPT>'" while the wrapper exited 0.
    const argv = buildArgv({ prompt: "do the thing", resume: "019f-abc" });
    expect(argv[0]).toBe("-p");
    expect(argv[1]).toBe("do the thing");
    expect(argv.indexOf("--resume")).toBeGreaterThan(1);
  });

  it("defaults max-turns to a runaway backstop, not a budget", () => {
    // Caps in the 25-70 band killed real workers at the boundary; median success is 21 turns.
    const turns = Number(buildArgv({ prompt: "x" })[buildArgv({ prompt: "x" }).indexOf("--max-turns") + 1]);
    expect(turns).toBeGreaterThanOrEqual(150);
  });

  it("uses streaming-json when asked, so stalls are visible while the worker is alive", () => {
    expect(buildArgv({ prompt: "x", streaming: true })).toContain("streaming-json");
    expect(buildArgv({ prompt: "x" })).toContain("json");
  });

  it("defaults to the cheap model — frontier is opt-in per task", () => {
    expect(buildArgv({ prompt: "x" })).toContain("deepseek-v4-pro");
    expect(buildArgv({ prompt: "x", model: "grok-4.5" })).toContain("grok-4.5");
  });
});

describe("credential-leak guard", () => {
  it("refuses to dispatch when debug logging would leak the bearer token", () => {
    expect(() => assertSafeEnvironment({ RUST_LOG: "debug" })).toThrow(/REFUSING TO DISPATCH/);
    expect(() => assertSafeEnvironment({ GROK_DEBUG_FILE: "/tmp/x" })).toThrow(/REFUSING TO DISPATCH/);
  });

  it("allows a clean environment", () => {
    expect(() => assertSafeEnvironment({ PATH: "/usr/bin" })).not.toThrow();
  });
});

describe("session ledger", () => {
  it("survives the process that created it, so a dead worker stays resumable", () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-ledger-"));
    recordSession(root, { sessionId: "019f-one", slice: "s1", model: "m", at: "2026-08-05T00:00:00Z" });
    recordSession(root, { sessionId: "019f-two", slice: "s1", model: "m", at: "2026-08-05T01:00:00Z" });
    recordSession(root, { sessionId: "019f-other", slice: "s2", model: "m", at: "2026-08-05T02:00:00Z" });

    expect(readSessions(root)).toHaveLength(3);
    // Resuming a slice means resuming its MOST RECENT worker, not its first.
    expect(latestSessionFor(root, "s1")?.sessionId).toBe("019f-two");
    expect(latestSessionFor(root, "missing")).toBeUndefined();
  });

  it("tolerates a corrupt line rather than losing every other id", () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-ledger-"));
    recordSession(root, { sessionId: "019f-good", model: "m", at: "2026-08-05T00:00:00Z" });
    appendFileSync(join(root, ".openclinxr/openclaw/worker-sessions.jsonl"), "{ not json\n");
    recordSession(root, { sessionId: "019f-later", model: "m", at: "2026-08-05T03:00:00Z" });

    expect(readSessions(root).map((entry) => entry.sessionId)).toEqual(["019f-good", "019f-later"]);
  });
});

describe("worktree binding — the concurrent-writer unlock", () => {
  const MAIN = "/repo/main";

  it("denies writes to the MAIN checkout, which is what lets N writers run at once", () => {
    // PROVEN by control/treatment: without these a worker given --cwd elsewhere still wrote an
    // absolute path under main; with them it reported "denied by a permission policy".
    expect(buildWorktreeIsolationDenies(MAIN)).toEqual([
      "Write(/repo/main/**)",
      "Edit(/repo/main/**)",
    ]);
  });

  it("refuses a worktree INSIDE main, because the deny would block the worker's own edits", () => {
    expect(() => resolveWorkerWorktree(MAIN, `${MAIN}/.claude/worktrees/x`, "x")).toThrow(
      /INSIDE the main checkout/,
    );
  });

  it("accepts a worktree outside main", () => {
    expect(resolveWorkerWorktree(MAIN, "/elsewhere/wt-a", "a")).toBe("/elsewhere/wt-a");
  });

  it("keeps worktrees outside the main tree by default", () => {
    expect(WORKTREE_ROOT.startsWith(MAIN)).toBe(false);
    expect(WORKTREE_ROOT).toContain("worktrees");
  });
});

describe("layer-3 contract tier gate — unproofed worktree dispatch must not be silent", () => {
  it("throws when worktree-bound with no tree proofs and no contract:none", () => {
    // INCIDENT: a worktree-bound worker with empty done_when is uncheckable — its report is not
    // evidence and nothing mechanical re-runs. Fail before spawn.
    expect(() =>
      assertWorktreeContractGate({
        worktreeBound: true,
        treeProofs: [],
        sliceId: "layer3-contract-wiring",
      }),
    ).toThrow(/uncheckable|no machine-checkable tree proofs/);
  });

  it("throws contract:none without a reason", () => {
    expect(() =>
      assertWorktreeContractGate({
        worktreeBound: true,
        treeProofs: [],
        sliceId: "layer3-contract-wiring",
        contract: "none",
      }),
    ).toThrow(/contractReason/);
  });

  it("allows contract:none WITH a reason (recorded by caller on the ledger)", () => {
    expect(() =>
      assertWorktreeContractGate({
        worktreeBound: true,
        treeProofs: [],
        sliceId: "layer3-contract-wiring",
        contract: "none",
        contractReason: "read-only scout; no tree mutations expected",
      }),
    ).not.toThrow();
  });

  it("allows worktree-bound dispatch when tree proofs are present", () => {
    expect(() =>
      assertWorktreeContractGate({
        worktreeBound: true,
        treeProofs: ["exists:packages/openclinxr/agent-loop/src/done-when-rules.ts"],
        sliceId: "layer3-contract-wiring",
      }),
    ).not.toThrow();
  });

  it("does not tier-gate non-worktree dispatches (legacy main-tree path)", () => {
    expect(() =>
      assertWorktreeContractGate({
        worktreeBound: false,
        treeProofs: [],
        sliceId: "local",
      }),
    ).not.toThrow();
  });
});

describe("layer-3 assembleDispatchContract — trusted brief plane", () => {
  it("loads tree proofs from the TRUSTED coordination root, never a worktree-local brief", () => {
    // INCIDENT (H2 family): worker can write <worktree>/.openclinxr/... freely. Contract data
    // must come from the shared root (OPENCLINXR_COORDINATION_ROOT in tests).
    const trusted = mkdtempSync(join(tmpdir(), "dispatch-trusted-"));
    const worktree = mkdtempSync(join(tmpdir(), "dispatch-wt-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = trusted;
    resetCoordinationRootCache();

    const slice = "slice-contract-a";
    const trustedSlice = join(trusted, ".openclinxr", "slices", slice);
    mkdirSync(trustedSlice, { recursive: true });
    writeFileSync(
      join(trustedSlice, "brief.json"),
      JSON.stringify({
        schemaVersion: "openclinxr.slice-brief.v1",
        id: slice,
        goal: "test",
        q_gate: "Q5",
        autonomy: "worker",
        roles: {},
        done_when: ["exists:src/real.ts", "handoff:x:done"],
      }),
    );
    // Forged brief in the worktree — must be ignored.
    mkdirSync(join(worktree, ".openclinxr", "slices", slice), { recursive: true });
    writeFileSync(
      join(worktree, ".openclinxr", "slices", slice, "brief.json"),
      JSON.stringify({ done_when: ["exists:forged.ts"] }),
    );

    const assembled = assembleDispatchContract({ repoRoot: worktree, sliceId: slice });
    expect(assembled.treeProofs).toEqual(["exists:src/real.ts"]);
    expect(assembled.contractSource).toBe("brief");
    expect(assembled.trustedSliceDir).toBe(trustedSlice);
  });

  it("synthesizes a trusted brief when only dispatch proofs are supplied", () => {
    const trusted = mkdtempSync(join(tmpdir(), "dispatch-synth-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = trusted;
    resetCoordinationRootCache();

    const assembled = assembleDispatchContract({
      repoRoot: trusted,
      sliceId: "synth-slice",
      dispatchProofs: ["changed:packages/foo/**", "handoff:r:done"],
    });
    expect(assembled.contractSource).toBe("synthesized");
    expect(assembled.treeProofs).toEqual(["changed:packages/foo/**"]);
    expect(assembled.brief?.synthesized).toBe(true);
  });

  it("records contractReason on assemble when contract is none", () => {
    const trusted = mkdtempSync(join(tmpdir(), "dispatch-none-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = trusted;
    resetCoordinationRootCache();

    const assembled = assembleDispatchContract({
      repoRoot: trusted,
      sliceId: "none-slice",
      contract: "none",
      contractReason: "exploratory no-op",
    });
    expect(assembled.contractSource).toBe("none");
    expect(assembled.contractReason).toBe("exploratory no-op");
    expect(assembled.treeProofs).toEqual([]);
  });
});

describe("layer-3 contract prompt appendix", () => {
  it("states that the orchestrator re-runs proofs and the report is not evidence", () => {
    const block = buildContractPromptAppendix(["exists:a.ts", "run:pnpm test"]);
    expect(block).toMatch(/orchestrator re-runs/i);
    expect(block).toMatch(/NOT evidence/i);
    expect(block).toContain("exists:a.ts");
    expect(block).toContain("run:pnpm test");
  });
});

describe("proof-shape validation — every failure is a missing test", () => {
  // INCIDENT 2026-08-05: dispatching with the ORIGINAL design's object shape
  //   proofs: [{ id, description, kind: "command", run }]
  // produced `TypeError: rule.startsWith is not a function` from deep inside rule evaluation.
  // `proofs` are done_when STRINGS ("run:…", "changed:…"). The raw TypeError names neither the
  // offending value nor the expected format, and cost four dispatch attempts to diagnose.
  // A confusing error for a plausible mistake is a missing test, not user error.
  it("rejects a non-string proof with a message naming the expected format", () => {
    expect(() =>
      assertProofShape([{ id: "x", kind: "command", run: "pnpm test" } as unknown as string]),
    ).toThrow(/done_when string/i);
  });

  it("names the offending value so the caller can see what it passed", () => {
    expect(() => assertProofShape([{ id: "concurrency" } as unknown as string])).toThrow(/concurrency/);
  });

  it("rejects a string with no recognised rule prefix", () => {
    expect(() => assertProofShape(["prove the concurrency is safe"])).toThrow(/exists:|run:|changed:/);
  });

  it("accepts the real done_when rule kinds", () => {
    expect(() =>
      assertProofShape(["run:pnpm architecture", "changed:docs/x.md", "exists:dist/index.js", "min-bytes:a.png:100"]),
    ).not.toThrow();
  });
});

// NOTE: this block does NOT prove correspondence with the evaluator — it asserts that
// assertProofShape accepts rule strings typed here by hand. The real A-to-B binding lives in
// agent-loop's slice-team.test.ts, which drives evaluateDoneWhenRule from the vocabulary constant.
// The original name ("must not drift from the evaluator") claimed the stronger property and was
// exactly the overclaim pattern this session kept producing: one green check, a confident name.
describe("regression: rule kinds assertProofShape must accept", () => {
  // REFACTOR step of red-green-refactor. The GREEN implementation hardcoded a prefix list in this
  // file while the real vocabulary lives in done-when-rules.ts. Duplicated knowledge drifts, and it
  // already had: `handoffs:all-done` is a valid rule matched EXACTLY, not by prefix, so the
  // validator rejected a legitimate proof. Skipping refactor is how a green bar hides a new bug.
  it("accepts handoffs:all-done, which is matched exactly rather than by prefix", () => {
    // Paired with a tree proof: this asserts the rule is RECOGNISED, not that narrative alone
    // suffices — a separate rule below rejects narrative-only sets.
    expect(() => assertProofShape(["handoffs:all-done", "run:true"])).not.toThrow();
  });

  it("accepts every rule kind the evaluator actually implements", () => {
    const implemented = [
      "exists:dist/x.js",
      "min-bytes:a.png:100",
      "run:pnpm architecture",
      "changed:docs/x.md",
      "handoff:asset-pipeline-lead:done",
      "skeptic:visible",
      "handoffs:all-done",
    ];
    for (const rule of implemented) {
      // Each paired with a tree proof so this tests RECOGNITION only; the narrative-only policy is
      // asserted separately.
      expect(() => assertProofShape([rule, "run:true"]), `evaluator implements ${rule}`).not.toThrow();
    }
  });
});

describe("narrative rules cannot stand in for tree proofs", () => {
  // `handoff:` / `skeptic:` / `handoffs:all-done` read a worker's own handoff JSON — they are the
  // worker's account of itself, which is precisely what the contract exists NOT to trust. Only
  // exists:/min-bytes:/run:/changed: inspect the tree.
  //
  // assertProofShape blessed narrative-only proofs, and the tier gate then rejected the dispatch
  // with "no machine-checkable tree proofs" — telling a caller who DID pass proofs that they passed
  // none. Confusing error for a plausible mistake: a missing test, not user error.
  it("rejects a narrative-only proof set, naming why it cannot be trusted", () => {
    expect(() => assertProofShape(["skeptic:visible"])).toThrow(/tree/i);
    expect(() => assertProofShape(["handoff:asset-pipeline-lead:done"])).toThrow(/tree/i);
    expect(() => assertProofShape(["handoffs:all-done"])).toThrow(/tree/i);
  });

  it("accepts narrative rules ALONGSIDE at least one tree proof", () => {
    expect(() => assertProofShape(["skeptic:visible", "run:pnpm architecture"])).not.toThrow();
  });

  it("still accepts tree proofs on their own", () => {
    expect(() => assertProofShape(["changed:docs/x.md"])).not.toThrow();
  });
});

/**
 * PLANTED CONTRACTS (#47 + #48) — the dispatch path taxes or destroys the work it supervises.
 *
 * #48: `mainDirtyBefore` is snapshotted at :585 and diffed at :612, so ANY path that becomes dirty
 * in main during the window reads as a worker leak. The orchestrator writing to main during a
 * dispatch is not an accident — the loop mandates it ("dispatch both lanes' workers BEFORE verifying
 * either"). It aborted a successful #41 dispatch by flagging files the orchestrator had just created.
 *
 * The two attribution contracts pull against each other on purpose. Suppressing the false positive
 * by trusting all main-tree dirt would satisfy the first and fail the second; deleting the detector
 * fails both. It must stay: the `--deny` is a literal-path matcher, not an FS sandbox, so a computed
 * path escapes it and this check is the only watcher.
 *
 * #48 also destroys evidence. The leak throw at :615 precedes `recordSession` at :655, so an
 * isolation failure writes NO ledger entry — which is why #41 has no session id and can never be
 * retrospected. A dispatch that fails is exactly the one worth asking about afterwards.
 *
 * #47: `git worktree add` checks out tracked files only. 3/3 retro'd workers reported no
 * `node_modules`; #37 got a cache-green architecture result on a tree that could not build, which is
 * worse than a clean failure because it reads as a passing gate.
 *
 * DESIGN LEFT OPEN — implementer chooses and records it in the commit message: how a main-tree change
 * is attributed to the orchestrator rather than the worker. Candidates include an explicit declared
 * path set on DispatchOptions, comparing against the worker's own worktree diff, or narrowing to the
 * worker's declared write roots. The tests below constrain the BEHAVIOUR, not the mechanism, so the
 * attribution input may be shaped however the implementation needs.
 */
describe("dispatch path does not tax or destroy the work it supervises (#47, #48)", () => {
  const load = async () => import("./dispatch-worker.js") as Promise<Record<string, unknown>>;

  it.fails("main dirty path created only by orchestrator during dispatch is not reported as worker leak", async () => {
    const mod = await load();
    const attribute = mod["attributeIsolationLeak"] as undefined | ((input: {
      before: readonly string[];
      after: readonly string[];
      orchestratorPaths?: readonly string[];
    }) => string[]);
    expect(attribute).toBeTypeOf("function");
    // Exactly the #41 case: a file the orchestrator created in main while the worker ran.
    const leaked = attribute!({
      before: [],
      after: ["tools/openclinxr/openclaw/board-session-map.ts"],
      orchestratorPaths: ["tools/openclinxr/openclaw/board-session-map.ts"],
    });
    expect(leaked).toEqual([]);
  });

  it.fails("main dirty path not attributable to orchestrator is still reported as isolation leak", async () => {
    const mod = await load();
    const attribute = mod["attributeIsolationLeak"] as undefined | ((input: {
      before: readonly string[];
      after: readonly string[];
      orchestratorPaths?: readonly string[];
    }) => string[]);
    expect(attribute).toBeTypeOf("function");
    // The detector must survive its own bug fix — this is the leak it exists to catch.
    const leaked = attribute!({
      before: [],
      after: ["apps/api/src/secretly-written-by-worker.ts"],
      orchestratorPaths: ["tools/openclinxr/openclaw/board-session-map.ts"],
    });
    expect(leaked).toEqual(["apps/api/src/secretly-written-by-worker.ts"]);
  });

  it.fails("isolation leak failure still records sessionId in worker-sessions ledger", async () => {
    // #41 finished correct work, failed on a false leak, and left no session id — so the one
    // dispatch most worth a retrospective is the one that cannot have it.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./dispatch-worker.ts", import.meta.url), "utf8"));
    const throwAt = source.indexOf("leaked writes into the MAIN checkout");
    const recordAt = source.indexOf("recordSession(repoRoot, entry)");
    expect(throwAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(-1);
    // The ledger write must not sit downstream of the throw that skips it.
    expect(recordAt).toBeLessThan(throwAt);
  });

  it.fails("a freshly created worktree is prepared so a worker can run the brief's verify without installing first", async () => {
    const mod = await load();
    const prepare = mod["prepareWorktreeForWorker"] as undefined | ((path: string) => unknown);
    // 3/3 retro'd workers burned opening turns discovering node_modules was absent.
    expect(prepare).toBeTypeOf("function");
  });
});
