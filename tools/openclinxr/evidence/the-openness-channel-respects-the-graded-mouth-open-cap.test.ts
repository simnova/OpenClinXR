import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #730 / xr-systems-architect.
 *
 * ## THE DEFECT, MEASURED 2026-08-27 at main `28a3632f` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * Two mouth channels write the same mesh every frame and only one of them is bounded.
 *
 * `main.ts:8964-8968`, inside `applyHumanoidMorphTargetCue`:
 *
 *     const mouthOpenIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_mouth_open");
 *     if (typeof mouthOpenIndex === "number") {
 *       object.morphTargetInfluences[mouthOpenIndex] =
 *         Math.min(0.95, Math.max(0, openness + expressionWeights.mouthOpen * 0.18));
 *     }
 *
 * The viseme is not consulted. `applyNamedSpeechVisemes` writes the `viseme_*` targets separately in
 * the same call.
 *
 * Resolved live against the shipped subject `mpfb_ob_patient_aisha_body` (47 targets: 15 `viseme_*`,
 * 13 `mouth-*` FACS, no `openclinxr_*`):
 *
 *     openclinxr_mouth_open    -> mouth-open
 *     viseme_sil               -> viseme_sil
 *     openclinxr_cheek_tension -> null
 *
 * So the openness channel writes `mouth-open` with a ceiling of 0.95, while
 * `viseme-morph-apply.ts:56` caps that same target at `MOUTH_OPEN_CAP = 0.3` inside
 * `applyVisemeWeights`. The `main.ts` write does not pass through `applyVisemeWeights` and is not
 * capped.
 *
 * ## THE GRADED CEILING IS AUTHORED DATA, NOT A NUMBER CHOSEN HERE
 *
 * `viseme-morph-apply.ts:48-55` records where 0.3 came from: #459's sweep, graded twice —
 * 0.3 ACCEPTABLE, 0.6 DEGRADING, 1.0 UNACCEPTABLE. This file reads the constant rather than
 * restating it, so a re-sweep that lowers it binds here automatically.
 *
 * ## THE OBSERVED CONSEQUENCE
 *
 * Across the 63 `viseme_sil` samples of the 2026-08-27 run, `activeMouthOpenness` ranged
 * 0.000 to 0.647 — before the `expressionWeights.mouthOpen * 0.18` term. The DEGRADING band starts
 * at 0.6. Frames 01-06 span 12.1 s of continuous `viseme_sil` at influence 1.0 and every one renders
 * the mouth wide open.
 *
 * ## WHY THE EXISTING ARTIFACT COULD NOT SEE IT
 *
 * `sampleParentVisemes` enumerates `viseme_*` keys only, so `mouth-open` never reaches
 * `nonZeroVisemes`. All 67 `sil` samples reported exactly one nonzero morph while the pixels showed
 * an open jaw. Clause (1) exists because the cap cannot be proven by an instrument blind to the
 * target it bounds.
 *
 * claimScope: what the openness channel writes to `mouth-open`, and whether the capture can see it.
 * notEvidenceFor: that 0.3 is the right ceiling for THIS channel — #460's own NOT TESTED says only
 *   the swept target was capped. Nor the child or nurse: only the parent was captured.
 */

/**
 * ## FIXED (#730)
 *
 * Chosen fix: apply the cap at the `main.ts` site. `applyHumanoidMorphTargetCue` now writes
 * `Math.min(MOUTH_OPEN_CAP, Math.max(0, openness + expressionWeights.mouthOpen * 0.18))` instead
 * of the 0.95 ceiling, importing the exported constant from viseme-morph-apply.ts — the same
 * graded value `applyVisemeWeights` uses, so a re-sweep that lowers it binds both channels at
 * once. Not routed through `applyVisemeWeights` (larger call-shape change for the same bound) and
 * not sil-suppression (sil was not the only offender — the uncapped write fires for every viseme;
 * the run's `open` peaks were the same uncapped write). The runtime now records the resolved
 * dictionary names in the morph cue (`resolvedTargets`), and the capture ships every nonzero morph
 * on the subject.
 *
 * MEASURED 2026-08-27 capture (subject `mpfb_ob_patient_aisha_body_1`, actor
 * `parent_tara_johnson_v1`): 48 samples; 21 `mouth-open` readings; max 0.3 (the cap) while
 * `activeMouthOpenness` peaked at 0.645 — so clause (3)'s floor is exercised, not vacuous. The 35
 * `viseme_sil`-dominant samples carry `mouth-open` at 0.3, the graded ACCEPTABLE cell, where the
 * pre-fix run recorded up to 0.647 (DEGRADING). `resolved` matches the header's measured table:
 * `openclinxr_mouth_open -> mouth-open`, `openclinxr_brow_concern -> eyebrows-left-inner-up`,
 * `openclinxr_cheek_tension -> null`. Frames are graded by the orchestrator.
 */

const REPORT = "tools/openclinxr/evidence/mouth-open-channel.json";
const CAP_SOURCE = "apps/ui-xr/src/viseme-morph-apply.ts";

/** Read the graded cap from its source rather than restating it (SS9h known-good). */
function gradedCap(): number {
  const src = readFileSync(CAP_SOURCE, "utf8");
  const m = /MOUTH_OPEN_CAP\s*=\s*([0-9.]+)/.exec(src);
  if (!m) throw new Error(`MOUTH_OPEN_CAP not found in ${CAP_SOURCE}`);
  return Number(m[1]);
}

type Sample = {
  t: number;
  activeMouthOpenness: number | null;
  /** every nonzero morph on the subject, whatever its prefix */
  nonZeroMorphs: Array<{ targetName: string; influence: number }>;
};

type Report = {
  meshName: string;
  resolved?: Record<string, string | null>;
  samples: Sample[];
};

function report(): Report | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function mouthOpenReadings(r: Report): number[] {
  return r.samples
    .flatMap((s) => s.nonZeroMorphs)
    .filter((m) => m.targetName === "mouth-open")
    .map((m) => m.influence);
}

describe("the openness channel respects the graded mouth-open cap (#730)", () => {
  /**
   * RED. Today the capture records `viseme_*` only. This requires a tracked artifact that
   * enumerates EVERY nonzero morph on the subject, because a cap cannot be proven by an instrument
   * blind to the target it bounds. The `mouth-open` reading count must be non-zero, so an artifact
   * that records nothing satisfies nothing.
   */
  it("(1) the capture records every nonzero morph, not only the viseme_ prefix", () => {
    const r = report();
    expect(r, `${REPORT} must exist — a tracked artifact, not the gitignored inspection.json`).not.toBeNull();
    expect(r!.samples.length, "at least one sample").toBeGreaterThan(0);
    expect(
      mouthOpenReadings(r!).length,
      "mouth-open is the target the openness channel writes; an artifact that never records it "
        + "cannot answer this card",
    ).toBeGreaterThan(0);
  });

  /**
   * RED, and it reds today for the honest reason: there are no readings at all. Once clause (1)
   * lands, this is the assertion that bites. The bound is READ from the source constant, so it
   * tracks a re-sweep rather than pinning my own number.
   */
  it("(2) no recorded mouth-open weight exceeds the graded cap", () => {
    const r = report();
    expect(r, `${REPORT} must exist`).not.toBeNull();
    const readings = mouthOpenReadings(r!);
    expect(readings.length, "nothing to bound is not a pass").toBeGreaterThan(0);
    const cap = gradedCap();
    expect(
      Math.max(...readings),
      `#459 graded mouth-open 0.3 ACCEPTABLE / 0.6 DEGRADING / 1.0 UNACCEPTABLE; the main.ts `
        + `openness write ceilings at 0.95 and bypasses applyVisemeWeights' cap of ${cap}`,
    ).toBeLessThanOrEqual(cap);
  });

  /**
   * COUNTERWEIGHT. Zeroing the openness channel clears clause (2) and flattens the face. The floor
   * is derived from the INPUT rather than chosen: on a run where the speech channel itself opens the
   * mouth past the cap, the morph must still move. No literal threshold of mine appears.
   */
  it("(3) COUNTERWEIGHT: the morph still tracks the speech channel", () => {
    const r = report();
    if (r === null) return; // clause (1) owns the artifact's existence
    const speechMax = Math.max(0, ...r.samples.map((s) => s.activeMouthOpenness ?? 0));
    const readings = mouthOpenReadings(r);
    if (speechMax <= gradedCap() || readings.length === 0) return;
    expect(
      Math.max(...readings),
      `activeMouthOpenness reached ${speechMax} on this run, so clamping the channel to zero would `
        + "satisfy clause (2) by removing the mouth movement rather than bounding it",
    ).toBeGreaterThan(0);
  });

  /**
   * COUNTERWEIGHT against the other cheap fix: raise the cap until both paths agree. Only the
   * raising direction is refused — a re-sweep that LOWERS it is a legitimate outcome and must not be
   * pre-refused (the graded sweep is the authority, not this file).
   */
  it("(4) COUNTERWEIGHT: the graded cap is not raised", () => {
    expect(
      gradedCap(),
      "#459's sweep graded 0.6 DEGRADING and 1.0 UNACCEPTABLE; raising the cap to meet the "
        + "uncapped write would adopt the cell the sweep rejected",
    ).toBeLessThanOrEqual(0.3);
  });

  /**
   * KNOWN-GOOD. The whole card rests on `openclinxr_mouth_open` resolving to `mouth-open` on this
   * subject. If the alias map changes, this fails loudly instead of the contract silently measuring
   * a target nobody writes.
   */
  it("(5) KNOWN-GOOD: the runtime name resolves onto the FACS target", () => {
    const r = report();
    if (r === null) return; // clause (1) owns the artifact's existence
    expect(
      r.resolved?.["openclinxr_mouth_open"],
      "measured 2026-08-27 on mpfb_ob_patient_aisha_body, 47 targets, no openclinxr_* spellings",
    ).toBe("mouth-open");
  });
});

// NOT TESTED: whether 0.3 is the right ceiling for the openness channel specifically. #460 capped
// only the target its sweep covered and says so; this file reuses that number because it is the
// only graded one available, not because the channel was swept. Whether the child and the nurse
// behave the same — only the parent was captured. And whether bounding the write is the right fix
// at all, versus routing it through applyVisemeWeights or making sil suppress openness; clause (2)
// bounds the outcome and does not choose among those.
