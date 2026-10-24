import { describe, expect, it } from "vitest";
import { assertUniqueDerivationWitnesses, parseLandingNote } from "./landing-note.js";

/**
 * Private unit for the landing-note census + witness (candidate mirror of
 * evidence/room-camera/landing-note.test.ts). Parser-only: no browser.
 */

const HEALTHY =
  "roomCam(derived)=1.00,1.68,-2.00 look=0.00,1.00,0.50 nearestActor=2.50m "
  + "rejected= interiorMaxZ=3.00 wallThickness=0.120 census=15/15/0 witness=1760000000000:891.234";
const OCCLUDED =
  "roomCam(derived)=-3.01,1.64,2.31 look=0.49,1.00,0.10 nearestActor=3.13m "
  + "rejected=-3.0/2.4 3.0/2.4 0.0/2.4 -1.5/2.4 1.5/2.4 2.9/1.2 "
  + "interiorMaxZ=3.05 wallThickness=0.118 census=15/9/6 witness=1760000001000:891.234";

describe("parseLandingNote", () => {
  it("accepts a healthy room with zero rejects (census 15/15/0)", () => {
    const p = parseLandingNote(HEALTHY, "primary_care_dyslipidemia_joint_pain_v1");
    expect(p.eye).toEqual([1, 1.68, -2]);
    expect(p.candidateTotal).toBe(15);
    expect(p.acceptedCount).toBe(15);
    expect(p.rejectedCount).toBe(0);
    expect(p.acceptedCount + p.rejectedCount).toBe(p.candidateTotal);
    expect(p.witness).toBe("1760000000000:891.234");
  });

  it("accepts an occluded room with rejects (census 15/9/6)", () => {
    const p = parseLandingNote(OCCLUDED, "primary_care_dyslipidemia_joint_pain_v1");
    expect(p.candidateTotal).toBe(15);
    expect(p.acceptedCount).toBe(9);
    expect(p.rejectedCount).toBe(6);
  });

  it("throws on omitted census / missing witness / missing eye / missing rejected marker", () => {
    expect(() => parseLandingNote(OCCLUDED.replace(/ census=\S+/, ""), "s")).toThrow(/census/);
    expect(() => parseLandingNote(OCCLUDED.replace(/ witness=\S+/, ""), "s")).toThrow(/witness/);
    expect(() => parseLandingNote(OCCLUDED.replace(/roomCam\(derived\)=\S+/, ""), "s")).toThrow(/eye/);
    expect(() => parseLandingNote(OCCLUDED.replace(/rejected=/, "withheld="), "s")).toThrow(/rejected/);
  });

  it("throws on malformed census (accepted+rejected != total, non-positive total)", () => {
    expect(() => parseLandingNote(OCCLUDED.replace("15/9/6", "15/9/5"), "s")).toThrow(/inconsistent/);
    expect(() => parseLandingNote(OCCLUDED.replace("census=15/9/6", "census=0/0/0"), "s")).toThrow();
  });

  it("rejects a decimal smuggled into an integer count (census=15/15/0.5)", () => {
    expect(() => parseLandingNote(HEALTHY.replace("census=15/15/0", "census=15/15/0.5"), "s")).toThrow(
      /census/,
    );
  });

  it("rejects a non-numeric witness (witness=garbage)", () => {
    expect(() => parseLandingNote(HEALTHY.replace(/witness=\S+/, "witness=garbage"), "s")).toThrow(
      /witness/,
    );
    expect(() => parseLandingNote(HEALTHY.replace(/witness=\S+/, "witness=0:12.5"), "s")).toThrow(
      /witness/,
    );
  });

  it("rejects a rejected-list whose token count disagrees with census R", () => {
    const short = OCCLUDED.replace(" 2.9/1.2 ", " "); // 5 tokens but R=6
    expect(() => parseLandingNote(short, "s")).toThrow(/tokens/);
    const nonEmptyForZero = HEALTHY.replace("rejected= ", "rejected=1.0/2.0 "); // 1 token but R=0
    expect(() => parseLandingNote(nonEmptyForZero, "s")).toThrow(/tokens/);
    const badToken = OCCLUDED.replace("2.9/1.2", "abc");
    expect(() => parseLandingNote(badToken, "s")).toThrow(/token/);
  });

  it("rejects negative counts", () => {
    expect(() => parseLandingNote(OCCLUDED.replace("census=15/9/6", "census=-15/9/6"), "s")).toThrow(
      /census/,
    );
  });
});

describe("assertUniqueDerivationWitnesses", () => {
  it("passes distinct per-derivation witnesses, fails a copied reading", () => {
    expect(() =>
      assertUniqueDerivationWitnesses(["1760000000000:891.234", "1760000001000:891.234"]),
    ).not.toThrow();
    expect(() =>
      assertUniqueDerivationWitnesses(["1760000000000:891.234", "1760000000000:891.234"]),
    ).toThrow(/copied reading/);
    expect(() => assertUniqueDerivationWitnesses([])).toThrow(/no derivation witnesses/);
  });

  it("a copied healthy note fails uniqueness (not the census)", () => {
    const a = parseLandingNote(HEALTHY, "s").witness;
    const b = parseLandingNote(HEALTHY, "s").witness; // same computed reading, replayed
    expect(() => assertUniqueDerivationWitnesses([a, b])).toThrow(/copied reading/);
  });
});
