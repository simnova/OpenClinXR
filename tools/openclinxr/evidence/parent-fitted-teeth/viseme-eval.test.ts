/**
 * Viseme-eval report validation (RESULTS, not gates).
 *
 * Failing per-phone checks inside the reports do not fail this file; only a
 * missing or malformed report does. Pure unit coverage for the words-tier
 * parser runs without captures.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMfaWordsTier } from "./viseme-eval.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const REPORT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");

const TIER = `File type = "ooTextFile"
Object class = "TextGrid"
item []:
    item [1]:
        class = "IntervalTier"
        name = "words"
        xmin = 0
        xmax = 1.6
        intervals: size = 4
        intervals [1]:
            xmin = 0
            xmax = 0.2
            text = ""
        intervals [2]:
            xmin = 0.2
            xmax = 0.61
            text = "put"
        intervals [3]:
            xmin = 0.61
            xmax = 1.21
            text = "fat"
        intervals [4]:
            xmin = 1.21
            xmax = 1.6
            text = "think"
    item [2]:
        class = "IntervalTier"
        name = "phones"
        xmin = 0
        xmax = 1.6
        intervals: size = 1
        intervals [1]:
            xmin = 0
            xmax = 1.6
            text = "P"
`;

type Report = {
  schemaVersion: string;
  clip: string;
  line: string;
  durationS: number;
  frameRate: number;
  coverage: { phones: string[]; visemesCovered: string[] };
  phoneCount: number;
  phones: {
    phone: string; startS: number; endS: number; expectedViseme: string;
    mid: {
      default: { frame: number; drivenTop: string; drivenWeight: number; jawFraction: number; upperTeethN: number; lowerTeethN: number; lipGapPx: number; mouthTeethN: number } | null;
      mouthFront: { frame: number; drivenTop: string; drivenWeight: number; jawFraction: number; upperTeethN: number; lowerTeethN: number; lipGapPx: number; mouthTeethN: number } | null;
    };
  }[];
  checks: {
    bilabial: { pass: number; fail: number; fails: unknown[] };
    labiodental: { pass: number; fail: number; fails: unknown[] };
    interdental: unknown[];
    mismatchByViseme: Record<string, { match: number; total: number }>;
  };
};

function loadReport(clip: string): Report {
  const file = path.join(REPORT_DIR, `${clip}.report.json`);
  expect(existsSync(file), `missing report ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as Report;
}

function checkReport(clip: string, line: string): void {
  const report = loadReport(clip);
  expect(report.schemaVersion).toBe("openclinxr.viseme-eval.v1");
  expect(report.clip).toBe(clip);
  expect(report.line).toBe(line);
  expect(report.durationS).toBeGreaterThan(0);
  expect(report.frameRate).toBe(30);
  expect(report.phoneCount).toBe(report.phones.length);
  expect(report.phoneCount).toBeGreaterThan(0);
  for (const row of report.phones) {
    expect(row.phone.length).toBeGreaterThan(0);
    expect(row.endS).toBeGreaterThan(row.startS);
    expect(row.expectedViseme.length).toBeGreaterThan(0);
    for (const mid of [row.mid.default, row.mid.mouthFront]) {
      if (!mid) continue;
      expect(mid.frame).toBeGreaterThanOrEqual(0);
      expect(mid.drivenTop.startsWith("viseme_")).toBe(true);
      expect(mid.drivenWeight).toBeGreaterThan(0);
      expect(mid.drivenWeight).toBeLessThanOrEqual(1);
      expect(mid.jawFraction).toBeGreaterThanOrEqual(0);
      expect(mid.upperTeethN).toBeGreaterThanOrEqual(0);
      expect(mid.lowerTeethN).toBeGreaterThanOrEqual(0);
    }
  }
  expect(report.checks.bilabial.pass + report.checks.bilabial.fail).toBeGreaterThan(0);
  expect(report.checks.labiodental.pass + report.checks.labiodental.fail).toBeGreaterThan(0);
  for (const [viseme, row] of Object.entries(report.checks.mismatchByViseme)) {
    expect(row.total).toBeGreaterThan(0);
    expect(row.match).toBeLessThanOrEqual(row.total);
    expect(viseme.length).toBeGreaterThan(0);
  }
  expect(report.coverage.phones.length).toBeGreaterThan(0);
  expect(report.coverage.visemesCovered.length).toBeGreaterThan(0);
}

function checkContact(clip: string): void {
  const file = path.join(REPORT_DIR, `${clip}.contact.png`);
  expect(existsSync(file), `missing contact sheet ${file}`).toBe(true);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(0);
}

describe("viseme-eval words tier", () => {
  it("parses words and stops at the phones tier", () => {
    const words = parseMfaWordsTier(TIER);
    expect(words.map((row) => row.word)).toEqual(["put", "fat", "think"]);
    expect(words[0]).toMatchObject({ startS: 0.2, endS: 0.61 });
  });
});

describe("viseme-eval reports", () => {
  it("validates the pangram report and contact sheet", () => {
    checkReport("pangram", "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.");
    checkContact("pangram");
  });

  it("validates the viseme-words report and contact sheet", () => {
    checkReport("viseme-words", "put. fat. think. tip. call. chair. sir. lot. red. car. bed. toe. book.");
    checkContact("viseme-words");
  });

  it("covers all 14 speaking visemes across the two clips", () => {
    const seen = new Set<string>();
    for (const clip of ["pangram", "viseme-words"]) {
      for (const viseme of loadReport(clip).coverage.visemesCovered) seen.add(viseme);
    }
    for (const viseme of ["PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"]) {
      expect(seen.has(viseme), `viseme ${viseme} uncovered`).toBe(true);
    }
  });
});
