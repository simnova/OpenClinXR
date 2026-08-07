import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#84) — a missing CLI argument is indistinguishable from a forged proof.
 *
 * BOTH `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#84)` block below, and leave the measured transcript intact.
 *
 * WHAT HAPPENED, verbatim, while landing #81:
 *
 *     $ tsx tools/openclinxr/openclaw/integrate.ts --slice issue-81
 *     REFUSED — merge-kill fired:
 *       - empty-diff-with-passing-proofs: Empty diff claims passing proofs
 *
 * The branch carried 15 files and +744/-109. The kill's reason string reads "Incident class:
 * forged or no-op proof — contract reports green while the branch changes nothing." It accused the
 * worker of forgery because the ORCHESTRATOR omitted a flag.
 *
 * MECHANISM, measured. `integrate.ts:245-246`:
 *
 *     base: flag("base") ?? "HEAD",
 *     head: flag("head") ?? "",
 *
 * `runMergeKill` runs `git diff --name-status ${base}...${head}` (`merge-kill.ts:625`). With head
 * empty that is `HEAD...`, which git resolves as `HEAD...HEAD` — a LEGAL command returning zero
 * entries and exit 0. `changedFiles === 0` with `proofsOk === true` is exactly the forged-proof
 * kill condition (`merge-kill.ts:428-429`). Git never errors, so nothing upstream notices.
 *
 * `--base` has a considered default. `--head` has an empty string, which is not a default — it is
 * a value that happens to parse.
 *
 * WHY THIS IS WORTH A SLOT RATHER THAN A ONE-LINE FIX IN PASSING. The forged-proof kill is one of
 * the few checks standing between a fabricated contract and main. A gate that fires on operator
 * typos is a gate people route around, and the available route is `--force`. This repo's loop rules
 * already name the class: what breaks first under a hard substrate ban is unguarded delegation.
 *
 * THE TWO CONTRACTS PULL APART, deliberately. The first demands the missing argument be REFUSED
 * before any kill logic runs — satisfiable by deleting the empty-diff check entirely, which would
 * remove the forgery defence. So the second requires that check to still fire when head genuinely
 * resolves to base. A guard that swallows the real case is worse than the bug.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These call the CLI's argument resolution and `integrate()`.
 * Change the call sites and say why if a different shape is better. What must not change: an
 * unusable `--head` is named as such, and a genuinely empty diff with passing proofs is still a
 * kill.
 *
 * NOT DETERMINED: whether any past integration was affected. Every prior land passed `--head`
 * explicitly, so there is no evidence of a bad merge — but `integration-events.jsonl` has not been
 * audited and this contract does not audit it.
 *
 * SCOPE: argument handling on the integrate entry point. Says nothing about whether the kill rules
 * are correctly calibrated.
 */

const load = async () =>
  import("./integrate.js") as Promise<Record<string, unknown>>;

type Integrate = (input: {
  repoRoot: string;
  slice: string;
  base: string;
  head: string;
  dryRun?: boolean;
  contract?: { proofsOk: boolean; proofs: { rule: string; passed: boolean; detail: string }[] };
}) => { killReport: { killed: boolean; findings: { id: string }[] }; landed: boolean; exitCode: number };

const REPO = "/Volumes/files/src/openclinxr";
const GREEN = {
  proofsOk: true,
  proofs: [{ rule: "run: pnpm vitest run x.test.ts", passed: true, detail: "" }],
};

describe("a missing --head is refused, not mistaken for forgery (#84)", () => {
  it.fails("an empty head is refused by name and never reaches the forged-proof kill", async () => {
    // The whole defect in one assertion: the operator's mistake must be reported as the operator's
    // mistake. Reaching merge-kill at all is the bug, because merge-kill's only available verdict
    // for this input is an accusation against the worker.
    const mod = await load();
    const integrate = mod["integrate"] as Integrate | undefined;
    expect(integrate).toBeTypeOf("function");

    let message = "";
    try {
      integrate!({ repoRoot: REPO, slice: "issue-84", base: "main", head: "", dryRun: true, contract: GREEN });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message, "an empty head was accepted silently").not.toHaveLength(0);
    expect(message.toLowerCase(), `refusal does not name the argument: ${message}`).toContain("head");
    expect(
      message.toLowerCase(),
      `refusal blames the worker for an operator error: ${message}`,
    ).not.toContain("forged");
  });

  it("a head that genuinely resolves to base still trips the forged-proof kill", async () => {
    // NOT A RED — this passes today, deliberately. It is the counterweight: the first contract is
    // satisfiable by deleting the empty-diff check, and this one locks that escape. A real no-op
    // branch presenting passing proofs must still be killed, because that is the incident the check
    // exists for. Verified failing-if-removed by construction, not by planting.
    const mod = await load();
    const integrate = mod["integrate"] as Integrate | undefined;
    expect(integrate).toBeTypeOf("function");

    const result = integrate!({
      repoRoot: REPO,
      slice: "issue-84",
      base: "main",
      head: "main",
      dryRun: true,
      contract: GREEN,
    });

    expect(result.killReport.killed, "main...main with passing proofs was not killed").toBe(true);
    expect(result.killReport.findings.map((f) => f.id)).toContain("empty-diff-with-passing-proofs");
  });
});
