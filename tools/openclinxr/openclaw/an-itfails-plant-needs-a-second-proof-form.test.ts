/**
 * A planted RED written as `it.fails` makes its own `run:` proof VACUOUS.
 *
 * MEASURED 2026-08-26, three states of one plant, exit code of `pnpm exec vitest run <plant>`:
 *
 *   | tree state                                    | exit |
 *   |-----------------------------------------------|------|
 *   | worker does NOTHING (it.fails + throwing body) |  0   |  <- the hole
 *   | fixed + flipped to it()  (the convention)      |  0   |
 *   | fixed, flip forgotten    (it.fails + passing)  |  1   |
 *
 * So a bare `run:` on an `it.fails` plant is satisfied by an untouched tree, satisfied by correct
 * work, and refused only by a bookkeeping slip. It cannot distinguish done from not-started.
 *
 * This is NOT a new diagnosis. `done-when-rules.ts:386-397` records it against #569/#570 and landed
 * the remedy: `live:<file>` asserts zero remaining `it.fails` in the named plant. The remedy works.
 * It is simply not applied — measured across all 90 open cards on 2026-08-26:
 *
 *   cards with a run: rule .................... 14
 *   it.fails plant + live:/measured-before: ....  5   protected
 *   it.fails plant + NEITHER ...................  5   VACUOUS  (#643 #642 #627 #190 #95)
 *   plain it() plant ...........................  3   real gate
 *   run: target unresolvable ...................  1
 *
 * Confirmed on a live card: #642's `run:` proof exits 0 on the current tree, defect unfixed, worker
 * still in its measurement phase. The contract is satisfied before the work starts.
 *
 * `briefFromIssue` could never catch this because it takes only the issue — no tree root — so it
 * cannot read the named plant. This gives it an OPTIONAL tree root and refuses the unprotected
 * shape when one is supplied. Omitting it preserves every existing caller's behaviour exactly.
 *
 * claimScope: the brief-time gate only. It does not change how `run:` or `live:` EVALUATE.
 * notEvidenceFor: that the five cards above are wrong in substance — their contracts are
 * under-specified, which is a different claim from their product work being wrong.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefFromIssue } from "./board-brief.js";

function card(doneWhen: string) {
  return {
    number: 9001,
    title: "probe card",
    body: `## factory_step:\nbody_param\n\n## done_when\n${doneWhen}\n`,
  };
}

describe("an it.fails plant needs a second proof form", () => {
  let root: string;

  const plantRel = "tools/openclinxr/evidence/probe-plant.test.ts";

  function makeTree(plantSource: string): string {
    const dir = mkdtempSync(join(tmpdir(), "brief-gate-"));
    mkdirSync(join(dir, "tools/openclinxr/evidence"), { recursive: true });
    writeFileSync(join(dir, plantRel), plantSource, "utf8");
    return dir;
  }

  // (1) THE HOLE: a run: naming an it.fails plant, with no second proof form, is refused.
  it("refuses a run: whose plant is it.fails and which carries no live:", () => {
    root = makeTree(`import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`);
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${plantRel}`), root);
    expect(res.dispatchable).toBe(false);
    expect(res.reason ?? "").toMatch(/it\.fails/);
    rmSync(root, { recursive: true, force: true });
  });

  // (2) COUNTERWEIGHT: the same plant WITH a live: rule is accepted. Without this the gate could
  //     pass by refusing every it.fails card, which would make the remedy unreachable.
  it("accepts the same plant when a live: rule covers it", () => {
    root = makeTree(`import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`);
    const res = briefFromIssue(
      card(`- run:pnpm exec vitest run ${plantRel}\n- live:${plantRel}`),
      root,
    );
    expect(res.dispatchable).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // (3) COUNTERWEIGHT: a plain it() plant needs no second form — its run: is already a real gate.
  //     Without this the gate could pass by demanding live: on every card, punishing the good shape.
  it("accepts a plain it() plant with no live: rule", () => {
    root = makeTree(`import { it, expect } from "vitest";\nit("green", () => expect(1).toBe(1));\n`);
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${plantRel}`), root);
    expect(res.dispatchable).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // (4) VACUITY GUARD: with NO tree root the gate must not fire, or every existing caller starts
  //     refusing. Uses a plant that REALLY EXISTS in this repo and really contains it.fails, so the
  //     two branches genuinely differ.
  //
  //     The first version of this clause used a RELATIVE temp-dir path and was VACUOUS: that path
  //     does not exist relative to cwd, so existsSync short-circuited and the clause passed even
  //     with the treeRoot guard deleted. Caught by the destructive probe, not by reading it.
  //
  //     The second version fixed the vacuity by naming a REAL repo plant, which was correct and
  //     then AGED OUT: 32a8e5e3 legitimately flipped that plant, leaving only the words `it.fails`
  //     inside a comment. The guard's regex requires `it.fails(` and correctly ignores prose, so the
  //     card became genuinely dispatchable and this clause failed while nothing was broken. A
  //     fixture that depends on another slice never flipping its RED is a fixture with an expiry
  //     date, and it cost a red main plus a wrong "the gate is failing open" diagnosis.
  //
  //     THIRD VERSION, and it needs neither. The guard resolves a token as
  //     `isAbsolute(tok) ? tok : join(treeRoot, tok)` (board-brief.ts:266), so an ABSOLUTE temp-dir
  //     token stays resolvable with NO treeRoot. That is what preserves non-vacuity: delete the
  //     `if (!treeRoot) return []` guard and the no-root arm still finds the plant, still sees a
  //     live `it.fails(`, and still refuses — so the clause reds. Verified by destructive probe.
  //     It depends on nothing outside its own tmpdir.

  it("does not fire when no tree root is supplied", () => {
    root = makeTree(`import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`);
    const absolutePlant = join(root, plantRel);

    const withRoot = briefFromIssue(card(`- run:pnpm exec vitest run ${absolutePlant}`), root);
    expect(withRoot.dispatchable).toBe(false); // tree root supplied -> plant found -> refused

    const noRoot = briefFromIssue(card(`- run:pnpm exec vitest run ${absolutePlant}`));
    expect(
      noRoot.dispatchable,
      "the guard must return early when no treeRoot is supplied, even though this ABSOLUTE token would otherwise resolve",
    ).toBe(true);
  });

  // (6) CORRECTED 2026-08-26 after a consult: `measured-before:` must NOT count as protection.
  //     It asserts ORDERING ONLY — an artifact written before a product edit, by mtime
  //     (done-when-rules.ts:310-319) — and says nothing about whether a plant was flipped. It was
  //     in the covered set and was dead code besides: its payload is `<artifact>:<product>`, which
  //     can never equal a `.test.ts` token. The dead comparison hid the wrong claim.
  it("does not treat measured-before: as protection for an it.fails plant", () => {
    root = makeTree(`import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`);
    const res = briefFromIssue(
      card(`- run:pnpm exec vitest run ${plantRel}\n- measured-before:.openclinxr/evidence/pre-fix.json:${plantRel}`),
      root,
    );
    expect(res.dispatchable, "measured-before: proves ordering, never that a plant was flipped")
      .toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  // (5) The gate must read the FILE, not the rule text. A card naming a plant that does not exist
  //     on disk is someone else's refusal (or a glob) — this gate stays silent rather than guessing.
  it("stays silent when the named plant is not on disk", () => {
    root = makeTree(`import { it } from "vitest";\nit("x", () => {});\n`);
    const res = briefFromIssue(
      card(`- run:pnpm exec vitest run tools/openclinxr/evidence/does-not-exist.test.ts`),
      root,
    );
    expect(res.dispatchable).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
  /**
   * ## THE EXTENSION GAP (tsk_f16e8559e4423bae) — planted 2026-08-30
   *
   * Everything above is CORRECT and has never once applied to the lane that needs it most.
   *
   *     board-brief.ts:263    if (!/\.test\.ts$/u.test(tok)) continue;
   *
   * MEASURED, three tokens against that regex:
   *
   *     "a.test.ts"    true
   *     "a.test.tsx"   FALSE
   *     "b.test.mts"   FALSE
   *
   * MEASURED on the tree at b023e76c:
   *
   *     apps/ui-admin/src/the-worldview-*.test.tsx    16
   *     apps/ui-admin/src/the-worldview-*.test.ts      0
   *
   * So the gate returns before it reaches the `live:` coverage check, and all sixteen worldview
   * cards are dispatchable whether or not a `live:` rule protects them. A React app's tests are
   * `.tsx`; this filter was written against a `.ts` package and the assumption travelled silently.
   *
   * HOW IT SURFACED: W11 tsk_250729c006996e58 sat in review, objective unstarted, clause (1) still
   * `it.fails`. Its contract DOES carry the right `live:` rule. I first diagnosed this as the
   * contract being unable to distinguish done from not-started — WRONG, and corrected on that card.
   * The contract can. The filter skipped it.
   *
   * Diagnosis header IMMUTABLE. Flip `it.fails` to `it` and append `## FIXED` below.
   */

  const tsxPlantRel = "apps/ui-admin/src/probe-plant.test.tsx";
  const mtsPlantRel = "tools/openclinxr/evidence/probe-plant.test.mts";

  function makeTreeAt(rel: string, plantSource: string): string {
    const dir = mkdtempSync(join(tmpdir(), "brief-ext-"));
    mkdirSync(join(dir, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(dir, rel), plantSource, "utf8");
    return dir;
  }

  const RED_PLANT = `import { it, expect } from "vitest";\nit.fails("red", () => expect(1).toBe(2));\n`;
  const LIVE_PLANT = `import { it, expect } from "vitest";\nit("green", () => expect(1).toBe(1));\n`;

  // (7) RED: a .tsx plant is exactly as unprotected as a .ts one, and must be refused the same way.
  it.fails("(7) RED: refuses a run: whose .tsx plant is it.fails and carries no live:", () => {
    root = makeTreeAt(tsxPlantRel, RED_PLANT);
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${tsxPlantRel}`), root);
    expect(
      res.dispatchable,
      "the extension filter skips .tsx, so all 16 ui-admin worldview plants bypass this gate",
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  // (8) RED: .mts is the same class of miss. Asserted separately so a fix for one does not imply
  //     the other — a regex widened to `tsx?` alone would leave this red.
  it.fails("(8) RED: refuses a run: whose .mts plant is it.fails and carries no live:", () => {
    root = makeTreeAt(mtsPlantRel, RED_PLANT);
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${mtsPlantRel}`), root);
    expect(res.dispatchable, ".mts is skipped by the same filter").toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  // (9) COUNTERWEIGHT, live in BOTH states: a .tsx plant WITH a live: rule stays ACCEPTED.
  //     Without this, "refuse every .tsx card" satisfies (7) and breaks all of lane B. This clause
  //     passes today (the gate skips) and must still pass after the fix (the gate looks, and live:
  //     covers it) — the two reasons differ, which is the point.
  it("(9) COUNTERWEIGHT: accepts a .tsx it.fails plant when a live: rule covers it", () => {
    root = makeTreeAt(tsxPlantRel, RED_PLANT);
    const res = briefFromIssue(
      card(`- run:pnpm exec vitest run ${tsxPlantRel}\n- live:${tsxPlantRel}`),
      root,
    );
    expect(res.dispatchable, "a correctly-protected .tsx card must remain dispatchable").toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // (10) COUNTERWEIGHT, live in BOTH states: a plain it() .tsx plant needs no second proof form,
  //      exactly as a .ts one does not. Stops the fix from punishing the good shape.
  it("(10) COUNTERWEIGHT: accepts a plain it() .tsx plant with no live: rule", () => {
    root = makeTreeAt(tsxPlantRel, LIVE_PLANT);
    const res = briefFromIssue(card(`- run:pnpm exec vitest run ${tsxPlantRel}`), root);
    expect(res.dispatchable).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
