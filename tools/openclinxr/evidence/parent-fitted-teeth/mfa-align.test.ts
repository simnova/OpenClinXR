/**
 * MFA cue source: TextGrid parse + label-driven closure rule.
 *
 * No wav, no browser, no GLB. Pure functions only (parseMfaPhonesTier,
 * applyMfaClosureRule); runMfaAlign shells to the pinned env and is covered
 * by the slice's determinism check (two alignments, byte-identical cue JSON),
 * not by this file.
 */
import { describe, expect, it } from "vitest";
import { applyMfaClosureRule, parseMfaPhonesTier, type ArpabetCue } from "./mfa-align.ts";

const TIER = `File type = "ooTextFile"
Object class = "TextGrid"

xmin = 0
xmax = 4.13125
tiers? <exists>
size = 2
item []:
    item [2]:
        class = "IntervalTier"
        name = "phones"
        xmin = 0
        xmax = 4.13125
        intervals: size = 5
        intervals [1]:
            xmin = 2.38
            xmax = 2.52
            text = ""
        intervals [2]:
            xmin = 2.52
            xmax = 2.55
            text = "B"
        intervals [3]:
            xmin = 0.31
            xmax = 0.50
            text = "F"
        intervals [4]:
            xmin = 4.09
            xmax = 4.13
            text = ""
        intervals [5]:
            xmin = 0.28
            xmax = 0.31
            text = "sp"
`;

describe("parseMfaPhonesTier", () => {
  it("reads phone intervals and maps empty text to SIL", () => {
    const cues = parseMfaPhonesTier(TIER);
    expect(cues).toHaveLength(5);
    expect(cues[0]).toEqual({ startS: 2.38, endS: 2.52, phone: "SIL" });
    expect(cues[1]).toEqual({ startS: 2.52, endS: 2.55, phone: "B" });
    expect(cues[2]).toEqual({ startS: 0.31, endS: 0.5, phone: "F" });
  });

  it("refuses a TextGrid without a phones tier", () => {
    expect(() => parseMfaPhonesTier("xmin = 0\n")).toThrow("mfa-textgrid-missing-phones-tier");
  });
});

describe("applyMfaClosureRule", () => {
  const ruled = (phones: Array<[number, number, string]>): ArpabetCue[] =>
    applyMfaClosureRule(phones.map(([startS, endS, phone]) => ({ startS, endS, phone })));

  it("relabels pre-bilabial silence to PP with unchanged bounds", () => {
    const cues = ruled([[2.41, 2.56, "SIL"], [2.56, 2.59, "B"]]);
    expect(cues[0]).toEqual({ startS: 2.41, endS: 2.56, phone: "P" });
    expect(cues[1]?.phone).toBe("B");
  });

  it("fires before nasals and keeps stressed/unstressed spellings working", () => {
    const cues = ruled([[0.21, 0.3, "sp"], [0.3, 0.34, "M"]]);
    expect(cues[0]?.phone).toBe("P");
  });

  it("leaves silence before fricatives and trailing silence alone", () => {
    const cues = ruled([
      [0.28, 0.31, "SIL"],
      [0.31, 0.5, "F"],
      [4.09, 4.13, "SIL"],
    ]);
    expect(cues[0]?.phone).toBe("SIL");
    expect(cues[2]?.phone).toBe("SIL");
  });

  it("is a pure relabel: input array untouched", () => {
    const input: ArpabetCue[] = [{ startS: 1.36, endS: 1.53, phone: "SIL" }, { startS: 1.53, endS: 1.56, phone: "P" }];
    applyMfaClosureRule(input);
    expect(input[0]?.phone).toBe("SIL");
  });
});
