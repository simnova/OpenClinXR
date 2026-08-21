/**
 * #511 — every brief I write restates the planted-contract convention in prose, and prose loses.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#511)` block below; do not rewrite these numbers.
 *
 * WHAT IS BAKED TODAY — four directives, none covering planted contracts:
 *   WORKER_TONE_DIRECTIVE · WORKER_OUTPUT_BUDGET_DIRECTIVE
 *   WORKER_SHARED_TREE_DIRECTIVE · WORKER_STATUS_REPORTING_DIRECTIVE
 *   git grep "it.fails|## FIXED" -- packages/openclinxr/agent-loop tools/openclinxr/openclaw
 *     -> only test files. No worker is ever TOLD the convention.
 *
 * WHAT IT COST, measured on #510: clause (1) was planted `it.fails`; the worker's reject_measured
 * report SATISFIED it, so vitest exited non-zero on a substantively green contract and `dispatch()`
 * threw ContractProofsFailedError. The worker left it unflipped, which was a fair reading —
 * flipping looks like claiming the licence cleared. One resume, and the same cost waits on every
 * future measure-only slice. #501 proved the identical shape: amending prose is necessary and not
 * sufficient; what binds is what the worker is actually handed.
 *
 * THE BUDGET IS THE HARD PART — measured spawn-prompt lengths against the 4500 cap enforced by
 * role-harness-policy.test.ts:477:
 *
 *   chief-coordinator              3108   headroom 1392
 *   asset-pipeline-lead            4251   headroom  249   <- tightest
 *   xr-systems-architect           4250   headroom  250
 *   hrbp                           4054   headroom  446
 *   openclaw-drift-police          2683   headroom 1817
 *   license-provenance-specialist  2646   headroom 1854
 *
 * WHERE THE ROOM IS — composition measured for asset-pipeline-lead (4251 chars, 33 lines):
 *
 *   line  0   2834 chars   WORKER_TONE_DIRECTIVE            <- 67% OF THE WHOLE PROMPT
 *   line 32    547 chars   preferredCli / test-filter guidance
 *   line 27    138 chars   readRoots / writeRoots rules
 *   (30 other lines)        ~732 chars total
 *
 * The tone directive is two thirds of the budget on a single line. That is where slack lives, and
 * it is why this is a slice rather than a trap. Clause (3) floors each existing directive at 80
 * chars: compressing 2834 -> something smaller is permitted, gutting is not. #501 measured that
 * tone must stay BAKED (personas do not bind headless), so compress it, do not delete it — and if
 * compression would cost tone quality, say so and report UNABLE with the measurement.
 *
 * A candidate wording I drafted is 242 chars — it fits by SEVEN. I am not prescribing it: a
 * seven-character margin is fragile and the next directive edit breaks it. Compress the wording,
 * reclaim space elsewhere, or report UNABLE with the measurement. Finding the room is the slice.
 *
 * claimScope: whether a dispatched worker is told the planted-contract convention, within budget.
 * notEvidenceFor: that any worker then follows it (#501 measured that prose alone does not bind).
 */
import { describe, expect, it } from "vitest";

const ROLES = [
  "chief-coordinator", "asset-pipeline-lead", "xr-systems-architect",
  "hrbp", "openclaw-drift-police", "license-provenance-specialist",
] as const;

async function prompts(): Promise<Record<string, string>> {
  const s = await import("../../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts");
  const p = await import("../../../packages/openclinxr/agent-loop/src/role-harness-policy.ts");
  const out: Record<string, string> = {};
  for (const role of ROLES) {
    const policy = (p as { getRepoRoleHarnessPolicy: (r: string) => unknown }).getRepoRoleHarnessPolicy(role);
    if (!policy) continue;
    out[role] = (s as { buildRepoAgentSpawnPrompt: (a: unknown) => string })
      .buildRepoAgentSpawnPrompt({ role, task: "T", roleDir: `agents/${role}`, policy });
  }
  return out;
}

describe("#511 the spawn prompt states the planted-contract convention", () => {
  it("the population is real — every typical role resolves a policy and builds a prompt", async () => {
    const p = await prompts();
    expect(Object.keys(p).length, "all six roles must build").toBe(ROLES.length);
    for (const [r, text] of Object.entries(p)) expect(text.length, `${r} empty`).toBeGreaterThan(1000);
  });

  it.fails("(1) every dispatched worker is told the three planted-contract rules", async () => {
    for (const [role, text] of Object.entries(await prompts())) {
      expect(text, `${role}: header immutability`).toMatch(/IMMUTABLE/i);
      expect(text, `${role}: when to flip`).toMatch(/it\.fails/);
      // The #510 case: a rejection verdict still flips, because the clause asserts the REPORT is
      // complete, not that the outcome was favourable.
      expect(text, `${role}: flipping applies on a rejection too`).toMatch(/reject|rejection/i);
      expect(text, `${role}: never delete a superseded contract`).toMatch(/inverted guard/i);
    }
  });

  it("(2) COUNTERWEIGHT: no role's prompt exceeds the 4500 budget", async () => {
    for (const [role, text] of Object.entries(await prompts()))
      expect(text.length, `${role} prompt ${text.length} exceeds the cap`).toBeLessThan(4500);
  });

  it("(3) COUNTERWEIGHT: the four existing directives are not cannibalised to make room", async () => {
    const d = await import("../../../packages/openclinxr/agent-loop/src/worker-directives.ts") as Record<string, string>;
    for (const key of ["WORKER_TONE_DIRECTIVE", "WORKER_OUTPUT_BUDGET_DIRECTIVE",
      "WORKER_SHARED_TREE_DIRECTIVE", "WORKER_STATUS_REPORTING_DIRECTIVE"]) {
      expect(typeof d[key], `${key} must still exist`).toBe("string");
      expect(d[key]!.length, `${key} must not be gutted`).toBeGreaterThan(80);
    }
  });
});
