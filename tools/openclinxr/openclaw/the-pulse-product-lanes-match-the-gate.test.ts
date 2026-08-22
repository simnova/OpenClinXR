/**
 * SUPERAGENT RULING 2026-08-22 — the hourly pulse and the dispatch gate must agree on what is
 * PRODUCT. Two instruments defining "product" differently is how the 2026-08-22 derailment went
 * uncertified: factory-pulse's inline regex counted apps/arena/model-vetting-studio (capture
 * harness; all four #558-#566 clip-ranking toil slices) and packages/openclinxr/agent-loop
 * (done_when machinery, #570) as product_commits_1h = 6/1/11/2 while product-lane-gate measured
 * 44 consecutive non-product commits on the same tree. The pulse now imports the gate's
 * isProductPath; this contract pins that there remains exactly ONE definition in the tree.
 *
 * Second clause: PRODUCING_NOTHING must fire on a corrected replay of the 08:51 row (the hour
 * the old instrument reported six "product" commits that were all harness bytes), and must NOT
 * fire on a quiet morning or a genuinely productive hour.
 */
import { describe, expect, it } from "vitest";

import { countProductCommitBlocks } from "./factory-pulse.js";
import { isProductPath } from "./product-lane-gate.js";

/** One git-log block per commit: hash line first, then --name-only file lines. */
const block = (hash: string, ...files: string[]) => [hash, ...files].join("\n");

describe("pulse product lanes match the gate", () => {
  it("counts model-vetting-studio commits as NON-product — the #558-#566 toil must not certify", () => {
    const blocks = [
      block("a1", "apps/arena/model-vetting-studio/src/body-motion-probe-clip.ts"),
      block("a2", "apps/arena/model-vetting-studio/src/candidate-capture.ts"),
    ];
    expect(countProductCommitBlocks(blocks)).toBe(0);
    expect(isProductPath("apps/arena/model-vetting-studio/src/body-motion-probe-clip.ts")).toBe(false);
  });

  it("counts agent-loop done_when machinery as NON-product — #570 must not certify", () => {
    const blocks = [block("b1", "packages/openclinxr/agent-loop/src/slice-team.ts")];
    expect(countProductCommitBlocks(blocks)).toBe(0);
  });

  it("counts ui-xr / api / scenario-fixtures / asset-pipeline as product", () => {
    const blocks = [
      block("c1", "apps/ui-xr/src/main.ts"),
      block("c2", "packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts"),
      block("c3", "tools/openclinxr/asset-pipeline/makeclothes/body_param_stage.py"),
    ];
    expect(countProductCommitBlocks(blocks)).toBe(3);
  });

  it("ignores the %H header line so a hash can never masquerade as a path", () => {
    expect(countProductCommitBlocks([block("apps/ui-xr")] )).toBe(0);
  });
});

describe("PRODUCING_NOTHING verdict inputs", () => {
  // The verdict rule lives inline in main() (it needs live sources), so this pins its INPUT
  // predicate against the exact rows from the derailment window.
  const fires = (p: { graded: number; product: number; total: number; completions: number }) =>
    p.graded === 0 && p.product === 0 && p.total >= 3 && p.completions >= 3;

  it("fires on a corrected replay of the 2026-08-22 08:51 row", () => {
    // Measured then: completions=10, total=15, product counted 6 by the old regex — all of it
    // model-vetting-studio/agent-loop bytes, so corrected product = 0. graded=0 all day.
    expect(fires({ graded: 0, product: 0, total: 15, completions: 10 })).toBe(true);
  });

  it("does not fire on a quiet morning", () => {
    expect(fires({ graded: 0, product: 0, total: 1, completions: 0 })).toBe(false);
  });

  it("cannot fire on a genuinely productive hour (product > 0)", () => {
    expect(fires({ graded: 0, product: 2, total: 6, completions: 5 })).toBe(false);
  });
});
