import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  unresolvedEntrypointImports,
} from "../checks/entrypoint-imports-resolve.js";

/**
 * A test may not import a symbol from a workspace package entrypoint that the entrypoint does not
 * export.
 *
 * WHY THIS IS A RATCHET AND NOT A ZERO. Measured 2026-09-09 on main: two such imports exist, and
 * BOTH are inside planted REDs whose cards exist to fix exactly this. Asserting zero today would
 * fail main for defects that are deliberately recorded and owned. The number may only go DOWN.
 *
 * The two, and who fixes them:
 * - `getScheduledEventsDue` from `@openclinxr/domain`, imported by the scheduled-event RED. It is
 *   defined at `packages/openclinxr/domain/src/station-state.ts:104-111` and absent from that
 *   package's `index.ts:15-19`. Clause 5 of that RED asserts the export, and
 *   `domain/src/index.ts` is in the card's write roots.
 * - `ensureActorPlacementsForStagedSlots` from `@openclinxr/xr-runtime-state`, imported by the
 *   framing-guard RED. Found by THIS CHECK rather than by a suite, because the clause that uses it
 *   is `it.fails` and was passing for the wrong reason.
 *
 * WHAT IT COST BEFORE THE CHECK EXISTED. BothyBoard card `tsk_298d0ead7dc551e4` reached
 * `status=review` on 2026-09-04 with three tests failing on
 * `TypeError: advanceExamFormRunBreak is not a function` — defined at
 * `packages/openclinxr/exam-assembly/src/exam-run.ts:179`, missing from that package's index. It
 * then held one of the project's two in-flight slots for five days, and `tasks.next` returned
 * `{task:null}` for all 25 ready cards while it sat there.
 *
 * Through a barrel re-export a missing name does not throw at load; it yields `undefined`. So the
 * failure surfaces as a call on undefined deep inside a test, and typecheck misses it whenever the
 * test casts the module to a loose record — which planted REDs do on purpose.
 *
 * PROBED 2026-09-09. Planted `import { zzProbeSymbolThatIsNotExported } from "./index.js"` into
 * `packages/openclinxr/xr-pose/src/actor-floor-composition.test.ts`: the ratchet failed and named
 * the file, the symbol and `@openclinxr/xr-pose`. Reverted: green again.
 *
 * CLAIM: catches a STATIC NAMED import, from a workspace package entrypoint, of a value symbol
 * that entrypoint does not export, in any `*.test.ts|tsx|mts` under `packages/openclinxr`,
 * `packages/openclinxr-verification` and `packages/cellix`.
 *
 * NOT TESTED: dynamic `await import(...)`; `import type` names, which a separate `export type`
 * block can publish and this check does not model; default and namespace imports; re-exports
 * through a barrel other than `src/index.ts`; non-test source files; and `apps/` and `tools/`,
 * which are not scanned.
 */

/** Measured on main 2026-09-09. SHRINK ONLY. Raising this number is the thing it forbids. */
const CEILING = 2;

describe("a test cannot import a symbol its package entrypoint does not export", () => {
  it("does not grow the number of unresolved entrypoint imports", () => {
    const rows = unresolvedEntrypointImports(REPO_ROOT);
    const detail = rows.map((r) => `${r.file} -> ${r.symbol} from ${r.packageName}`).join("\n  ");
    expect(
      rows.length,
      `Unresolved entrypoint imports rose above the ${CEILING} recorded on 2026-09-09.\n` +
        `A symbol missing from a package index resolves to undefined through the barrel, so this\n` +
        `fails at runtime as "<name> is not a function" and typecheck does not catch it.\n` +
        `Add the symbol to that package's src/index.ts export block.\n  ${detail}`,
    ).toBeLessThanOrEqual(CEILING);
  });

  it("reports the file, the symbol and the package it was expected from", () => {
    for (const row of unresolvedEntrypointImports(REPO_ROOT)) {
      expect(row.file).toMatch(/\.test\.(?:ts|tsx|mts)$/u);
      expect(row.symbol).not.toBe("");
      expect(row.packageName).not.toBe("");
    }
  });
});
