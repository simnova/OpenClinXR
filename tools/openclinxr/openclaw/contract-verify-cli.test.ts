import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import {
  assembleDispatchContract,
  loadTrustedBrief,
} from "./dispatch-worker.js";
import { verifySliceContract } from "./contract-verify-cli.js";

/**
 * PLANTED CONTRACTS (#246) — the merge-time gate reads ONLY the trusted brief, which is why a
 * corrected issue body silently stopped binding.
 *
 * MEASURED 2026-08-09 on #241: the stored brief's done_when (2 rules) is what
 * `contract-verify-cli` evaluates at merge time, while the corrected issue had 3 proofs. The two
 * new proofs were never machine-checked by the gate. The #246 fix makes a divergent dispatch
 * REFUSE unless the orchestrator explicitly refreshes the trusted brief (refreshTrustedBrief) —
 * and once refreshed, THIS CLI evaluates the corrected set. These tests pin both halves: the gate
 * evaluates exactly the trusted brief's tree proofs, and a refresh is what binds the correction.
 */
describe("contract-verify-cli — the merge-time gate and the #246 refresh", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env["OPENCLINXR_COORDINATION_ROOT"];
    resetCoordinationRootCache();
  });

  function setup(input: { doneWhen: string[]; treeFile?: string }): {
    coordinationRoot: string;
    tree: string;
    slice: string;
  } {
    const coordinationRoot = mkdtempSync(join(tmpdir(), "cv-246-coord-"));
    const tree = mkdtempSync(join(tmpdir(), "cv-246-tree-"));
    tempRoots.push(coordinationRoot, tree);
    process.env["OPENCLINXR_COORDINATION_ROOT"] = coordinationRoot;
    resetCoordinationRootCache();

    const slice = "issue-246-merge";
    const trustedSlice = join(coordinationRoot, ".openclinxr", "slices", slice);
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
        done_when: input.doneWhen,
      }),
    );
    if (input.treeFile) {
      mkdirSync(join(tree, dirname(input.treeFile)), { recursive: true });
      writeFileSync(join(tree, input.treeFile), "marker");
    }
    return { coordinationRoot, tree, slice };
  }

  it("evaluates exactly the trusted brief's tree proofs — the plane that went stale in #241", async () => {
    const { tree, slice } = setup({
      // The 01:42 first-dispatch state of #241: 2 rules in the trusted brief.
      doneWhen: [
        "exists:src/real.ts",
        "exists:.openclinxr/evidence/issue-241/pre-fix.json",
      ],
      treeFile: "src/real.ts",
    });

    const { report } = await verifySliceContract({ slice, tree });

    expect(report.checks.map((c) => c.rule)).toEqual([
      "exists:src/real.ts",
      "exists:.openclinxr/evidence/issue-241/pre-fix.json",
    ]);
    // The corrected proofs are NOT in the brief, so the gate never sees them — the #246 defect.
    expect(report.checks.some((c) => c.rule.includes("streaming-json-sample"))).toBe(false);
  });

  it("binds the CORRECTED set at merge time once the orchestrator explicitly refreshes the brief", async () => {
    const { coordinationRoot, tree, slice } = setup({
      doneWhen: ["exists:src/real.ts"],
      treeFile: "src/real.ts",
    });

    // The orchestrator corrects the issue and re-dispatches with the new proofs + explicit
    // acknowledgment. assembleDispatchContract rewrites the trusted brief (refuse-by-default is
    // tested in dispatch-worker.test.ts; this is the accept path).
    const correctedProofs = [
      "exists:src/real.ts",
      "exists:tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson",
      "min-bytes:tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson:2000",
    ];
    const assembled = assembleDispatchContract({
      repoRoot: coordinationRoot,
      sliceId: slice,
      dispatchProofs: correctedProofs,
      refreshTrustedBrief: true,
    });
    expect(assembled.contractSource).toBe("brief-refreshed");

    // The merge-time gate now verifies the corrected set — no more silent gap.
    const { report } = await verifySliceContract({ slice, tree });
    expect(report.checks.map((c) => c.rule)).toEqual(correctedProofs);
    expect(report.proofsOk).toBe(false); // the fixture file is absent from this temp tree; the
    // POINT is that the gate now evaluates it, not that it passes here.
  });

  it("rejects a slice with no trusted brief (hard refusal, distinct from contract failure)", async () => {
    const { tree } = setup({ doneWhen: ["exists:src/real.ts"] });
    await expect(verifySliceContract({ slice: "issue-246-never-dispatched", tree }))
      .rejects.toThrow(/No trusted brief/);
  });

  it("evaluates a narrative-only brief as a hard refusal, not a vacuous pass", async () => {
    const { tree, slice } = setup({ doneWhen: ["handoff:r:done"] });
    await expect(verifySliceContract({ slice, tree })).rejects.toThrow(/no tree proofs/);
  });

  it("after a refresh, the stored brief on disk carries the corrected done_when verbatim", async () => {
    const { coordinationRoot, tree, slice } = setup({ doneWhen: ["exists:src/real.ts"] });
    const correctedProofs = [
      "exists:src/real.ts",
      "exists:tools/openclinxr/openclaw/__fixtures__/streaming-json-sample.ndjson",
    ];
    assembleDispatchContract({
      repoRoot: coordinationRoot,
      sliceId: slice,
      dispatchProofs: correctedProofs,
      refreshTrustedBrief: true,
    });
    const stored = loadTrustedBrief(join(coordinationRoot, ".openclinxr", "slices", slice));
    expect(stored?.done_when).toEqual(correctedProofs);
    expect(stored?.["refreshed"]).toBe(true);
  });
});
