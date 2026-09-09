import { describe, expect, it } from "vitest";
import { briefFromIssue } from "./board-brief.js";

/**
 * Board → brief. The missing direction: board-cli only ever WROTE to the board (open/status/close),
 * so every brief today was hand-written and the board recorded outcomes after the fact.
 *
 * The load-bearing behaviour is REFUSAL. An issue is prose; a dispatch needs machine-checkable
 * proofs. If this synthesises plausible-looking proofs from a title, the whole contract layer
 * becomes decorative — a worker would be judged against criteria nobody chose. Most of the current
 * board is not dispatchable, and saying so is the correct output.
 */

const withProofs = `## factory_step: body_param
Fix the deferred strictness deltas.

## done_when
- run:pnpm packages:typecheck:agent
- changed:packages/openclinxr/domain/tsconfig.json
`;

describe("briefFromIssue", () => {
  it("refuses an issue with no done_when block rather than inventing proofs", () => {
    const result = briefFromIssue({ number: 29, title: "Composition maturity", body: "Two builders, unclear." });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/done_when/i);
  });

  it("refuses an issue whose done_when has only narrative rules", () => {
    // Narrative rules read the worker's own handoff — its account of itself.
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: room_generate\n## done_when\n- skeptic:visible\n",
    });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/tree/i);
  });

  it("refuses a done_when rule the evaluator cannot run", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: lip_sync\n## done_when\n- prove it works\n",
    });
    expect(result.dispatchable).toBe(false);
  });

  it("produces a brief with proofs taken VERBATIM from the issue", () => {
    const result = briefFromIssue({ number: 28, title: "Strictness deltas", body: withProofs });
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    // Verbatim matters: a proof the orchestrator paraphrased is a proof nobody agreed to.
    expect(result.proofs).toEqual([
      "run:pnpm packages:typecheck:agent",
      "changed:packages/openclinxr/domain/tsconfig.json",
    ]);
    expect(result.slice).toBe("issue-28");
  });

  it("carries the issue body into the brief so the worker sees the ask, not a summary", () => {
    const result = briefFromIssue({ number: 28, title: "Strictness deltas", body: withProofs });
    if (!result.dispatchable) throw new Error("expected dispatchable brief");
    expect(result.prompt).toContain("Strictness deltas");
    expect(result.prompt).toContain("Fix the deferred strictness deltas.");
  });
});

describe("done_when extraction stops at the bullet list", () => {
  // INCIDENT: the first real issue written for this pipeline was REFUSED by it. The done_when block
  // was well-formed; the extractor ran to the next `##` heading and swallowed a trailing prose
  // paragraph that began with bold text, then reported that prose as an unrunnable rule. A parser
  // that rejects correct input teaches people to write for the parser instead of for the reader.
  it("ignores prose that follows the bullets without a new heading", () => {
    const body = [
      "## factory_step: equipment_generate",
      "## done_when",
      "",
      "- run:pnpm architecture",
      "- changed:src/a.ts",
      "",
      "**Notes for whoever takes this.** Do not weaken the test to fit an easier implementation.",
    ].join("\n");
    const result = briefFromIssue({ number: 1, title: "x", body });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:pnpm architecture", "changed:src/a.ts"]);
  });

  it("still stops at a following heading", () => {
    const body = "## factory_step: motion_retarget\n## done_when\n- run:pnpm architecture\n\n## notes\n- not a proof\n";
    const result = briefFromIssue({ number: 1, title: "x", body });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:pnpm architecture"]);
  });
});

describe("factory_step gate (D9 dark factory)", () => {
  it("refuses an issue with a done_when block but no factory_step line", () => {
    const result = briefFromIssue({ number: 1, title: "x", body: "## done_when\n- run:pnpm architecture\n" });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/factory_step/i);
  });

  it("refuses a factory_step value that is not a known station", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: magic\n## done_when\n- run:pnpm architecture\n",
    });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/factory_step/i);
  });

  it("refuses factory_step: instrument with no unblocks line", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: instrument\n## done_when\n- run:pnpm architecture\n",
    });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/unblocks/i);
  });

  it("refuses factory_step: instrument that unblocks instrument", () => {
    const result = briefFromIssue({
      number: 1, title: "x",
      body: "## factory_step: instrument\nunblocks: instrument\n## done_when\n- run:pnpm architecture\n",
    });
    expect(result.dispatchable).toBe(false);
    if (!result.dispatchable) expect(result.reason).toMatch(/unblocks/i);
  });

  it("dispatches a valid factory_step with tree proofs", () => {
    const result = briefFromIssue({
      number: 1, title: "x", body: "## factory_step: room_generate\n## done_when\n- run:pnpm architecture\n",
    });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:pnpm architecture"]);
  });

  it("dispatches factory_step: instrument with a valid non-instrument unblocks", () => {
    const result = briefFromIssue({
      number: 1, title: "x",
      body: "## factory_step: instrument\nunblocks: room_generate\n## done_when\n- run:pnpm architecture\n",
    });
    expect(result.dispatchable).toBe(true);
    if (result.dispatchable) expect(result.proofs).toEqual(["run:pnpm architecture"]);
  });
});

/**
 * The generated package index, injected into the brief.
 *
 * MEASURED 2026-09-08 across seven Grok worker transcripts for this repo: zero LSP tool calls, and
 * every localization paid in grep and read_file. So a file a worker must DISCOVER competes with
 * grep and loses. The index goes where every worker already looks, which is this brief.
 *
 * The counterweight clause is the one that matters. The cheapest way to make an injection clause
 * pass is to emit the block unconditionally, which turns every brief in the repo into a wall of
 * package facts the slice has nothing to do with.
 */
describe("package index injection", () => {
  const REPO = "/Volumes/files/src/openclinxr";
  const issue = (body: string) => ({ number: 9001, title: "index injection probe", body });
  const staging = (extra: string) =>
    `## factory_step: staging\n${extra}\n\n## done_when\n- run:pnpm --filter @openclinxr/xr-station-room test\n`;

  it("carries the entry for a package the done_when names", () => {
    const result = briefFromIssue(issue(staging("Touch the station room package.")), REPO);
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).toContain("packages/openclinxr/xr-station-room/arch-index.json");
    expect(result.prompt).toContain("assembleStationScene");
    expect(result.prompt).toContain("pnpm --filter @openclinxr/xr-station-room typecheck");
  });

  it("COUNTERWEIGHT: a slice naming no package carries no index block", () => {
    const body =
      "## factory_step: staging\nAdjust the parallelism report's grouping.\n\n## done_when\n"
      + "- run:pnpm packages:typecheck:agent\n- changed:tools/openclinxr/architecture/parallelism-report.ts\n";
    const result = briefFromIssue(issue(body), REPO);
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).not.toContain("The packages this slice names");
  });

  it("resolves a package from a --filter specifier as well as from a directory path", () => {
    // The two are different strings for the same package, and a done_when uses both shapes.
    const viaFilter = briefFromIssue(issue(staging("No path here, only the filter below.")), REPO);
    const viaPath = briefFromIssue(
      issue(
        "## factory_step: staging\nEdit packages/openclinxr/xr-station-room/src/index.ts.\n\n"
        + "## done_when\n- run:pnpm packages:typecheck:agent\n",
      ),
      REPO,
    );
    expect(viaFilter.dispatchable && viaFilter.prompt).toContain("@openclinxr/xr-station-room —");
    expect(viaPath.dispatchable && viaPath.prompt).toContain("@openclinxr/xr-station-room —");
  });

  it("bounds a large export list rather than pasting the file", () => {
    // ui-route-admin publishes over 200 symbols; its index file is 11 KB. Pasted whole it would
    // push the ask out of the worker's first read.
    const result = briefFromIssue(
      issue(
        "## factory_step: staging\nEdit packages/openclinxr/ui-route-admin/src/index.ts.\n\n"
        + "## done_when\n- run:pnpm packages:typecheck:agent\n",
      ),
      REPO,
    );
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).toContain("more in the file)");
    const line = result.prompt.split("\n").find((l) => l.startsWith("exports ("));
    expect(line?.split(", ").length).toBe(30);
  });

  it("omits the block when no tree root is given, rather than reading the orchestrator's cwd", () => {
    const result = briefFromIssue(issue(staging("No tree root passed.")));
    expect(result.dispatchable).toBe(true);
    if (!result.dispatchable) return;
    expect(result.prompt).not.toContain("The packages this slice names");
  });
});
