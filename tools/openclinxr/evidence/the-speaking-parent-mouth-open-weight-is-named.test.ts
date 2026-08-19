import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 (#419) — WHAT WEIGHT DOES `mouth-open` ACTUALLY REACH IN SPEECH?
 *
 * ## WHY THIS DECIDES WHETHER #402 IS A DEFECT AT ALL
 *
 * #431 (`99685eda`) landed a graded still pair: at `mouth-open` weight **1.0** the parent's mid-face
 * collapses — cheeks cave, nose-to-jaw creases, jaw distorted well past a mouth opening. Same GLB,
 * same camera, only the morph differs. That is real and I saw it.
 *
 * **It was produced by the harness, not by speech.** The isolated harness could not set a runtime
 * speaking state, so the authorised fallback drove one morph to full weight. If live speech never
 * approaches 1.0, no learner ever sees that collapse and #402 is a harness artefact.
 *
 * **A CORRECTION THAT THIS SLICE EXISTS TO AVOID REPEATING.** I proposed reusing E2.2's
 * `speakingMorphInfluence: 1.0` as evidence the parent hits full weight while speaking. That figure
 * is the **max over all morphs**, not `mouth-open`. Treating an unnamed aggregate as one target is
 * exactly how a harness artefact gets promoted to a product defect. Hence: named weights, or nothing.
 *
 * ## MEASURED POPULATION — do not re-derive
 *
 * `mpfb-peds-parent-aisha.glb` and its `.motion-bind` variant both carry **32 morph targets**,
 * including `mouth-open` by name, plus `mouth-compression`, `mouth-corner-puller`,
 * `mouth-depression-retraction`, `mouth-elevation`, `mouth-eversion` and others. **No `viseme_*`** —
 * those exist only on `mpfb-viseme-inspect.glb` (47 targets), which is a different asset.
 *
 * ## THE STOP RULE IS THE LEAD'S, NOT MINE
 *
 * If live `mouth-open` stays **≤ 0.3** and no viseme/mouth target is high, the 1.0 still is a
 * **harness artefact** — say so and do NOT fix anything. That threshold came from the lead with the
 * slice; it is recorded here as an inherited stop rule rather than a number I chose.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no artifact                                       |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) report a single max influence, unnamed                    |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   c) name only `mouth-open`, drop the other 31                 |FAIL | pass| pass|FAIL | REFUSED
 *   d) name all 32 but give one state only                       |FAIL | pass| pass| pass| REFUSED
 *   e) all 32 named, both states, verdict from the stop rule     | pass| pass| pass| pass| ALL PASS
 *   f) mouth-open measured HIGH but verdict says artefact      | pass| pass|FAIL | pass| REFUSED
 *
 * **(b) is the one to watch** — it is the exact shape of the inference the lead caught me making.
 * Clause (2) requires `mouth-open` to carry its own value and requires any aggregate to be labelled
 * as an aggregate, so the two can never be read as the same number again.
 *
 * Rows (c) col (4) and (d) col (2) were corrected from probe output, not prediction. Treatment (f)
 * was added after probing and is the sharpest one: measuring `mouth-open` at 0.95 and still writing
 * `harness_artefact` is refused by clause (3), which recomputes the verdict from the numbers. The
 * verdict is not the author's to choose.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **all four RED** — no artifact exists.
 *
 * NOT TESTED: the cause of the collapse (weights vs morph authoring vs topology — none measured);
 * any fix; other actors; whether the runtime's speech drive is itself correct. This slice measures
 * a weight and nothing else.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-parent-morph-weights.json");

/** Measured from both parent GLBs 2026-08-19. */
const EXPECTED_MORPH_COUNT = 32;
const TARGET = "mouth-open";
/** The lead's stop rule, inherited with the slice. */
const HARNESS_ARTEFACT_CEILING = 0.3;

type Entry = { name: string; speaking: number; notSpeaking: number };
type Doc = {
  actor?: string; sourceGlb?: string; enumeratedFrom?: string;
  morphs?: Entry[];
  maxOverAllMorphsSpeaking?: { name: string; value: number };
  verdict?: "harness_artefact" | "reaches_high_in_speech" | string;
};
const doc = (): Doc => {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — this slice writes it`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Doc;
};

describe("the parent's mouth-open weight in live speech is named, not aggregated", () => {
  it("(1) RED: every morph is named with BOTH state values", () => {
    const d = doc();
    expect(d.morphs?.length, `all ${EXPECTED_MORPH_COUNT} targets must be reported`).toBe(EXPECTED_MORPH_COUNT);
    for (const m of d.morphs!) {
      expect(typeof m.name === "string" && m.name.length > 0, "each entry needs a name").toBe(true);
      expect(Number.isFinite(m.speaking), `${m.name}: speaking value`).toBe(true);
      expect(Number.isFinite(m.notSpeaking), `${m.name}: not-speaking value`).toBe(true);
    }
  });

  it("(2) COUNTERWEIGHT: mouth-open carries its OWN value, and any aggregate is labelled as one", () => {
    // Refuses (b) — the unnamed-max inference. An aggregate may be reported, but only under a field
    // whose name says it is a maximum over all morphs, and it must name which morph produced it.
    const d = doc();
    const mo = d.morphs?.find((m) => m.name === TARGET);
    expect(mo, `${TARGET} must be reported by name`).toBeTruthy();
    expect(Number.isFinite(mo!.speaking), `${TARGET} speaking weight`).toBe(true);
    if (d.maxOverAllMorphsSpeaking !== undefined) {
      expect(d.maxOverAllMorphsSpeaking.name, "an aggregate must name the morph that produced it").toBeTruthy();
    }
  });

  it("(3) COUNTERWEIGHT: the verdict follows the stop rule, not the author's preference", () => {
    const d = doc();
    const mo = d.morphs!.find((m) => m.name === TARGET)!;
    const anyHigh = d.morphs!.some((m) => /mouth|viseme/i.test(m.name) && m.speaking > HARNESS_ARTEFACT_CEILING);
    const expected = mo.speaking <= HARNESS_ARTEFACT_CEILING && !anyHigh ? "harness_artefact" : "reaches_high_in_speech";
    expect(d.verdict, `mouth-open speaking=${mo.speaking}; any mouth/viseme > ${HARNESS_ARTEFACT_CEILING}: ${anyHigh}`).toBe(expected);
  });

  it("(4) VACUITY GUARD: the population came from the asset, not a literal list", () => {
    const d = doc();
    expect(d.enumeratedFrom, "the GLB the morph list was read from").toMatch(/\.glb$/);
    expect(d.actor, "the subject").toMatch(/parent/);
    expect(new Set(d.morphs!.map((m) => m.name)).size, "names must be distinct").toBe(EXPECTED_MORPH_COUNT);
  });
});
