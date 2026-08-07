import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#116) — regenerating either protected registry in an incomplete tree silently
 * destroys it. Exit code 0, no warning.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — a legitimate regeneration that ADDS paths must still
 * succeed. It is `it.fails` only because the module is absent. It exists because the cheapest way to
 * satisfy a refusal contract is to refuse everything.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * REPRODUCED BY EXPERIMENT, not from a report
 *
 * In a git worktree of this repo I ran `pnpm docs:artifacts`. The PROTECTED file
 * `docs/openclinxr/generated-artifact-registry-2026-05-27.md` went from **2356 entries to 199**.
 * Exit code 0. No warning. I restored it from git.
 *
 * This has now fired twice in production:
 *   - #95: a worker ran the sibling command and the doc-authority registry went 421 → 404, and that
 *     LANDED. Every downstream gate stayed green, because a smaller registry is still a well-formed
 *     one.
 *   - #114: a worker ran `pnpm docs:artifacts` in its worktree, saw the damage, restored from git,
 *     and hand-added the six entries it actually needed. It caught itself. The next one might not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MECHANISM, MEASURED — verified against the tree, do not re-derive
 *
 * `tools/agent-factory/build-generated-artifact-registry.ts:26-32` scans a fixed root list —
 * `.agent-factory`, `.openclinxr`, `docs/openclinxr`, `apps/ui-xr/public/xr-assets`,
 * `apps/ui-xr/dist/xr-assets` — then at `:186-192` calls `writeFileSync` on both outputs with **no
 * comparison against what was previously registered**.
 *
 * `tools/agent-factory/build-doc-authority-registry.ts:448-455` does the same for the Markdown
 * authority registry.
 *
 * A worktree legitimately lacks gitignored content — `.openclinxr/evidence` is 45 entries in main and
 * 1 in a worktree. So the scan finds less, and the builder writes less, and the record of everything
 * else is gone.
 *
 * **A PEER ROUND CORRECTED ME TWICE.** I blamed `apps/ui-xr/public/cagematch`; it is not in the scan
 * roots at all — `.openclinxr` is what drives the volume. And I treated this as one command's bug:
 * #95 was `docs:authority` and my reproduction was `docs:artifacts`. **Same mechanism, two protected
 * pairs. Guard both.** A fix to one is half a fix.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NO THRESHOLD, DELIBERATELY
 *
 * The peer proposed refusing above some removal count or percentage. I have not used one. Any number
 * I pick becomes a design target (§7a), and the honest invariant needs no number: **a registry is a
 * record, so regeneration may add and update, and any removal must be asked for.** Zero-tolerance
 * plus an explicit opt-in is simpler to state, simpler to test, and has nothing to tune.
 *
 * The cost is real and accepted: deleting one genuinely stale artifact now requires the flag. That is
 * the correct amount of friction for editing a protected record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - The opt-in's shape — a CLI flag, an environment variable, or both — and its exact name. It must
 *    appear in the refusal message so the operator learns it at the moment they need it.
 *  - Whether the refusal prints every removed path or a count plus a sample. Thousands of paths in a
 *    terminal is its own failure.
 *  - Whether a worktree is additionally DETECTED and logged. The peer suggested a warning, never a
 *    gate — a complete worktree is legitimate and must not be refused for being a worktree.
 *  - Whether the two builders share one guard helper or each carries its own. They are separate files
 *    with separate output pairs.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a refusal, and is satisfiable by a warning that still writes — so it asserts the output
 * files are BYTE-IDENTICAL after the refused run, not merely that something was printed. (2) demands
 * the same for the second builder, which a fix to one file alone cannot give. (3) is green today and
 * forbids the cheapest refusal of all: refusing everything, including honest growth.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `runRegistryBuilderForTest()`. What must not
 * change: the builders are invoked the way the `pnpm` scripts invoke them, against a temporary tree —
 * never against the real repository registries, which this test must not be able to damage.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, SAY SO IN YOUR REPORT. Do not silently run a
 * corrected version.
 *
 * SCOPE: whether regenerating a protected registry can silently shrink it. Says NOTHING about whether
 * the classifications are right, nor about any other guard that prescribes a destructive command.
 */

const load = async () => import("./registry-shrink-refusal.js") as Promise<Record<string, unknown>>;

type BuilderRun = {
  /** Exit-equivalent: 0 on write, non-zero on refusal. */
  exitCode: number;
  /** True when the builder wrote either output file. */
  wrote: boolean;
  /** Content hash of each output before and after the run. */
  outputsUnchanged: boolean;
  /** Paths the regeneration would have dropped. */
  removedPaths: string[];
  /** Whatever the builder printed — the refusal must name the opt-in. */
  stderr: string;
};
type Run = (input: {
  builder: "generated-artifact" | "doc-authority";
  /** Seed registry paths that exist in the fixture registry. */
  existingRegisteredPaths: string[];
  /** Paths actually present in the temporary tree the builder will scan. */
  presentPaths: string[];
  allowShrink?: boolean;
}) => Promise<BuilderRun>;

const BUILDERS = ["generated-artifact", "doc-authority"] as const;

describe("regenerating a protected registry cannot silently shrink it (#116)", () => {
  it.fails("an incomplete tree is refused, and nothing is written", async () => {
    // The reproduction: 2356 entries to 199, exit 0. A warning that still writes does not fix this,
    // which is why the assertion is on the output bytes rather than on the message.
    const mod = await load();
    const run = mod["runRegistryBuilderForTest"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    for (const builder of BUILDERS) {
      const result = await run!({
        builder,
        existingRegisteredPaths: ["a/one.json", "a/two.json", "b/three.json", "b/four.json"],
        presentPaths: ["a/one.json"],
      });
      expect(result.exitCode, `${builder} exited zero on a shrinking regeneration`).not.toBe(0);
      expect(result.wrote, `${builder} wrote output while refusing`).toBe(false);
      expect(result.outputsUnchanged, `${builder} changed its outputs while refusing`).toBe(true);
      expect(result.removedPaths.length, `${builder} did not report what it would have dropped`).toBeGreaterThan(0);
      expect(result.stderr, `${builder}'s refusal does not name the opt-in`).toMatch(/shrink/i);
    }
  }, 600_000);

  it.fails("the opt-in allows a genuine cleanup and reports what went", async () => {
    // Removing stale entries is a real workflow. Refusing it outright would push people back to
    // hand-editing a protected file, which is how it drifts.
    const mod = await load();
    const run = mod["runRegistryBuilderForTest"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    for (const builder of BUILDERS) {
      const result = await run!({
        builder,
        existingRegisteredPaths: ["a/one.json", "a/two.json", "b/three.json"],
        presentPaths: ["a/one.json"],
        allowShrink: true,
      });
      expect(result.exitCode, `${builder} refused despite the opt-in`).toBe(0);
      expect(result.wrote, `${builder} did not write despite the opt-in`).toBe(true);
      expect(
        result.removedPaths.sort(),
        `${builder} did not report the removed paths`,
      ).toEqual(["a/two.json", "b/three.json"]);
    }
  }, 600_000);

  it.fails("growth still succeeds without the opt-in (COUNTERWEIGHT)", async () => {
    // The cheapest way to pass a refusal contract is to refuse everything. Adding a newly generated
    // artifact is the normal case and must stay a plain, flagless success — #114 needed exactly this.
    const mod = await load();
    const run = mod["runRegistryBuilderForTest"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    for (const builder of BUILDERS) {
      const result = await run!({
        builder,
        existingRegisteredPaths: ["a/one.json"],
        presentPaths: ["a/one.json", "a/two.json", "b/three.json"],
      });
      expect(result.exitCode, `${builder} refused an honest addition`).toBe(0);
      expect(result.wrote, `${builder} did not write an honest addition`).toBe(true);
      expect(result.removedPaths, `${builder} reported removals on a pure addition`).toHaveLength(0);
    }
  }, 600_000);
});
