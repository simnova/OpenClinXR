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
  //     The first version of this clause used the temp-dir path and was VACUOUS: that path does not
  //     exist relative to cwd, so existsSync short-circuited and the clause passed even with the
  //     treeRoot guard deleted. Caught by the destructive probe, not by reading it.
  const realPlant = "tools/openclinxr/evidence/the-elbow-bends-the-way-the-rig-was-built-to-bend.test.ts";

  it("does not fire when no tree root is supplied", () => {
    const withRoot = briefFromIssue(card(`- run:pnpm exec vitest run ${realPlant}`), process.cwd());
    expect(withRoot.dispatchable).toBe(false); // same card, tree root supplied -> refused

    const noRoot = briefFromIssue(card(`- run:pnpm exec vitest run ${realPlant}`));
    expect(noRoot.dispatchable).toBe(true); // optional parameter omitted -> silent
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
});
