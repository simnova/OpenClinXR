import { describe, expect, it } from "vitest";
import { decideRegistryShrink } from "../../agent-factory/registry-shrink-guard.ts";

/**
 * **`pnpm docs:authority` cannot succeed in main today, and the escape hatch it advertises would drop
 * two tracked files that still exist.**
 *
 * `check-openclaw-drift.ts:131` tells every worker that adds a Markdown file: *"run `pnpm
 * docs:authority` or remove the scattered artifact."* Measured on main at `70ba284e`:
 *
 *     $ pnpm docs:authority
 *     [doc-authority-registry] REFUSED: regeneration would shrink the protected registry
 *     (5 path(s) removed, 0 allowed without opt-in).
 *     ...
 *     Re-run with --allow-shrink (or OPENCLINXR_REGISTRY_ALLOW_SHRINK=1) to allow shrink cleanup.
 *     Nothing was written.
 *     ELIFECYCLE Command failed with exit code 2.
 *
 * The registry was byte-identical afterwards, so #116's guard is doing exactly its job. **The defect is
 * one level up: the five pending removals are not one kind of thing, and one flag clears all of them.**
 *
 * ## THE FIVE, CLASSIFIED BY `existsSync` — measured, do not re-derive
 *
 *   class                      | n | paths                                                   | removing the record is
 *   ---------------------------|---|---------------------------------------------------------|------------------------
 *   **gone from disk**         | 3 | `.openclinxr/evidence/body-rigging/.../body-rig-appendage-motion-cagematch.md`, two `physics-clinical-touch/.../quest-rerun.md` | bookkeeping
 *   **exists, left the scan**  | 2 | `docs/openclinxr/equipment-catalog.v1.json`, `docs/openclinxr/equipment-factory-loop-state.json` | suspicious
 *   **exists, tree incomplete**| 0 here | any registered path in a worktree missing gitignored content | **destructive — this is #95/#116** |
 *
 * Both JSONs are tracked, present, and **already registered in the generated-artifact registry** (1
 * occurrence each), which is where a non-Markdown artifact belongs. So their removal from the *Markdown
 * authority* registry is probably right — but "probably right" is a judgement, and the guard makes it
 * without looking.
 *
 * ## WHY THIS IS WORSE THAN IT LOOKS
 *
 * An operator who wants the three bookkeeping removals has exactly one move: `--allow-shrink`. That
 * same invocation authorizes the other two, and in a worktree it would authorize **every** gitignored
 * evidence path at once — the original 421 → 404 and 2356 → 199 incidents. **The flag that exists to
 * add friction to a destructive act is now the routine way to clear a bookkeeping backlog.** Ordinary
 * use trains the reflex that clears the dangerous case.
 *
 * #116 converted *"silently destroys"* into *"always fails, and the advertised remedy destroys."*
 * Strictly better. Not resolved. #95 stays open on this.
 *
 * ## THE MECHANISM, MEASURED
 *
 * `registry-shrink-guard.ts:95` — `findRemovedPaths` is a pure set difference over path strings.
 * `:112` — `decideRegistryShrink` branches on the single boolean `input.allowShrink`. **Neither
 * function ever asks whether a removed path is still on disk.** There is no `existsSync` in the module.
 *
 * ## THE DERIVED INPUT THIS CONTRACT INTRODUCES (§7r — name it, do not describe it)
 *
 * `ShrinkGuardInput` gains `pathExists?: (registeredPath: string) => boolean`, resolved against the
 * repo root, defaulting to real `existsSync` in production. The contract injects a fake so no fixture
 * files are created. **The name is mine and it is cheap; the behaviour below is the point.** If you
 * rename it, update this call site in the same commit and say so.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) present | (2) missing | (3) no opt-in | result
 *   -------------------------------------------------------|-------------|-------------|---------------|--------
 *   a) today — one boolean, existence never consulted      |  **FAIL**   |    pass     |     pass      | REFUSED
 *   b) refuse every shrink, flag or not                    |    pass     |  **FAIL**   |     pass      | REFUSED
 *   c) classify, but let `--allow-shrink` clear both classes| **FAIL**   |    pass     |     pass      | REFUSED
 *   d) classify; `--allow-shrink` clears MISSING only      |    pass     |    pass     |     pass      | ALL PASS
 *
 * **(b) is the one to watch.** "Never shrink a protected registry" is the safest-sounding sentence in
 * this whole area and it strands main permanently: the three deleted files can never leave the record,
 * so `docs:authority` exits 2 forever and the drift-check message stays a lie. Clause (2) forbids it.
 *
 * **(c) is the shape a partial fix takes** — adding the classification for the message text while
 * leaving one flag gating the write. Clause (1) asserts `allowWrite`, not the message, for that reason.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** **(2) and (3) pass today** and are
 * true nets — (2) pins the escape route open, (3) pins #116's existing refusal shut.
 * **(4) passes today**; it reads the fixture, not the guard.
 *
 * ## DECISIONS THAT ARE YOURS — name each in the commit message with what you rejected
 *  - What, if anything, authorizes removing a path that **still exists**. A second flag, an explicit
 *    per-path allowlist, or nothing at all. This contract only requires that `--allow-shrink` alone
 *    does not.
 *  - Whether the refusal message reports the two classes separately. Not asserted; strongly suggested,
 *    because an operator who cannot see the split cannot make the judgement either.
 *  - Whether the two JSONs are de-registered from the Markdown registry as part of this, or filed
 *    separately. They are already in the generated-artifact registry.
 *
 * NOT TESTED:
 *   - **That `pnpm docs:authority` exits 0 after the fix.** It should, once the three missing paths can
 *     be cleared — but that is a run of the real CLI against a real tree, not this unit.
 *   - **The generated-artifact builder.** Same guard, same defect, not asserted here; #116 established
 *     that a fix to one of the two builders is half a fix, and the guard is shared, so a fix in
 *     `registry-shrink-guard.ts` should cover both. Verify it does.
 *   - **Whether the two JSONs belong in the Markdown registry at all.** Measured that they are present
 *     in both registries; not resolved which is correct.
 *   - **Worktree detection.** `detectGitWorktree` already exists and is deliberately a note, not a gate.
 *     Untouched.
 */

/** Measured on main 2026-08-14: three registered paths whose files are gone. */
const MISSING = [
  ".openclinxr/evidence/body-rigging/appendage-motion-cagematch/2026-06-07-two-test-models/body-rig-appendage-motion-cagematch.md",
  ".openclinxr/evidence/physics-clinical-touch/2026-08-02-quest-attempt/quest-rerun.md",
  ".openclinxr/evidence/physics-clinical-touch/2026-08-02-quest-skip/quest-rerun.md",
];
/** Measured on main 2026-08-14: two registered paths that are tracked and still on disk. */
const PRESENT = ["docs/openclinxr/equipment-catalog.v1.json", "docs/openclinxr/equipment-factory-loop-state.json"];

const REGISTERED = [...MISSING, ...PRESENT, "docs/openclinxr/kept.md"];
/** A regeneration that keeps only the one survivor — i.e. all five above are removals. */
const NEXT_ALL = ["docs/openclinxr/kept.md"];
/** A regeneration that keeps the two present JSONs — only the three gone files are removals. */
const NEXT_MISSING_ONLY = ["docs/openclinxr/kept.md", ...PRESENT];

const pathExists = (p: string): boolean => PRESENT.includes(p);

type Decide = typeof decideRegistryShrink;
type Input = Parameters<Decide>[0] & { pathExists?: (p: string) => boolean };

function decide(nextPaths: readonly string[], allowShrink: boolean) {
  return decideRegistryShrink({
    registryLabel: "doc-authority-registry",
    previousPaths: REGISTERED,
    nextPaths,
    allowShrink,
    pathExists,
  } as Input);
}

describe("the shrink opt-in does not authorize removing a file that exists", () => {
  it.fails("(1) RED: --allow-shrink does not write when a removed path is still on disk", () => {
    // Refuses (a) and (c). Asserts allowWrite, not the message — a fix that only classifies for the
    // text still destroys the record.
    const d = decide(NEXT_ALL, true);
    expect(
      d.allowWrite,
      `--allow-shrink would drop ${PRESENT.length} path(s) that still exist on disk (${PRESENT.join(", ")}); bookkeeping consent must not carry the destructive case`,
    ).toBe(false);
  });

  it("(2) COUNTERWEIGHT: --allow-shrink still clears removals whose files are gone", () => {
    // Refuses (b). Without this, main is stranded: docs:authority exits 2 forever and the drift-check
    // remediation message stays a lie.
    const d = decide(NEXT_MISSING_ONLY, true);
    expect(
      d.allowWrite,
      `all ${MISSING.length} removals are files that no longer exist — this is bookkeeping and must remain clearable`,
    ).toBe(true);
    expect(d.removedPaths.sort()).toEqual([...MISSING].sort());
  });

  it("(3) COUNTERWEIGHT: with no opt-in, #116's refusal is unchanged", () => {
    // Pins the behaviour #116 shipped. A fix here must not relax the no-flag path.
    expect(decide(NEXT_MISSING_ONLY, false).allowWrite, "no opt-in, gone files").toBe(false);
    expect(decide(NEXT_ALL, false).allowWrite, "no opt-in, mixed classes").toBe(false);
  });

  it("(4) VACUITY GUARD: the fixture carries both classes, so the guard can discriminate", () => {
    expect(MISSING.length, "removals whose files are gone").toBeGreaterThan(0);
    expect(PRESENT.length, "removals whose files still exist").toBeGreaterThan(0);
    expect(PRESENT.every((p) => pathExists(p)), "the injected predicate reports PRESENT as existing").toBe(true);
    expect(MISSING.some((p) => pathExists(p)), "the injected predicate reports MISSING as absent").toBe(false);
  });
});
