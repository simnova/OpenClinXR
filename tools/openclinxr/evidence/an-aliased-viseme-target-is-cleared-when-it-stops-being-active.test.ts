import { describe, expect, it } from "vitest";
import { driveVisemeTimeline, resolveVisemeTarget } from "../../../apps/ui-xr/src/viseme-timeline-drive.js";

/**
 * #732 / xr-systems-architect.
 *
 * ## THE DEFECT, MEASURED 2026-08-27 at main `e03872c8` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * `viseme-timeline-drive.ts:222-243` builds each frame's zero map from a NAME PREFIX:
 *
 *     const visemeTargets = availableTargets.filter((name) =>
 *       name.toLowerCase().startsWith("viseme_"));
 *     const driveTargets = visemeTargets.length > 0 ? visemeTargets : [...CANONICAL_FALLBACK...];
 *     for (const target of driveTargets) {
 *       weights[target] = active !== null && target === active ? 1 : 0;
 *     }
 *     // If the active target is in availableTargets but not in driveTargets (edge case),
 *     // still set it so the frame is non-empty and names only real targets.
 *     if (active !== null && !(active in weights) && availableTargets.includes(active)) {
 *       weights[active] = 1;
 *     }
 *
 * A runtime viseme with no identity target resolves through the FACS alias map onto a `mouth-*`
 * name, which the prefix filter excludes from `driveTargets`. It is written at **1** by the branch
 * above and then omitted from every later frame. `applyVisemeWeights` writes only requested names
 * (`viseme-morph-apply.ts:14-19`, a recorded decision), so the target stays at 1 for the rest of the
 * encounter.
 *
 * ## THE BRANCH COMMENT SAYS "edge case". MEASURED, IT IS THE NORMAL PATH.
 *
 * `mpfb_ob_patient_aisha_body` ships 15 `viseme_*` targets and 13 `mouth-*` FACS targets. Resolved
 * live: `viseme_sil` -> `viseme_sil`, `viseme_TH` -> `viseme_TH`, `viseme_AA` -> `viseme_aa`,
 * `viseme_E` -> `viseme_E` (identity), but **`viseme_IH` -> `mouth-part-later`,
 * `viseme_OU` -> `mouth-protusion`, `viseme_L` -> `mouth-parling`** (alias). Three of fifteen
 * runtime visemes resolve outside the drive set, and the branch fires for every one of them.
 *
 * ## THE OBSERVED CONSEQUENCE
 *
 * `mouth-open-channel.json` carries 27 samples where `mouth-open` is 0 and `viseme_sil` is at 1.0 —
 * a natural control with the openness channel (#730) already at rest. Every one of the 27 also
 * carries `mouth-parling` 1, `mouth-part-later` 1 and `mouth-protusion` 1. The mouth is held open at
 * full weight by three targets nobody clears, which is why capping the openness channel in #730 did
 * not close it.
 *
 * `viseme_sil` resolves to `viseme_sil`, NOT to the alias map's `mouth-compression`, so the silence
 * shape writes a different target and cannot displace them.
 *
 * ## THE FIXTURE IS THE SHIPPED POPULATION, NOT A STAND-IN
 *
 * `AVAILABLE` below is the measured target list of the shipped parent. A fixture of invented names
 * would not exhibit the defect, because the defect is a property of the identity/alias split.
 *
 * claimScope: whether a target this drive writes at 1 is later cleared by the same drive.
 * notEvidenceFor: how the mouth looks; whether the child or nurse share the split; whether
 *   `CANONICAL_FALLBACK_VISEME_NAMES` (the no-`viseme_*`-at-all branch) has the same hole.
 */

/** Measured 2026-08-27 from `mpfb-peds-parent-aisha.motion-bind.glb`, mesh `mpfb_ob_patient_aisha_body`. */
const SHIPPED_VISEME_TARGETS = [
  "viseme_aa", "viseme_CH", "viseme_DD", "viseme_E", "viseme_FF", "viseme_I", "viseme_kk",
  "viseme_nn", "viseme_O", "viseme_PP", "viseme_RR", "viseme_sil", "viseme_SS", "viseme_TH",
  "viseme_U",
] as const;

const SHIPPED_FACS_TARGETS = [
  "mouth-compression", "mouth-corner-puller", "mouth-depression-retraction",
  "mouth-depression-retraction.001", "mouth-elevation", "mouth-eversion", "mouth-open",
  "mouth-parling", "mouth-part-later", "mouth-protusion", "mouth-pursing", "mouth-retraction",
  "mouth-upward-retraction",
] as const;

const AVAILABLE = [...SHIPPED_VISEME_TARGETS, ...SHIPPED_FACS_TARGETS];

/**
 * `IH` is the aliased case (resolves to `mouth-part-later`); `AA` is the identity case (resolves to
 * `viseme_aa`) and is the known-good column in clause (2). `sil` follows each so the sequence gives
 * the drive an explicit opportunity to clear the previous shape.
 */
const SEQUENCE = [
  { phoneme: "IH", atSecond: 0 },
  { phoneme: "sil", atSecond: 0.1 },
  { phoneme: "AA", atSecond: 0.2 },
  { phoneme: "sil", atSecond: 0.3 },
];

function framesFor(phonemes: ReadonlyArray<{ phoneme: string; atSecond: number }>) {
  return driveVisemeTimeline({ phonemes, availableTargets: AVAILABLE }).frames;
}

/** Targets any frame drives to full weight. */
function latchedAt1(frames: ReadonlyArray<{ weights: Record<string, number> }>): string[] {
  const names = new Set<string>();
  for (const f of frames) {
    for (const [name, w] of Object.entries(f.weights)) if (w === 1) names.add(name);
  }
  return [...names].sort();
}

/** Targets written to 1 somewhere and ABSENT from at least one other frame — the latch. */
function neverCleared(frames: ReadonlyArray<{ weights: Record<string, number> }>): string[] {
  return latchedAt1(frames).filter((name) => frames.some((f) => !(name in f.weights)));
}

describe("an aliased viseme target is cleared when it stops being active (#732)", () => {
  /**
   * RED. `mouth-part-later` is written at 1 by the IH frame and absent from the other three, so the
   * runtime leaves it at 1 forever. The assertion names no threshold: a target this drive raises is
   * a target this drive must be able to lower.
   */
  it.fails("(1) every target the drive raises to 1 is present in every frame's weight map", () => {
    const frames = framesFor(SEQUENCE);
    expect(
      neverCleared(frames),
      "a target written at 1 and then omitted stays at 1: applyVisemeWeights writes only requested "
        + "names, so an omitted target is never lowered",
    ).toEqual([]);
  });

  /**
   * KNOWN-GOOD, and it is what makes clause (1) non-vacuous: the identity case already behaves.
   * `viseme_aa` is inside `driveTargets`, so it receives an explicit 0 on the frames where it is not
   * active. If this ever fails, clause (1) is measuring something other than the alias split.
   */
  it("(2) KNOWN-GOOD: the identity case is already cleared on every non-active frame", () => {
    const frames = framesFor(SEQUENCE);
    const aaFrames = frames.filter((f) => "viseme_aa" in f.weights);
    expect(aaFrames.length, "viseme_aa is in driveTargets, so it appears in every frame").toBe(frames.length);
    expect(
      aaFrames.filter((f) => f.weights["viseme_aa"] === 0).length,
      "exactly the frames where AA is not the active phoneme",
    ).toBe(frames.length - 1);
  });

  /**
   * COUNTERWEIGHT. The cheapest way to satisfy clause (1) is to zero every morph on the mesh. That
   * is refused here by name: `mouth-open` is the openness channel's target, landed and bounded by
   * #730 at `main.ts:8973`, and a blanket zero from this drive would fight it every frame.
   */
  it("(3) COUNTERWEIGHT: the drive never names the openness channel's target", () => {
    const frames = framesFor(SEQUENCE);
    for (const f of frames) {
      expect(
        Object.keys(f.weights),
        "mouth-open belongs to applyHumanoidMorphTargetCue (#730); this drive must not write it",
      ).not.toContain("mouth-open");
    }
  });

  /**
   * COUNTERWEIGHT. The existing invariant the code states for itself — frames name only real
   * targets. A fix that widens the map by inventing names would break every body whose dictionary
   * does not carry them.
   */
  it("(4) COUNTERWEIGHT: every named target exists on the body", () => {
    const frames = framesFor(SEQUENCE);
    for (const f of frames) {
      for (const name of Object.keys(f.weights)) {
        expect(AVAILABLE, `${name} is not a target this body carries`).toContain(name);
      }
    }
  });

  /**
   * KNOWN-GOOD on the resolver. The whole card rests on these three resolving outside the
   * `viseme_`-prefixed drive set. If the alias map moves, this fails loudly rather than clause (1)
   * silently measuring a split that no longer exists.
   */
  it("(5) KNOWN-GOOD: the three aliased visemes still resolve onto FACS targets", () => {
    expect(resolveVisemeTarget("IH", AVAILABLE)).toBe("mouth-part-later");
    expect(resolveVisemeTarget("OU", AVAILABLE)).toBe("mouth-protusion");
    expect(resolveVisemeTarget("L", AVAILABLE)).toBe("mouth-parling");
    expect(resolveVisemeTarget("AA", AVAILABLE), "the identity case, for contrast").toBe("viseme_aa");
  });
});

// NOT TESTED: what the mouth looks like once the targets are cleared — that is a pixel grade and is
// the orchestrator's. Whether the child and nurse carry the same identity/alias split; only the
// parent's dictionary was measured. Whether `CANONICAL_FALLBACK_VISEME_NAMES`, taken when a mesh
// exposes no `viseme_*` at all, has the same hole — that branch is not exercised by this fixture.
