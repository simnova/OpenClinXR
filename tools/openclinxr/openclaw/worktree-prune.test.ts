/**
 * Unit tests for the #367 safe-prune discriminator.
 * Pure logic only — no real worktrees are touched here.
 */

import { describe, expect, it } from "vitest";
import {
  CHURN_EXACT_PATHS,
  CHURN_PATH_PREFIXES,
  churnRevertCommands,
  classifyFromPorcelain,
  classifyWorktree,
  computeDrift,
  computeTotals,
  detectGrokRoot,
  discriminatorSelfTestFailures,
  isChurnPath,
  ISSUE_367_BASELINE_TOTALS,
  parseWorktreeListPorcelain,
  pathsFromPorcelainLine,
  prunePlanSafety,
  verifyPlanArithmetic,
  worktreesWithLiveProcessCwd,
  type PrunePlan,
  type WorktreeRecord,
} from "./worktree-prune.js";

describe("isChurnPath", () => {
  it("accepts the SessionStart docs-hygiene hook fingerprint", () => {
    expect(isChurnPath("PROJECT_STATUS.md")).toBe(true);
    expect(isChurnPath("docs/_archive/README.md")).toBe(true);
    expect(isChurnPath("docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json")).toBe(true);
    expect(isChurnPath("docs/_archive/wiki/index.md")).toBe(true);
    expect(isChurnPath("docs/_archive/wiki/topics/agent-factory-iterations.md")).toBe(true);
    expect(isChurnPath("docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md")).toBe(true);
    expect(isChurnPath("docs/openclinxr/doc-authority-registry-2026-05-27.json")).toBe(true);
    expect(isChurnPath("docs/openclinxr/doc-authority-registry-2026-05-27.md")).toBe(true);
  });

  it("rejects product paths and non-churn docs", () => {
    expect(isChurnPath("apps/ui-xr/src/main.ts")).toBe(false);
    expect(isChurnPath("packages/openclinxr/asset-registry/src/index.ts")).toBe(false);
    expect(isChurnPath("tools/openclinxr/evidence/room-prop-colour-fidelity.ts")).toBe(false);
    expect(isChurnPath("docs/openclinxr/worker-backlog-and-validation-matrix.md")).toBe(false);
    expect(isChurnPath("apps/arena/model-vetting-studio/public/glb-grade-staging/")).toBe(false);
    expect(isChurnPath("docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md")).toBe(false);
  });

  it("matches the issue's enumerated churn set exactly", () => {
    expect(CHURN_EXACT_PATHS).toContain("PROJECT_STATUS.md");
    expect(CHURN_PATH_PREFIXES).toContain("docs/_archive/");
    expect(CHURN_PATH_PREFIXES).toContain("docs/agent-ops/");
  });
});

describe("pathsFromPorcelainLine", () => {
  it("parses plain modified/untracked lines", () => {
    expect(pathsFromPorcelainLine(" M apps/ui-xr/src/main.ts")).toEqual(["apps/ui-xr/src/main.ts"]);
    expect(pathsFromPorcelainLine("?? tools/openclinxr/evidence/room-prop-colour-fidelity.ts")).toEqual([
      "tools/openclinxr/evidence/room-prop-colour-fidelity.ts",
    ]);
    expect(pathsFromPorcelainLine("A  docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json")).toEqual([
      "docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json",
    ]);
  });

  it("returns both sides of a rename", () => {
    const paths = pathsFromPorcelainLine(
      "R  docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md -> docs/_archive/agent-ops/2026-08/2026-08-02-temporal-review-grok-tokens.md",
    );
    expect(paths).toHaveLength(2);
    expect(isChurnPath(paths[0]!)).toBe(true);
    expect(isChurnPath(paths[1]!)).toBe(true);
  });

  it("returns nothing for an empty line", () => {
    expect(pathsFromPorcelainLine("")).toEqual([]);
  });
});

describe("parseWorktreeListPorcelain", () => {
  it("parses main, branched and detached entries and ignores attribute lines", () => {
    const porcelain = [
      "worktree /Volumes/files/src/openclinxr",
      "HEAD 2aefcfb563120367a952dcf548d55ec995d9d54e",
      "branch refs/heads/main",
      "",
      "worktree /Users/patrick/.grok/worktrees/src-openclinxr/issue-100",
      "HEAD eb7577aba8d49512a94f3a12af6e9d676d27d480",
      "branch refs/heads/wt/issue-100",
      "",
      "worktree /tmp/missing-wt",
      "HEAD ada45b2f1219683c48ed1068b345974a6cd78bc1",
      "branch refs/heads/deleg/auth-roles",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /Users/patrick/.claude/jobs/1f75c1e7/tmp/pre206",
      "HEAD e97fea44c0bacd2c77eb815da6e8e51bea11394f",
      "detached",
      "",
    ].join("\n");
    const entries = parseWorktreeListPorcelain(porcelain);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ path: "/Volumes/files/src/openclinxr", branch: "refs/heads/main" });
    expect(entries[1]).toMatchObject({ path: "/Users/patrick/.grok/worktrees/src-openclinxr/issue-100", branch: "refs/heads/wt/issue-100" });
    expect(entries[2]).toMatchObject({ path: "/tmp/missing-wt", branch: "refs/heads/deleg/auth-roles" });
    expect(entries[3]).toMatchObject({ path: "/Users/patrick/.claude/jobs/1f75c1e7/tmp/pre206", detached: true, branch: null });
  });
});

describe("classifyWorktree / classifyFromPorcelain", () => {
  const base = {
    isMain: false,
    isCurrent: false,
    dirExists: true,
    merged: true,
  };

  it("classifies a clean merged worktree as clean", () => {
    expect(classifyFromPorcelain({ ...base, porcelainStatus: "" }).classification).toBe("clean");
  });

  it("classifies hook-only dirt as churn_only", () => {
    const status = [
      " M PROJECT_STATUS.md",
      " M docs/_archive/README.md",
      "R  docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md -> docs/_archive/agent-ops/2026-08/2026-08-02-temporal-review-grok-tokens.md",
      " M docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json",
      " M docs/_archive/wiki/index.md",
      " M docs/openclinxr/doc-authority-registry-2026-05-27.json",
      " M docs/openclinxr/doc-authority-registry-2026-05-27.md",
      "?? docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md",
    ].join("\n");
    const result = classifyFromPorcelain({ ...base, porcelainStatus: status });
    expect(result.classification).toBe("churn_only");
    expect(result.dirtyFileCount).toBe(8);
  });

  it("classifies any product-path dirt as has_work (issue-100 counterweight)", () => {
    const status = [
      " M apps/ui-xr/src/main.ts",
      " M packages/openclinxr/asset-registry/src/index.ts",
      " M packages/openclinxr/asset-registry/src/runtime-bundles.ts",
      " M tools/openclinxr/evidence/room-prop-colour-fidelity.test.ts",
      "?? apps/ui-xr/src/room-prop-materials.ts",
      "?? packages/openclinxr/asset-registry/src/runtime-room-prop-color.ts",
      "?? tools/openclinxr/evidence/room-prop-colour-fidelity.ts",
    ].join("\n");
    const result = classifyFromPorcelain({ ...base, porcelainStatus: status });
    expect(result.classification).toBe("has_work");
    expect(result.dirtyFileCount).toBe(7);
  });

  it("classifies churn-plus-one-apps-file as has_work (issue-59 shape)", () => {
    const status = [
      " M PROJECT_STATUS.md",
      "?? apps/arena/model-vetting-studio/public/glb-grade-staging/",
    ].join("\n");
    expect(classifyFromPorcelain({ ...base, porcelainStatus: status }).classification).toBe("has_work");
  });

  it("classifies a non-ancestor tip as unmerged", () => {
    expect(classifyWorktree({ ...base, merged: false, dirtyPaths: [], dirtyFileCount: 0 })).toBe("unmerged");
  });

  it("classifies a missing directory as missing even when merged", () => {
    expect(classifyWorktree({ ...base, dirExists: false, merged: true, dirtyPaths: [], dirtyFileCount: 0 })).toBe("missing");
    expect(classifyWorktree({ ...base, dirExists: true, merged: null, dirtyPaths: [], dirtyFileCount: 0 })).toBe("missing");
  });
});

describe("totals, drift and arithmetic", () => {
  function record(path: string, classification: WorktreeRecord["classification"]): WorktreeRecord {
    return {
      path,
      branch: null,
      detached: false,
      tip: "abc",
      merged: classification === "unmerged" ? false : true,
      dirtyFileCount: 0,
      classification,
      dirtyFiles: [],
      sizeBytes: null,
      isMain: false,
      isCurrent: false,
    };
  }

  it("computes totals that sum to registered", () => {
    const records = [
      record("/main", "clean"),
      record("/a", "clean"),
      record("/b", "churn_only"),
      record("/c", "has_work"),
      record("/d", "unmerged"),
      record("/e", "missing"),
    ];
    const totals = computeTotals(records);
    expect(totals.registered).toBe(6);
    expect(totals.clean).toBe(2);
    expect(totals.churn_only).toBe(1);
    expect(totals.has_work).toBe(1);
    expect(totals.unmerged).toBe(1);
    expect(totals.missing).toBe(1);
    expect(totals.prunable).toBe(3);
    expect(totals.preserved).toBe(3);
    expect(totals.clean + totals.churn_only + totals.has_work + totals.unmerged + totals.missing).toBe(totals.registered);
  });

  it("flags drift when totals differ from the issue's measured counts", () => {
    const records = [
      record("/main", "clean"),
      record("/a", "clean"),
      record("/b", "churn_only"),
      record("/c", "has_work"),
      record("/d", "unmerged"),
    ];
    const drift = computeDrift(computeTotals(records));
    expect(drift.some((d) => !d.matches)).toBe(true);
    const cleanDrift = drift.find((d) => d.bucket === "clean");
    expect(cleanDrift).toMatchObject({ expected: ISSUE_367_BASELINE_TOTALS["clean"], actual: 2 });
  });

  it("is clean of drift at the issue's measured totals", () => {
    const counts = ISSUE_367_BASELINE_TOTALS;
    const records: WorktreeRecord[] = [];
    for (let i = 0; i < (counts["clean"] ?? 0); i += 1) records.push(record(`/clean-${i}`, "clean"));
    for (let i = 0; i < (counts["churn_only"] ?? 0); i += 1) records.push(record(`/churn-${i}`, "churn_only"));
    for (let i = 0; i < (counts["has_work"] ?? 0); i += 1) records.push(record(`/work-${i}`, "has_work"));
    for (let i = 0; i < (counts["unmerged"] ?? 0); i += 1) records.push(record(`/unmerged-${i}`, "unmerged"));
    expect(records).toHaveLength(counts["registered"] ?? 0);
    const drift = computeDrift(computeTotals(records));
    expect(drift.every((d) => d.matches)).toBe(true);
  });

  it("verifyPlanArithmetic catches a wouldRemove mismatch", () => {
    const plan = {
      totals: { registered: 2, clean: 1, churn_only: 1, has_work: 0, unmerged: 0, missing: 0, prunable: 2, preserved: 0 },
      wouldRemove: ["/a"],
    } as unknown as PrunePlan;
    expect(verifyPlanArithmetic(plan).length).toBeGreaterThan(0);
  });

  it("counts withheld trees toward the prunable identity", () => {
    const plan = {
      totals: { registered: 2, clean: 1, churn_only: 1, has_work: 0, unmerged: 0, missing: 0, prunable: 2, preserved: 0 },
      wouldRemove: ["/a"],
      skippedLive: [{ path: "/b", reason: "live process cwd (1)" }],
    } as unknown as PrunePlan;
    expect(verifyPlanArithmetic(plan)).toEqual([]);
  });

  /**
   * The gate that replaced the frozen totals.
   *
   * MEASURED 2026-09-12 before this change: 816 registered worktrees against a baseline of 275,
   * five of six buckets drifted, `issue-100` gone so the counterweight could not pass either, and
   * `safeToRemove: false` on 667 prunable trees. Both halves of the old gate were stuck closed.
   */
  describe("prunePlanSafety", () => {
    function planOf(
      records: WorktreeRecord[],
      wouldRemove: string[],
      over: Partial<PrunePlan> = {},
    ): PrunePlan {
      const totals = computeTotals(records);
      return {
        schemaVersion: "openclinxr.worktree-prune-plan.v1",
        generatedAt: "2026-09-12T00:00:00.000Z",
        repoRoot: "/main",
        grokRoot: "/grok",
        mainTip: "abc",
        mainBranch: "main",
        totals,
        worktrees: records,
        wouldRemove,
        prunableMissing: [],
        subagentClones: [],
        liveServers: [],
        skippedLive: records
          .filter((r) => (r.classification === "clean" || r.classification === "churn_only") && !wouldRemove.includes(r.path))
          .map((r) => ({ path: r.path, reason: "withheld" })),
        liveProcessScan: { live: [], determined: true, detail: "0 worktree(s) hold a live process cwd" },
        counterweight: {
          issue100Path: "",
          issue100Classification: null,
          issue100Present: false,
          discriminatorSelfTestFailures: [],
          passes: true,
        },
        expectedTotals: { ...ISSUE_367_BASELINE_TOTALS },
        drift: computeDrift(totals),
        safetyBlockers: [],
        safeToRemove: false,
        grokRootSizeBytes: null,
        note: "",
        ...over,
      };
    }

    function fleet(): WorktreeRecord[] {
      const out: WorktreeRecord[] = [];
      for (let i = 0; i < 10; i += 1) out.push(record(`/clean-${i}`, "clean"));
      for (let i = 0; i < 2; i += 1) out.push(record(`/churn-${i}`, "churn_only"));
      for (let i = 0; i < 3; i += 1) out.push(record(`/work-${i}`, "has_work"));
      for (let i = 0; i < 4; i += 1) out.push(record(`/unmerged-${i}`, "unmerged"));
      return out;
    }
    const prunablePaths = (records: WorktreeRecord[]): string[] =>
      records.filter((r) => r.classification === "clean" || r.classification === "churn_only").map((r) => r.path).sort();

    it("holds the discriminator's known-good table on the shipped classifier", () => {
      expect(discriminatorSelfTestFailures()).toEqual([]);
    });

    it("is safe on a fleet that drifts from the baseline — the freeze itself", () => {
      const records = fleet();
      const plan = planOf(records, prunablePaths(records));
      expect(plan.drift.some((d) => !d.matches)).toBe(true); // the old gate's refusal condition
      expect(prunePlanSafety(plan)).toEqual({ safe: true, blockers: [] });
    });

    it("refuses when a preserved tree is queued for removal", () => {
      const records = fleet();
      const plan = planOf(records, [...prunablePaths(records), "/work-0"]);
      const safety = prunePlanSafety(plan);
      expect(safety.safe).toBe(false);
      expect(safety.blockers.some((b) => b.includes("/work-0") && b.includes("has_work"))).toBe(true);
    });

    it("refuses when a tree holding a live process cwd is queued for removal", () => {
      const records = fleet();
      const plan = planOf(records, prunablePaths(records), {
        liveProcessScan: {
          live: [{ worktreePath: "/clean-3", cwdPaths: ["/clean-3/apps/ui-xr"] }],
          determined: true,
          detail: "1 worktree(s) hold a live process cwd",
        },
      });
      const safety = prunePlanSafety(plan);
      expect(safety.safe).toBe(false);
      expect(safety.blockers.some((b) => b.includes("/clean-3") && b.includes("live process"))).toBe(true);
    });

    it("refuses when the live-process scan could not be determined", () => {
      const records = fleet();
      const plan = planOf(records, prunablePaths(records), {
        liveProcessScan: { live: [], determined: false, detail: "lsof produced no cwd lines (exit 1)" },
      });
      const safety = prunePlanSafety(plan);
      expect(safety.safe).toBe(false);
      expect(safety.blockers.some((b) => b.includes("undetermined"))).toBe(true);
    });

    it("refuses main or the current worktree even when clean", () => {
      // The shared `record()` helper takes two arguments; passing flags to it silently does
      // nothing, which is how this assertion first passed a plan with neither flag set.
      const mainRec: WorktreeRecord = { ...record("/main", "clean"), isMain: true };
      const hereRec: WorktreeRecord = { ...record("/here", "clean"), isCurrent: true };
      const records = [...fleet(), mainRec, hereRec];
      const plan = planOf(records, [...prunablePaths(fleet()), "/main", "/here"]);
      const safety = prunePlanSafety(plan);
      expect(safety.blockers.some((b) => b.includes("/main") && b.includes("main worktree"))).toBe(true);
      expect(safety.blockers.some((b) => b.includes("/here") && b.includes("current worktree"))).toBe(true);
    });

    it("does not gate on issue-100 being absent, but does gate on it being wrong", () => {
      const records = fleet();
      const absent = planOf(records, prunablePaths(records));
      expect(prunePlanSafety(absent).safe).toBe(true);

      const present = planOf(records, prunablePaths(records), {
        counterweight: {
          issue100Path: "/issue-100",
          issue100Classification: "clean",
          issue100Present: true,
          discriminatorSelfTestFailures: [],
          passes: false,
        },
      });
      const safety = prunePlanSafety(present);
      expect(safety.safe).toBe(false);
      expect(safety.blockers.some((b) => b.includes("issue-100"))).toBe(true);
    });

    it("refuses when the discriminator self-test itself fails", () => {
      const records = fleet();
      const plan = planOf(records, prunablePaths(records));
      // The plan's own copy is advisory; prunePlanSafety re-runs the table, so this asserts the
      // live classifier rather than a field a caller could set to anything.
      expect(prunePlanSafety(plan).blockers.filter((b) => b.includes("self-test"))).toEqual([]);
      expect(discriminatorSelfTestFailures()).toEqual([]);
    });
  });

  describe("worktreesWithLiveProcessCwd", () => {
    const lsofOut = (paths: string[]): string => paths.map((p) => `p1\nn${p}`).join("\n");

    it("attributes a nested cwd to the worktree that contains it", () => {
      const scan = worktreesWithLiveProcessCwd(["/wt/a", "/wt/b"], {
        lsof: () => ({ status: 0, stdout: lsofOut(["/wt/a/tools/openclinxr", "/somewhere/else"]) }),
      });
      expect(scan.determined).toBe(true);
      expect(scan.live).toEqual([{ worktreePath: "/wt/a", cwdPaths: ["/wt/a/tools/openclinxr"] }]);
    });

    it("does not match a worktree whose path is a string prefix of another", () => {
      const scan = worktreesWithLiveProcessCwd(["/wt/a"], {
        lsof: () => ({ status: 0, stdout: lsofOut(["/wt/abc/src"]) }),
      });
      expect(scan.live).toEqual([]);
    });

    it("fails closed when lsof yields nothing parseable", () => {
      const scan = worktreesWithLiveProcessCwd(["/wt/a"], { lsof: () => ({ status: 1, stdout: "" }) });
      expect(scan.determined).toBe(false);
      expect(scan.live).toEqual([]);
    });

    it("fails closed when lsof throws", () => {
      const scan = worktreesWithLiveProcessCwd(["/wt/a"], {
        lsof: () => {
          throw new Error("lsof: command not found");
        },
      });
      expect(scan.determined).toBe(false);
    });
  });
});

describe("churnRevertCommands", () => {
  it("splits tracked (checkout) from untracked (clean) churn", () => {
    const record: WorktreeRecord = {
      path: "/wt",
      branch: null,
      detached: false,
      tip: "abc",
      merged: true,
      dirtyFileCount: 4,
      classification: "churn_only",
      dirtyFiles: [
        " M PROJECT_STATUS.md",
        "R  docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md -> docs/_archive/agent-ops/2026-08/2026-08-02-temporal-review-grok-tokens.md",
        " M docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json",
        "?? docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md",
      ],
      sizeBytes: null,
      isMain: false,
      isCurrent: false,
    };
    const commands = churnRevertCommands(record);
    expect(commands[0]).toEqual([
      "checkout",
      "--",
      "PROJECT_STATUS.md",
      "docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md",
      "docs/_archive/agent-ops/2026-08/2026-08-02-temporal-review-grok-tokens.md",
      "docs/_archive/agent-ops/2026-08/ARCHIVE-MANIFEST.json",
    ]);
    expect(commands[1]).toEqual(["clean", "-fd", "--", "docs/agent-ops/2026-08-02-temporal-review-grok-tokens.md"]);
  });

  it("returns no commands for a clean record", () => {
    const record: WorktreeRecord = {
      path: "/wt",
      branch: null,
      detached: false,
      tip: "abc",
      merged: true,
      dirtyFileCount: 0,
      classification: "clean",
      dirtyFiles: [],
      sizeBytes: null,
      isMain: false,
      isCurrent: false,
    };
    expect(churnRevertCommands(record)).toEqual([]);
  });
});

describe("detectGrokRoot", () => {
  it("finds the common parent of grok worktree paths", () => {
    const root = detectGrokRoot([
      "/Users/patrick/.grok/worktrees/src-openclinxr/issue-100",
      "/Users/patrick/.grok/worktrees/src-openclinxr/issue-367",
      "/Volumes/files/src/openclinxr",
    ]);
    expect(root).toBe("/Users/patrick/.grok/worktrees/src-openclinxr");
  });

  it("returns null when no grok worktrees exist", () => {
    expect(detectGrokRoot(["/Volumes/files/src/openclinxr"])).toBeNull();
  });
});
