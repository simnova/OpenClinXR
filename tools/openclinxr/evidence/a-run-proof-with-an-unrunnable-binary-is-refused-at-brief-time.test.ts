/**
 * #718 — briefFromIssue must refuse a `run:` rule whose binary is not allow-listed.
 *
 * THE DEFECT, MEASURED (2026-08-27) — do not re-derive this.
 *
 *   #715 was dispatched with this rule, which I wrote:
 *
 *     run:tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts
 *
 *   `parseRunArgv` (done-when-rules.ts:45) reads the FIRST TOKEN as the binary and checks it
 *   against RUN_ALLOWED_BINARIES = pnpm, node, tsx, git. Measured verbatim:
 *
 *     run: binary 'tools/openclinxr/evidence/...test.ts' is not allowlisted
 *
 *   The rule could never pass, for any implementation. `briefFromIssue` accepted the card anyway
 *   because it validates rule SHAPE, not executability, so a 60-turn worker ran against a contract
 *   whose first proof was unsatisfiable. The land needed a trusted-brief refresh to recover.
 *
 * WHY THERE IS NO FALSE-POSITIVE COST. A command `parseRunArgv` rejects cannot pass at dispatch,
 * at merge, or on main — the same parser gates all three. Refusing earlier changes WHEN the card is
 * refused, never WHETHER. The cost is that approving a new binary means editing the shared
 * allow-list first, which is the intended policy rather than a false positive.
 *
 * WHAT THIS DOES NOT BUY. Brief-time parsing proves syntactic executability only. An allow-listed
 * binary can still be absent from PATH, name a target that does not exist, or fail only inside a
 * worktree. Those remain runtime failures and this clause does not pretend otherwise.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#718)` block below.
 * Do not rewrite the paths or numbers above.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { briefFromIssue } from "../openclaw/board-brief.js";

const REPO = resolve(import.meta.dirname, "../../..");
const BOARD_BRIEF = resolve(REPO, "tools/openclinxr/openclaw/board-brief.ts");

/** The exact rule that shipped on #715, not a nearby stand-in. */
const UNRUNNABLE = "run:tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts";
/** The corrected form, which parses to a five-element argv. */
const RUNNABLE = "run:pnpm exec vitest run tools/openclinxr/evidence/the-client-entry-does-not-reach-node-builtins.test.ts";

function card(rules: string[]): { number: number; title: string; body: string } {
  return {
    number: 9718,
    title: "fixture",
    body: [
      "A fixture card.",
      "",
      "## done_when",
      "",
      ...rules.map((r) => `- ${r}`),
      "",
      "## factory_step: staging",
    ].join("\n"),
  };
}

describe("#718 a run: proof whose binary cannot run is refused before dispatch", () => {
  it.fails("(1) RED: the card that shipped on #715 is refused at brief time", () => {
    const brief = briefFromIssue(card([UNRUNNABLE]) as never, REPO) as {
      dispatchable: boolean;
      reason?: string;
    };
    expect(brief.dispatchable).toBe(false);
    // Naming the binary is what makes the refusal actionable; a bare "invalid rule" would send the
    // author looking at the path rather than at the first token.
    expect(String(brief.reason ?? "")).toMatch(/allowlist|allowlisted/i);
  });

  it("(2) the known-good column: the corrected form is accepted", () => {
    // Refuses the cheapest fix — rejecting every `run:` rule, or rejecting any rule containing a
    // path, either of which would clear clause (1) and make the whole vocabulary undispatchable.
    const brief = briefFromIssue(card([RUNNABLE]) as never, REPO) as { dispatchable: boolean };
    expect(brief.dispatchable).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the allow-list is not duplicated in board-brief", () => {
    // Two copies of a security-relevant list WILL drift. board-brief must consume the shared
    // parser, not restate its binaries.
    const src = readFileSync(BOARD_BRIEF, "utf8");
    expect(src).not.toMatch(/\[\s*"pnpm"\s*,\s*"node"\s*,\s*"tsx"\s*,\s*"git"\s*\]/);
  });

  it("(4) COUNTERWEIGHT: a real card currently on the board still parses", () => {
    // Refuses a guard so strict it retires live work. #717's own landed rule set is the fixture
    // because it is real, current, and was written after the defect was understood.
    const brief = briefFromIssue(
      card([
        "run:pnpm exec vitest run tools/openclinxr/evidence/a-landed-slice-proves-itself-on-main.test.ts",
        "changed:tools/openclinxr/openclaw/integrate.ts",
      ]) as never,
      REPO,
    ) as { dispatchable: boolean };
    expect(brief.dispatchable).toBe(true);
  });

  it("(5) COUNTERWEIGHT: non-run: rules are not put through the run: parser", () => {
    // `exists:` targets are paths by construction and would every one of them fail an argv parse.
    const brief = briefFromIssue(
      card([
        RUNNABLE,
        "exists:.openclinxr/evidence/issue-718/whatever.json",
        "changed:packages/openclinxr/asset-registry/src/index.ts",
      ]) as never,
      REPO,
    ) as { dispatchable: boolean };
    expect(brief.dispatchable).toBe(true);
  });
});
