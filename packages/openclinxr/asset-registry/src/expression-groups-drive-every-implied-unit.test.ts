/**
 * REGRESSION GATE for the multi-target expression drive.
 *
 * DIAGNOSIS (measured 2026-09-16, mpfb-gown-adult-patient.glb, 47 target names):
 * the 1:1 resolver returned "eyebrows-left-inner-up" for openclinxr_brow_concern and null
 * for openclinxr_cheek_tension. An authored emotion therefore moved ONE eyebrow, and the
 * cheek channel moved nothing. This gate refuses a return to either state.
 *
 * The counterweight is the ANNY RAIL: a body carrying the canonical spelling must still
 * resolve to exactly itself, one target. That is what rejects the cheap fix of returning
 * the whole group unconditionally.
 *
 * claimScope: morph-target NAME resolution only. notEvidenceFor whether the resulting
 * face reads as the intended emotion to a human, nor anatomical correctness of the targets.
 */
import { describe, expect, it } from "vitest";
import { resolveMorphTarget, resolveMorphTargetGroup } from "./morph-target-resolver.js";

/** The FACS names an MPFB library body actually ships (measured, not invented). */
const MPFB_TARGETS = new Set([
  "eye-left-closure", "eye-left-opened-up", "eye-left-slit",
  "eye-right-closure", "eye-right-opened-up", "eye-right-slit",
  "eyebrows-left-down", "eyebrows-left-extern-up", "eyebrows-left-inner-up", "eyebrows-left-up",
  "eyebrows-right-down", "eyebrows-right-extern-up", "eyebrows-right-inner-up", "eyebrows-right-up",
  "mouth-compression", "mouth-open", "mouth-pursing", "mouth-retraction",
  "nose-compression-uncompress", "nose-depression", "neck-platysma",
]);

/** An Anny-rail body carries the canonical spellings directly. */
const ANNY_TARGETS = new Set([
  "openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension",
]);

describe("expression groups drive every implied FACS unit", () => {
  it("brow concern drives BOTH brows on an MPFB body, never one side alone", () => {
    const group = resolveMorphTargetGroup("openclinxr_brow_concern", MPFB_TARGETS);
    const names = group.map((g) => g.target);
    expect(names).toContain("eyebrows-left-inner-up");
    expect(names).toContain("eyebrows-right-inner-up");
    // the pre-fix behaviour was exactly one target; refuse any return to it
    expect(group.length).toBeGreaterThan(1);
    expect(names.filter((n) => n.includes("-left-")).length).toBe(
      names.filter((n) => n.includes("-right-")).length,
    );
  });

  it("cheek tension resolves to real shipped targets instead of null", () => {
    // the pre-fix 1:1 resolver returned null here — the channel drove nothing
    expect(resolveMorphTarget("openclinxr_cheek_tension", MPFB_TARGETS)).toBeNull();
    const group = resolveMorphTargetGroup("openclinxr_cheek_tension", MPFB_TARGETS);
    expect(group.length).toBeGreaterThan(0);
    for (const entry of group) expect(MPFB_TARGETS.has(entry.target)).toBe(true);
  });

  it("every returned target is present on the body — never a fabricated name", () => {
    for (const canonical of ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"]) {
      for (const entry of resolveMorphTargetGroup(canonical, MPFB_TARGETS)) {
        expect(MPFB_TARGETS.has(entry.target)).toBe(true);
        expect(entry.scale).toBeGreaterThan(0);
        expect(entry.scale).toBeLessThanOrEqual(1);
      }
    }
  });

  it("COUNTERWEIGHT: the Anny rail still resolves to exactly itself, one target", () => {
    for (const canonical of [...ANNY_TARGETS]) {
      const group = resolveMorphTargetGroup(canonical, ANNY_TARGETS);
      expect(group).toEqual([{ target: canonical, scale: 1 }]);
    }
  });

  it("COUNTERWEIGHT: a body with no matching targets gets an empty group, not a guess", () => {
    expect(resolveMorphTargetGroup("openclinxr_brow_concern", new Set(["unrelated_target"]))).toEqual([]);
  });
});
