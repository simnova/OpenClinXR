import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import {
  assembleDispatchContract,
  assertSafeEnvironment,
  assertWorktreeContractGate,
  buildArgv,
  buildContractPromptAppendix,
  buildRoleCharterAppendix,
  buildTextOnlyVisionDenies,
  buildTextOnlyVisionPromptAppendix,
  dispatch,
  isTextOnlyModel,
  latestSessionFor,
  loadTrustedBrief,
  parseResult,
  readSessions,
  assertProofShape,
  recordSession,
  resolveWorkerWorktree,
  TrustedBriefDivergenceError,
  WORKTREE_ROOT,
  buildWorktreeIsolationDenies,
} from "./dispatch-worker.js";

// #241: the dispatch path spawns the grok binary; a streaming-json child emits NDJSON events and
// must still yield a sessionId. Mock the spawn so no real worker is launched.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const spawnMock = vi.mocked(spawn);

/** The dispatched prompt now lives in the file named by --prompt-file; argv[1] is a path. */
function readPromptFile(argv: string[]): string {
  const i = argv.indexOf("--prompt-file");
  expect(i, "the dispatch must pass the prompt via --prompt-file").toBeGreaterThanOrEqual(0);
  return readFileSync(argv[i + 1]!, "utf8");
}

/** A fake ChildProcess whose stdout emits the given bytes, then closes 0. */
function fakeChildWithOutput(output: string, stderr = ""): ReturnType<typeof spawn> {
  const stdout = new EventEmitter();
  const stderrBus = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = stdout;
  child.stderr = stderrBus;
  setImmediate(() => {
    stdout.emit("data", Buffer.from(output));
    stderrBus.emit("data", Buffer.from(stderr));
    child.emit("close", 0);
  });
  return child as unknown as ReturnType<typeof spawn>;
}

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("dispatch-worker argv", () => {
  it("passes the prompt via --prompt-file, so embedded flags never reach grok's argument scan", () => {
    // ISSUE #437 (measured): the prompt was the value of -p, and flag-looking tokens inside it
    // (e.g. "--output-logs", "--filter" in the composed role charter) reached grok's OWN argument
    // scan and hung dispatch five times — no child, no exception, alive past 90 s. The file must
    // hold the FULL prompt (a stub would send the worker nothing), and the 2026-08-05 ordering
    // incident is moot because the prompt is no longer an argv element at all.
    const argv = buildArgv({ prompt: "do the thing", resume: "019f-abc" });
    expect(argv[0]).toBe("--prompt-file");
    expect(argv).not.toContain("-p");
    const path = argv[1]!;
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("do the thing");
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

  it("defaults to flash-first model — frontier / pro are opt-in per task", () => {
    expect(buildArgv({ prompt: "x" })).toContain("deepseek-v4-flash");
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

/**
 * PLANTED CONTRACTS (#246) — a corrected issue body does not refresh the trusted brief.
 *
 * MEASURED 2026-08-09 on #241: first dispatch synthesizes `.openclinxr/slices/<id>/brief.json`
 * from that moment's proofs (2 rules, written once). The issue body is then corrected to 3 proofs.
 * A re-dispatch MERGES the new proofs with the stored brief, so dispatch evaluates the union
 * (4 rules, including a superseded `exists:.openclinxr/evidence/issue-241/pre-fix.json`) while
 * `contract-verify-cli` — which reads ONLY the trusted brief — evaluates the STORED 2. The merge
 * gate reported success; the rule count was the only tell.
 *
 * FIX CHOICE (implementer's, recorded per the issue): REFUSE by default, refresh on explicit
 * opt-in. The stored brief is the anti-weakening plane; an automatic overwrite would let an
 * accidentally-weak proof set silently replace a strict contract. A refusal preserves that
 * property and makes the divergence LOUD; `refreshTrustedBrief: true` is the only sanctioned way
 * to change a trusted brief, and it is what makes the merge gate bind the corrected contract.
 */
describe("issue #246 — a corrected done_when must refresh the trusted brief or REFUSE", () => {
  function sliceWithStoredBrief(): { root: string; slice: string } {
    const trusted = mkdtempSync(join(tmpdir(), "dispatch-246-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = trusted;
    resetCoordinationRootCache();
    const slice = "issue-246-corrected";
    const trustedSlice = join(trusted, ".openclinxr", "slices", slice);
    mkdirSync(trustedSlice, { recursive: true });
    // The 01:42 state: the first dispatch synthesized the brief with the ORIGINAL 2-rule set.
    writeFileSync(
      join(trustedSlice, "brief.json"),
      JSON.stringify({
        schemaVersion: "openclinxr.slice-brief.v1",
        id: slice,
        goal: "test",
        q_gate: "Q5",
        autonomy: "worker",
        roles: {},
        done_when: [
          "run:pnpm exec vitest run tools/openclinxr/openclaw/dispatch-worker.test.ts",
          "exists:.openclinxr/evidence/issue-241/pre-fix.json",
        ],
        synthesized: true,
      }),
    );
    return { root: trusted, slice };
  }

  const correctedProofs = [
    "run:pnpm exec vitest run tools/openclinxr/openclaw/dispatch-worker.test.ts",
    "exists:tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson",
    "min-bytes:tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson:2000",
  ];

  it("REFUSES a dispatch whose proofs differ from the stored brief, without writing anything", () => {
    const { root, slice } = sliceWithStoredBrief();
    const briefPath = join(root, ".openclinxr", "slices", slice, "brief.json");
    const before = readFileSync(briefPath, "utf8");

    expect(() =>
      assembleDispatchContract({
        repoRoot: root,
        sliceId: slice,
        dispatchProofs: correctedProofs,
      }),
    ).toThrow(TrustedBriefDivergenceError);

    // The trusted plane is untouched by the refusal — a refusal must cost nothing.
    expect(readFileSync(briefPath, "utf8")).toBe(before);
  });

  it("names the divergence so the orchestrator knows the merge gate would verify stale rules", () => {
    const { root, slice } = sliceWithStoredBrief();
    let error: unknown;
    try {
      assembleDispatchContract({ repoRoot: root, sliceId: slice, dispatchProofs: correctedProofs });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TrustedBriefDivergenceError);
    const err = error as TrustedBriefDivergenceError;
    expect(err.storedTreeRules).toHaveLength(2);
    expect(err.dispatchTreeRules).toHaveLength(3);
    expect(err.message).toMatch(/refreshTrustedBrief: true/);
    expect(err.message).toMatch(/anti-weakening/);
  });

  it("REFRESHES the trusted brief when the orchestrator explicitly passes refreshTrustedBrief", () => {
    const { root, slice } = sliceWithStoredBrief();
    const assembled = assembleDispatchContract({
      repoRoot: root,
      sliceId: slice,
      dispatchProofs: correctedProofs,
      refreshTrustedBrief: true,
    });

    expect(assembled.contractSource).toBe("brief-refreshed");
    // Dispatch now evaluates exactly the corrected set — not the union with the superseded rules.
    expect(assembled.treeProofs).toEqual(correctedProofs);

    const stored = loadTrustedBrief(join(root, ".openclinxr", "slices", slice));
    expect(stored?.done_when).toEqual(correctedProofs);
    expect(stored?.["refreshed"]).toBe(true);
    expect(stored?.["synthesized"]).toBe(true); // other brief fields survive the refresh
  });

  it("does not refuse when the dispatch proofs match the stored brief (no false positive)", () => {
    const { root, slice } = sliceWithStoredBrief();
    const matching = [
      "run:pnpm exec vitest run tools/openclinxr/openclaw/dispatch-worker.test.ts",
      "exists:.openclinxr/evidence/issue-241/pre-fix.json",
    ];
    const assembled = assembleDispatchContract({
      repoRoot: root,
      sliceId: slice,
      dispatchProofs: matching,
    });
    expect(assembled.treeProofs).toEqual(matching);
    expect(assembled.contractSource).toBe("brief+dispatch");
  });

  it("ignores rule ORDER in the divergence check — a reordered identical set is not a correction", () => {
    const { root, slice } = sliceWithStoredBrief();
    const reordered = [
      "exists:.openclinxr/evidence/issue-241/pre-fix.json",
      "run:pnpm exec vitest run tools/openclinxr/openclaw/dispatch-worker.test.ts",
    ];
    expect(() =>
      assembleDispatchContract({ repoRoot: root, sliceId: slice, dispatchProofs: reordered }),
    ).not.toThrow(TrustedBriefDivergenceError);
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

  it("main dirty path created only by orchestrator during dispatch is not reported as worker leak", async () => {
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

  it("main dirty path not attributable to orchestrator is still reported as isolation leak", async () => {
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

  it("isolation leak failure still records sessionId in worker-sessions ledger", async () => {
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

  it("a freshly created worktree is prepared so a worker can run the brief's verify without installing first", async () => {
    const mod = await load();
    const prepare = mod["prepareWorktreeForWorker"] as undefined | ((path: string) => unknown);
    // 3/3 retro'd workers burned opening turns discovering node_modules was absent.
    expect(prepare).toBeTypeOf("function");
  });
});

/**
 * PLANTED CONTRACTS (#54) — a prepared worktree still cannot build.
 *
 * PROVEN, not inferred. A bare worktree at HEAD given exactly the preparation dispatch performs
 * (`pnpm install --prefer-offline --frozen-lockfile`) fails `pnpm test` with 17 test files failing
 * on "Failed to resolve entry for package @openclinxr/shared-schemas / @cellix/provider-contracts /
 * @openclinxr/exam-assembly". Running `pnpm packages:build` in that same worktree takes it to
 * 138 passed, 0 failed.
 *
 * Cause: workspace packages are build-emitting (MADR 0033), their `exports` point at `dist/`,
 * `dist/` is gitignored, so `git worktree add` never brings it and `pnpm install` never creates it.
 * `prepareWorktreeForWorker` installs and stops.
 *
 * This CORRECTS the issue as filed. The #42 worker reported "ui-xr dist PROVENANCE and
 * .openclinxr/*"; `PROVENANCE.md` is tracked and arrives fine, and the evidence tests hardcoding
 * `.openclinxr/...` were not the failure. A worker's account of itself is still a claim.
 *
 * The peer round rejected every cheaper option with a reason: copying `dist/` from main ships wrong
 * artifacts when the worktree SHA differs, symlinking makes a worker's edits hit main's dist, and
 * building only brief-touched packages fails on transitive imports — which is why four unrelated
 * packages failed together above.
 *
 * It also caught a hole I would have shipped: the early return on the vitest marker alone
 * (`prepareWorktreeForWorker`) means an install-only tree stays "ready" forever, so adding a build
 * step without touching that check leaves the bug reachable.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These tests inject a command runner so they assert the
 * build was EXECUTED rather than that files appeared — `mkdir dist && touch index.js` satisfies a
 * file-presence assertion and builds nothing. If a different seam is better, change the call sites
 * here and say why in the commit.
 */
describe("a prepared worktree can actually build (#54)", () => {
  const load = async () => import("./dispatch-worker.js") as Promise<Record<string, unknown>>;

  type Run = (command: string, args: readonly string[]) => void;
  type Prepare = (path: string, options?: { run?: Run }) => { method: string };

  function worktreeFixture(withVitest: boolean): string {
    const root = mkdtempSync(join(tmpdir(), "openclinxr-wt54-"));
    if (withVitest) {
      mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(root, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
    }
    return root;
  }

  /** Materialise the workspace dist marker so the post-prep refuse gate can distinguish success. */
  function materialiseDistMarker(root: string): void {
    const dist = join(root, "packages/openclinxr/shared-schemas/dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.js"), "export {};\n");
  }

  it("builds workspace packages, not only installing them", async () => {
    const mod = await load();
    const prepare = mod["prepareWorktreeForWorker"] as Prepare;
    const commands: string[] = [];
    const root = worktreeFixture(false);
    prepare(root, {
      run: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        // Simulate a successful packages:build (execution is what we assert; refuse gate needs the marker).
        if (args.some((a) => /build/.test(a))) materialiseDistMarker(root);
        if (command === "pnpm" && args[0] === "install") {
          mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
          writeFileSync(join(root, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
        }
      },
    });
    // Asserting EXECUTION, not artifacts: a test that checks for dist/ can be satisfied by touch.
    expect(commands.some((c) => /build/.test(c))).toBe(true);
  });

  it("rebuilds when the vitest marker exists but workspace dist does not", async () => {
    // The latent hole: an install-only tree keeps its vitest binary and would report "existing"
    // forever, so the build step would never run on exactly the trees that need it.
    const mod = await load();
    const prepare = mod["prepareWorktreeForWorker"] as Prepare;
    const commands: string[] = [];
    const root = worktreeFixture(true);
    const result = prepare(root, {
      run: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        if (args.some((a) => /build/.test(a))) materialiseDistMarker(root);
      },
    });
    expect(result.method).not.toBe("existing");
    expect(commands.some((c) => /build/.test(c))).toBe(true);
  });

  it("refuses to hand over a worktree whose workspace dist is still missing after preparation", async () => {
    // Fixture HAS the vitest binary, so the old code early-returned "existing" and threw nothing.
    // Without that setup the function throws for a DIFFERENT reason (missing vitest), which would
    // make this contract pass while proving nothing about dist — a false green wearing the right name.
    const mod = await load();
    const prepare = mod["prepareWorktreeForWorker"] as Prepare;
    expect(() => prepare(worktreeFixture(true), { run: () => { /* a build that produces nothing */ } })).toThrow(/dist|build/i);
  });
});

describe("parseResult — plain json vs streaming-json NDJSON (issue #241)", () => {
  // Plain `--output-format json` emits ONE JSON document with top-level fields (measured from
  // .openclinxr/openclaw/worker-last-result.json on the shared coordination root).
  const plainJson = JSON.stringify({
    text: "the final answer",
    stopReason: "end_turn",
    sessionId: "019f-plain-0001",
    requestId: "req-1",
    usage: {},
    num_turns: 12,
    modelUsage: {},
  });

  it("extracts sessionId from plain --output-format json", () => {
    const r = parseResult(plainJson);
    expect(r.sessionId).toBe("019f-plain-0001");
    expect(r.turns).toBe(12);
    expect(r.stopReason).toBe("end_turn");
    expect(r.text).toBe("the final answer");
  });

  it("extracts sessionId from the REAL captured streaming-json fixture (tracked, not hand-authored)", () => {
    // The done_when requires the fixture to be a real captured stream committed to a tracked
    // path — a hand-authored fixture would encode whatever shape was assumed and pass against
    // itself, which is exactly how the first fix (9dd8122c, params.sessionId) fooled its own
    // tests. This fixture is the byte-for-byte stdout of
    //   grok -p "Reply with exactly: PROBE" --model deepseek-v4-flash \
    //        --output-format streaming-json --max-turns 2
    // (6,989 bytes, 35 lines; events discriminated by TOP-LEVEL `type`; sessionId /
    // stopReason / num_turns ride the `end` event at top level — there is NO `params` wrapper).
    const fixture = readFileSync(
      new URL("./__fixtures__/streaming-json-sample.ndjson", import.meta.url),
      "utf8",
    );
    const r = parseResult(fixture);
    expect(r.sessionId).toBe("019fe52f-194d-7dd1-8c3f-a041742bc4ed");
    expect(r.turns).toBe(1);
    expect(r.stopReason).toBe("end_turn");
    expect(r.text).toBe("PROBE");
  });

  it("extracts sessionId from NDJSON streaming-json events, where it rides the end event at top level", () => {
    // Shape measured on real streaming-json output (see the fixture above): flat ACP events
    // with a top-level `type`, sessionId/stopReason/num_turns on `end`, text in `data` of
    // `text` events. This hand-built stream mirrors that shape for unit-level edge cases.
    const ndjson = [
      JSON.stringify({ type: "available_commands", tools: ["read_file"] }),
      JSON.stringify({ type: "thought", data: "thinking" }),
      JSON.stringify({ type: "text", data: "part one" }),
      JSON.stringify({ type: "text", data: "part two" }),
      JSON.stringify({ type: "usage", usage: { input_tokens: 10 } }),
      JSON.stringify({ type: "end", stopReason: "end_turn", sessionId: "019f-stream-0002", num_turns: 34 }),
    ].join("\n");
    const r = parseResult(ndjson);
    expect(r.sessionId).toBe("019f-stream-0002");
    expect(r.turns).toBe(34);
    expect(r.stopReason).toBe("end_turn");
    expect(r.text).toBe("part onepart two");
  });

  it("tolerates an unterminated final line from a chunk boundary", () => {
    const ndjson = [
      JSON.stringify({ type: "end", stopReason: "end_turn", sessionId: "019f-stream-0003", num_turns: 4 }),
      '{"type":"end","stopReason":"end_turn","sessionId":"019f-stream-0003",',
    ].join("\n");
    const r = parseResult(ndjson);
    expect(r.sessionId).toBe("019f-stream-0003");
    expect(r.turns).toBe(4);
  });

  it("still collapses to {} on garbage output, preserving the fail-closed dispatch throw", () => {
    expect(parseResult("this is not json at all\n")).toEqual({});
    expect(parseResult("")).toEqual({});
  });
});

describe("dispatch with a streaming-json child (issue #241)", () => {
  it("yields a sessionId when the child emits NDJSON events, so the contract report still lands", async () => {
    // Pre-fix this threw "Dispatch produced no sessionId" after the worker had finished: the
    // parse collapsed to {} and recordSession / the post-exit proof re-run were skipped.
    const root = mkdtempSync(join(tmpdir(), "dispatch-streaming-"));
    // Flat ACP event shape measured on real streaming-json output (top-level `type`,
    // sessionId/stopReason/num_turns on `end`, text in `data` of `text` events).
    const ndjson = [
      JSON.stringify({ type: "thought", data: "reasoning" }),
      JSON.stringify({ type: "text", data: "done" }),
      JSON.stringify({ type: "end", stopReason: "end_turn", sessionId: "019f-dispatch-stream", num_turns: 3 }),
    ].join("\n");
    spawnMock.mockReturnValue(fakeChildWithOutput(ndjson));

    const entry = await dispatch(root, {
      prompt: "do the thing",
      streaming: true,
      slice: "issue-241-streaming",
      contract: "none",
      contractReason: "issue-241 test: a streaming-json child must still yield a sessionId",
    });

    // ISSUE #439: the entry is keyed on the id dispatch CHOSE before spawn (passed to the child
    // as --session-id), not the id scraped from the child's output — so the ledger entry exists
    // and stays resumable even when the child dies before `end`. The old assertion (entry keyed
    // on the scraped "019f-dispatch-stream") encoded the pre-fix behaviour.
    const argv = spawnMock.mock.calls[0]![1] as string[];
    const suppliedId = argv[argv.indexOf("--session-id") + 1]!;
    expect(entry.sessionId).toBe(suppliedId);
    expect(entry.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(entry.turns).toBe(3);
    expect(entry.stopReason).toBe("end_turn");
    // The raw child output is persisted, so the orchestrator can resume the worker by id.
    const lastResult = readFileSync(join(root, ".openclinxr/openclaw/worker-last-result.json"), "utf8");
    expect(lastResult).toContain("019f-dispatch-stream");
    expect(spawnMock).toHaveBeenCalled();
  });
});

/**
 * PLANTED CONTRACTS (#242) — a text-only model that Reads an image hard-crashes the dispatch.
 *
 * MEASURED 2026-08-09 (not inferred): dispatched deepseek-v4-flash and asked it to Read an
 * existing capture PNG. The Read tool SUCCEEDS — it embeds the PNG into the transcript as an
 * image_url content block — and the NEXT API call is rejected wholesale:
 *
 *   API error (status 400 Bad Request): invalid_request_error:
 *   Failed to deserialize the JSON body into the target type:
 *   messages[7]: unknown variant `image_url`, expected `text`
 *
 * Reproduced in this slice at the dispatch level (113,449 input tokens, exit 1, no sessionId,
 * zero turns of work) and at the API level for ALL five deepseek ids the grok CLI exposes:
 * deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-pro-anthropic, deepseek, deepseek-pro-chat —
 * every one returns the same serde 400. This resolves the issue's "Not determined" for pro.
 *
 * FENCE CHOICE (implementer's, recorded): deny the Read tool on image/video extensions for
 * text-only models, mechanically, in dispatch(). NOT brief-time refusal on image proofs (a
 * text-only worker can produce a PNG via scripts — that is the sanctioned producer/grader split;
 * and the crash happens on reads the proofs never mention) and NOT auto-routing to a vision
 * model (routing judgment lives in the spawn-spec path, grok-repo-agent-spawn.ts
 * requiresMultimodalReasoning -> grok-4-fast). The deny fires for every text-only dispatch and
 * converts the fatal 400 into a survivable "denied by a permission policy" read.
 *
 * These tests constrain the BEHAVIOUR: classification of text-only ids, one deny per extension,
 * and the dispatch wiring (denies present for deepseek, absent for vision models).
 */
describe("issue #242 — text-only models cannot Read images (the 400 fence)", () => {
  const textOnlyIds = [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4-pro-anthropic",
    "deepseek",
    "deepseek-pro-chat",
    "deepseek-via-moon",
  ];
  const visionIds = ["grok-4.5", "grok-4-multi-agent", "x-grok-3", "x-grok-4", "x-reasoning"];

  it("classifies every deepseek model id the CLI exposes as text-only", () => {
    for (const model of textOnlyIds) {
      expect(isTextOnlyModel(model), `${model} must be text-only`).toBe(true);
    }
  });

  it("leaves vision-capable models unfenced", () => {
    for (const model of visionIds) {
      expect(isTextOnlyModel(model), `${model} must be vision-capable`).toBe(false);
    }
  });

  it("builds one Read deny per image/video extension, with the Tool(glob) grammar", () => {
    const denies = buildTextOnlyVisionDenies();
    expect(denies).toContain("Read(**/*.png)");
    expect(denies).toContain("Read(**/*.jpg)");
    expect(denies).toContain("Read(**/*.webm)");
    // Every rule is a Read deny over a glob ending in a media extension (digits included: mp4).
    for (const rule of denies) {
      expect(rule).toMatch(/^Read\(\*\*\/(?:\*\.)+[a-z0-9]+\)$/);
    }
    expect(denies.length).toBeGreaterThanOrEqual(10);
  });

  it("appends the Read denies to a text-only dispatch's argv before spawn", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-vision-fence-"));
    spawnMock.mockReturnValue(
      fakeChildWithOutput(JSON.stringify({ text: "done", sessionId: "019f-vision-fence", num_turns: 1, stopReason: "end_turn" })),
    );
    await dispatch(root, {
      prompt: "grade this capture",
      model: "deepseek-v4-flash",
      slice: "issue-242-text-only",
      contract: "none",
      contractReason: "issue-242 test: a text-only dispatch must carry the Read denies",
    });
    const argv = spawnMock.mock.calls.at(-1)![1] as string[];
    expect(argv).toContain("--deny");
    expect(argv).toContain("Read(**/*.png)");
    expect(argv).toContain("Read(**/*.webm)");
  });

  it("does not deny Read for a vision-capable model", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-vision-open-"));
    spawnMock.mockReturnValue(
      fakeChildWithOutput(JSON.stringify({ text: "done", sessionId: "019f-vision-open", num_turns: 1, stopReason: "end_turn" })),
    );
    await dispatch(root, {
      prompt: "grade this capture",
      model: "grok-4.5",
      slice: "issue-242-vision",
      contract: "none",
      contractReason: "issue-242 test: a vision-capable dispatch must NOT carry Read denies",
    });
    const argv = spawnMock.mock.calls.at(-1)![1] as string[];
    expect(argv.filter((a) => a.startsWith("Read("))).toEqual([]);
  });

  it("warns the text-only worker in the prompt why image Reads are denied", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-vision-prompt-"));
    spawnMock.mockReturnValue(
      fakeChildWithOutput(JSON.stringify({ text: "done", sessionId: "019f-vision-prompt", num_turns: 1, stopReason: "end_turn" })),
    );
    await dispatch(root, {
      prompt: "grade this capture",
      model: "deepseek-v4-pro",
      slice: "issue-242-prompt",
      contract: "none",
      contractReason: "issue-242 test: the text-only prompt appendix must reach the worker",
    });
    const argv = spawnMock.mock.calls.at(-1)![1] as string[];
    const prompt = readPromptFile(argv);
    expect(prompt).toContain("TEXT-ONLY MODEL");
    expect(prompt).toContain("deepseek-v4-pro");
    expect(prompt).toContain("400");
  });
});

/**
 * PLANTED CONTRACT (#435) — `role:` was a label reaching only the ledger. `dispatch()` now
 * composes the PROVEN baker output (buildRepoAgentSpawnPrompt) into the worker prompt so the
 * dispatched worker runs with its role's charter (Persona, memory, escalate contract). These unit
 * tests constrain the export contract; the evidence test at
 * tools/openclinxr/evidence/dispatch-binds-the-role-charter.test.ts asserts the full clause set.
 */
describe("buildRoleCharterAppendix (#435)", () => {
  it("binds a known role's charter: Persona, memory, and escalate contract", () => {
    const text = buildRoleCharterAppendix("xr-systems-architect");
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("xr-systems-architect");
    expect(text).toContain("charter.md");
    expect(text).toContain("memory.md");
    expect(text).toContain("UNABLE:");
  });

  it("returns an empty string for an unknown or blank role id instead of throwing", () => {
    expect(buildRoleCharterAppendix("no-such-role")).toBe("");
    expect(buildRoleCharterAppendix("")).toBe("");
    expect(buildRoleCharterAppendix("   ")).toBe("");
  });

  it("composes the role charter into the dispatched prompt alongside the contract appendix", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatch-role-charter-"));
    // The resolver discovers agents/<group>/<role> from disk requiring all three files; stub them
    // in the temp root so the wiring test exercises the real resolution path.
    const roleDir = join(root, "agents/core", "xr-systems-architect");
    mkdirSync(roleDir, { recursive: true });
    writeFileSync(join(roleDir, "charter.md"), "## Persona\nplaceholder");
    writeFileSync(join(roleDir, "memory.md"), "placeholder memory");
    writeFileSync(join(roleDir, "index.json"), "{}");
    spawnMock.mockReturnValue(
      fakeChildWithOutput(JSON.stringify({ text: "done", sessionId: "019f-role-charter", num_turns: 1, stopReason: "end_turn" })),
    );
    await dispatch(root, {
      prompt: "do the thing",
      role: "xr-systems-architect",
      proofs: ["run:node -e \"process.exit(0)\""],
      slice: "issue-435-wiring",
    });
    const argv = spawnMock.mock.calls.at(-1)![1] as string[];
    const prompt = readPromptFile(argv);
    expect(prompt).toContain("ROLE CHARTER");
    expect(prompt).toContain("xr-systems-architect");
    expect(prompt).toContain("charter.md");
    expect(prompt).toContain("CONTRACT PROOFS");
  });
});
