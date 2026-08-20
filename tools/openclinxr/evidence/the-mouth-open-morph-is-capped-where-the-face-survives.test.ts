import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #460 — cap FACS `mouth-open` at 0.3, the last weight where the parent's face survives.
 *
 * ## THE GRADE THIS IMPLEMENTS — #459's sweep, graded twice, independently
 *
 * `tools/openclinxr/evidence/mouth-open-sweep-sheet.png`, native 1280x1032, four labelled cells,
 * one subject, one camera, one variable. Orchestrator and superagent graded it separately and
 * agreed:
 *
 *   | mouth-open | mid-face                                        | verdict            |
 *   |------------|-------------------------------------------------|--------------------|
 *   | 0.0 rest   | nose bridge present, cheeks hold                | CLEAN              |
 *   | **0.3**    | holds; mouth slightly parted                    | **ACCEPTABLE — last usable** |
 *   | 0.6        | nose softening, canthus creases, cheeks flatten | DEGRADING          |
 *   | 1.0        | nose bridge GONE, cheeks sucked in, wide gape   | UNACCEPTABLE       |
 *
 * **The break is 0.3-0.6.** The target is usable only in its bottom third — this is not "extreme
 * at full weight". 0.3 is a graded observation, not a number either of us invented.
 *
 * ## WHY THIS IS PRODUCT
 *
 * The shipped parent GLB carries **32 FACS targets and no `viseme_AA`** (measured). So the
 * runtime's AA maps onto `mouth-open`, and `viseme-runtime-wire.test.ts:134` currently asserts a
 * requested AA lands `mouth-open` at **exactly 1.0** — the unacceptable cell. A learner sees that
 * face today whenever the mixer emits AA at full weight.
 *
 * ## DO NOT USE WHOLE-FRAME LUMINANCE. It was blind to this defect.
 *
 * #459's ledger read `mean 54.88 / 54.87 / 54.87 / 54.86` across a progression the eye reads as
 * dramatic — a **0.02 spread**, which is dither. My own clause there required only `spread > 0` and
 * passed on it. That bound distinguished "not bit-identical" and nothing more. Recorded so this
 * contract does not repeat it: the geometric assertion below is on **mid-face vertex displacement**,
 * and the stills must be **face-framed**, not torso-framed as #459's were.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — a request of 1.0 for `mouth-open` must land at 0.3. Today it lands at 1.0.
 *   (2) RED   — the cap ledger + face-framed stills do not exist.
 *   (3) RED   — mid-face displacement at the cap must be at or below the 0.3 cell and STRICTLY
 *               below the 1.0 cell.
 *   (4) NET   — other FACS targets are NOT clamped. `mouth-eversion` at 1.0 still lands at 1.0.
 *               Passes today (nothing is clamped yet) and must keep passing.
 *   (5) NET   — the sweep sheet and its ledger stay on disk unmodified. Passes today.
 *   (6) GUARD-BEHIND-THE-ARTIFACT — 0.3 is a visibly OPEN mouth, not a disguised zero. It reads
 *               the ledger, so it FAILS today like (1)-(3). Fourth slice running where I have had
 *               to write this line; a clause that reads its own deliverable is red until the
 *               deliverable exists, and that is not the same thing as a RED. (4) and (5) are the
 *               only true nets — they read the apply module and the sweep evidence.
 *
 * Clean tree: **4 failing / 2 passing.**
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) clamp EVERY morph to 0.3                     -> (4) fails; only the swept target is capped
 *   b) zero `mouth-open` so nothing can cave         -> (6) fails; the mouth must still open
 *   c) cap at 0.6 because it is "mostly fine"        -> (1) fails; 0.6 was graded DEGRADING
 *   d) assert whole-frame luminance again            -> (3) requires a mid-face geometric measure
 *   e) edit #459's sheet or ledger to match a new cap-> (5) fails
 *   f) delete the `toBe(1)` assertion                -> merge-kill refuses `deleted-test`; REWRITE
 *      it to `toBe(0.3)` and name it in the report
 *
 * NOT TESTED:
 *   - #402's spike. Absent from every graded cell; still open, still unoperationalized.
 *   - Baking `viseme_AA` onto the parent. That is the follow-on that could raise or remove this cap
 *     and it is deliberately NOT bundled here.
 *   - Other FACS targets at 1.0. Only `mouth-open` was swept; capping what was not measured would
 *     be inventing thresholds.
 *   - Whether 0.3 reads as speech to a learner. Structural intactness is not legibility.
 *   - Helmet hair, face-vs-arm colour. Present at rest in every cell; recorded on #402.
 *   - Quest, on-device rendering, frame budget.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const LEDGER = join(HERE, "mouth-open-cap.json");
const SWEEP_SHEET = join(HERE, "mouth-open-sweep-sheet.png");
const SWEEP_LEDGER = join(HERE, "mouth-open-sweep.json");
const APPLY = join(REPO_ROOT, "apps/ui-xr/src/viseme-morph-apply.ts");
/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const SPECIFIER = ["../../../apps/ui-xr/src/viseme-morph", "apply.js"].join("-");

/** The graded cap. Chosen from rendered evidence, not picked by the orchestrator. */
const CAP = 0.3;
const CAPPED_TARGET = "mouth-open";
/** Swept only mouth-open, so only mouth-open is capped. */
const UNCAPPED_TARGET = "mouth-eversion";

type CapLedger = {
  cap: number;
  midFaceDeltaMm: { rest: number; atCap: number; atFullRequest: number; atSweep03: number; atSweep10: number };
  stills: { stateId: string; path: string }[];
};

const ledger: CapLedger | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as CapLedger)
  : null;

type ApplyMod = {
  applyVisemeWeights?: (
    target: { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] },
    weights: Record<string, number>,
  ) => unknown;
};
const mod: ApplyMod = await (async () => {
  try {
    return (await import(SPECIFIER)) as ApplyMod;
  } catch {
    return {};
  }
})();

/** A fake three.js morph target: two named targets, both starting at 0. */
function makeTarget() {
  return {
    morphTargetDictionary: { [CAPPED_TARGET]: 0, [UNCAPPED_TARGET]: 1 },
    morphTargetInfluences: [0, 0],
  };
}

function requireApply(): NonNullable<ApplyMod["applyVisemeWeights"]> {
  expect(mod.applyVisemeWeights, `apps/ui-xr/src/viseme-morph-apply.ts must export applyVisemeWeights`)
    .toBeTypeOf("function");
  return mod.applyVisemeWeights as NonNullable<ApplyMod["applyVisemeWeights"]>;
}

function requireLedger(): CapLedger {
  expect(
    ledger,
    `tools/openclinxr/evidence/mouth-open-cap.json must exist with mid-face displacement and the `
      + `face-framed stills — whole-frame luminance was blind to this defect (#459)`,
  ).not.toBeNull();
  return ledger as CapLedger;
}

describe("the mouth-open morph is capped where the face survives", () => {
  it("(1) RED: a request of 1.0 lands mouth-open at the graded cap", () => {
    const t = makeTarget();
    requireApply()(t, { [CAPPED_TARGET]: 1 });
    expect(
      t.morphTargetInfluences[0],
      `1.0 is the UNACCEPTABLE cell (nose bridge gone). 0.3 is the last graded-acceptable weight; `
        + `0.6 was graded DEGRADING, so it is not the cap.`,
    ).toBe(CAP);
  });

  it("(2) RED: the cap ledger and its face-framed stills exist", () => {
    const l = requireLedger();
    expect(l.cap, "the ledger records the cap it was measured at").toBe(CAP);
    const ids = l.stills.map((s) => s.stateId).sort();
    expect(ids, `rest, the cap, and a full request that must match the cap`).toEqual(
      ["at-cap", "full-request", "rest"],
    );
    for (const s of l.stills) {
      const p = join(REPO_ROOT, s.path);
      expect(existsSync(p), `${s.path} must exist`).toBe(true);
      expect(statSync(p).size, `${s.path} must carry rendered content`).toBeGreaterThan(40_000);
    }
  });

  it("(3) RED: mid-face displacement at the cap is at or below the 0.3 cell and strictly below 1.0", () => {
    // Refuses (d). Geometric, not photometric — #459's whole-frame luminance moved 0.02 across a
    // collapse anyone can see.
    const d = requireLedger().midFaceDeltaMm;
    expect(d.atCap, `the cap must not deform the mid-face more than the graded 0.3 cell`).toBeLessThanOrEqual(
      d.atSweep03,
    );
    expect(d.atCap, `if the cap deforms as much as the 1.0 cell it is not capping anything`).toBeLessThan(
      d.atSweep10,
    );
    expect(
      d.atFullRequest,
      `a full request is clamped, so it must measure the same as the cap`,
    ).toBeCloseTo(d.atCap, 3);
  });

  it("(4) COUNTERWEIGHT: targets that were never swept are NOT clamped", () => {
    // Refuses (a). Capping what nobody measured is inventing thresholds.
    const t = makeTarget();
    requireApply()(t, { [UNCAPPED_TARGET]: 1 });
    expect(
      t.morphTargetInfluences[1],
      `only mouth-open was swept and graded; ${UNCAPPED_TARGET} keeps its full range`,
    ).toBe(1);
  });

  it("(5) COUNTERWEIGHT: #459's graded sweep evidence is untouched", () => {
    // Refuses (e). The cap rests on that sheet; moving it moves the ground under this contract.
    expect(statSync(SWEEP_SHEET).size, "the graded sheet stays on disk").toBeGreaterThan(150_000);
    const sweep = JSON.parse(readFileSync(SWEEP_LEDGER, "utf8")) as { cells: { morphWeight: number }[] };
    expect(
      sweep.cells.map((c) => c.morphWeight).sort((a, b) => a - b),
      "the four swept weights are the evidence for 0.3; they do not change",
    ).toEqual([0, 0.3, 0.6, 1]);
  });

  it("(6) VACUITY GUARD: the cap is a visibly OPEN mouth, not a disguised zero", () => {
    // Refuses (b). Zeroing the target trivially prevents the cave and destroys the feature.
    expect(CAP, "a cap of 0 is not a cap, it is a deletion").toBeGreaterThan(0);
    const d = requireLedger().midFaceDeltaMm;
    expect(
      d.atCap,
      `the mouth must still open at the cap — a mid-face identical to rest means nothing moved`,
    ).toBeGreaterThan(d.rest);
    expect(readFileSync(APPLY, "utf8").length, "the apply module is readable").toBeGreaterThan(0);
  });
});
