/**
 * The unprotected-it.fails gate skips EVERY real card, because a `pnpm --filter` token is
 * package-relative and the gate resolves it from the repo root.
 *
 * MEASURED 2026-08-30 against W11 (tsk_250729c006996e58), whose contract is correctly written:
 *
 *     W11 as filed, has live:      dispatchable = true    correct
 *     W11 with live: STRIPPED      dispatchable = true    SHOULD BE FALSE
 *
 * Its run: rule is
 *
 *     run:pnpm --filter @openclinxr/ui-admin exec vitest run src/the-worldview-...test.tsx
 *
 * and `--filter` sets the cwd, so the token is relative to THAT PACKAGE:
 *
 *     gate resolves join(treeRoot, tok)  ->  <root>/src/the-worldview-...test.tsx     exists: FALSE
 *     the file actually lives at         ->  <root>/apps/ui-admin/src/...test.tsx     exists: TRUE
 *     board-brief.ts:268                     if (!existsSync(abs)) continue;
 *
 * The `continue` is deliberate and its comment is right: a token naming nothing is someone else's
 * refusal, not this gate's business. The defect is that a token naming something REAL looks
 * identical to a token naming nothing, because it was resolved from the wrong base.
 *
 * WHY THE EXTENSION FIX DID NOT HELP. tsk_f16e8559e4423bae correctly widened `/\.test\.ts$/` to
 * `/\.test\.(?:ts|tsx|mts)$/` (cb32c209), so `.tsx` tokens now pass the extension check — and then
 * fail the existence check one line later. Both gaps had to close for one real card to be
 * protected; only one has. A half-closed gate is worse than an open one, because the board now
 * reads as though this was fixed.
 *
 * WHOSE FAULT THE GAP IS. Mine. I wrote the previous RED, and its fixtures used repo-root-relative
 * tokens (`apps/ui-admin/src/probe-plant.test.tsx`) because that was easier to write than the
 * `--filter` form every real card uses. A contract whose fixture is more convenient than the real
 * input passes while the defect survives. That is the rule this file exists to stop repeating:
 * THE FIXTURE MUST HAVE THE SHAPE THE REAL CARDS HAVE.
 *
 * Resolution must derive from the `--filter <pkg>` argument, never from a tree search for a
 * matching basename — a search finds the wrong file the moment two packages have a same-named
 * test, and it turns a precise gate into a heuristic.
 *
 * ONE VARIABLE ONLY. Every fixture below uses a `.test.ts` plant, deliberately. The EXTENSION gap
 * (.tsx/.mts) is a separate defect owned by tsk_f16e8559e4423bae, whose fix is on wt/unprotected-
 * itfails-tsx and NOT yet on main. A `.tsx` fixture here would fail for the extension reason before
 * it ever reached the resolution reason, so the RED would go green the moment that branch merged
 * while this defect survived untouched. Measured: written with .tsx fixtures first, and counterweight
 * (4) failed for exactly that reason. The variable under test is the RESOLUTION BASE, nothing else.
 *
 * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append `## FIXED` below.
 *
 * claimScope: brief-time dispatchability only. notEvidenceFor: how run:/live: EVALUATE at
 * contract-verify time, which this card does not touch.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefFromIssue } from "./board-brief.js";

const PKG = "@openclinxr/ui-admin";
const PKG_DIR = "apps/ui-admin";
const PLANT_IN_PKG = "src/probe-plant.test.ts";

const RED_PLANT = `import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`;

function card(doneWhen: string) {
  return { number: 9002, title: "filter probe card", body: `## factory_step:\nstaging\n\n## done_when\n${doneWhen}\n` };
}

/** A tree shaped like this repo: a workspace manifest, a named package, and a plant inside it. */
function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "brief-filter-"));
  mkdirSync(join(dir, PKG_DIR, "src"), { recursive: true });
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n", "utf8");
  writeFileSync(join(dir, PKG_DIR, "package.json"), JSON.stringify({ name: PKG }), "utf8");
  writeFileSync(join(dir, PKG_DIR, PLANT_IN_PKG), RED_PLANT, "utf8");
  return dir;
}

describe("the filter relative plant token resolves", () => {
  let root = "";
  const filterRun = `run:pnpm --filter ${PKG} exec vitest run ${PLANT_IN_PKG}`;

  // (1) THE HOLE. W11's exact command shape. Unprotected, and the gate must say so.
  it.fails("(1) RED: refuses a --filter run: whose package-relative plant is it.fails with no live:", () => {
    root = makeWorkspace();
    const res = briefFromIssue(card(`- ${filterRun}`), root);
    expect(
      res.dispatchable,
      "the token is package-relative under --filter, so join(treeRoot, tok) misses it and the gate skips",
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  // (2) COUNTERWEIGHT, must pass BEFORE and AFTER: a correctly-protected card stays dispatchable.
  //     Without this, "refuse every --filter card" satisfies (1) and stops the whole board.
  it("(2) COUNTERWEIGHT: accepts the same --filter card when a live: rule covers the plant", () => {
    root = makeWorkspace();
    const res = briefFromIssue(card(`- ${filterRun}\n- live:${join(PKG_DIR, PLANT_IN_PKG)}`), root);
    expect(res.dispatchable, "a card that already carries the remedy must remain dispatchable").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // (3) COUNTERWEIGHT, must pass BEFORE and AFTER: a token that resolves NOWHERE still skips.
  //     This gate must never guess a path. Guessing is how it starts refusing cards for the wrong
  //     reason, and it is why resolution has to come from --filter rather than from a tree search.
  it("(3) COUNTERWEIGHT: stays silent when the token resolves nowhere, even under --filter", () => {
    root = makeWorkspace();
    const res = briefFromIssue(card(`- run:pnpm --filter ${PKG} exec vitest run src/does-not-exist.test.ts`), root);
    expect(res.dispatchable, "a token naming nothing is someone else's refusal").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // (4) COUNTERWEIGHT, must pass BEFORE and AFTER: root-relative behaviour is UNCHANGED, so the
  //     fix is additive. This one already passes today; it fails if the fix replaces the old base
  //     instead of adding to it.
  it("(4) COUNTERWEIGHT: a root-relative token is still refused exactly as it is today", () => {
    root = makeWorkspace();
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${join(PKG_DIR, PLANT_IN_PKG)}`), root);
    expect(res.dispatchable, "root-relative resolution must keep working").toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

// NOT TESTED: how run:/live: evaluate at contract-verify time; --filter with a glob or a path
// filter rather than a package name; workspaces whose package name does not match its directory.
