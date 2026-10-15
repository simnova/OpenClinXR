import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: every face-gate clause names an honest source. Spike C2-C6 were
 * unlabeled starting values (S/STATION-DESIGN.md:88-92); brief floors and the
 * 1.5x / 0.5 multipliers are unsourced, so every enforced C2-C6 threshold here
 * is a midpoint between one recorded known-good and one recorded known-bad on
 * the same metric. G10/G11 are inverted guards; G7 stays unbuilt.
 *
 * S = .openclinxr/realism-spike in worktree realism-95 (gitignored scratch).
 * Every number below cites its file; the sweep record lives beside this test.
 */

const DIR = import.meta.dirname;
const SOURCES = join(DIR, "clause-sources.json");
const SWEEP = join(DIR, "flat-vs-lit-sweep.json");
const V1 = join(DIR, "face_gate.py");
const V2 = join(DIR, "face_gate_v2.py");
const SELFTEST_V2 = join(DIR, "selftest_v2.py");

const EXPECTED_CLAUSES = [
  "C1", "C2", "C3", "C4", "C5", "C6",
  "G7", "G8", "G9", "G10", "G11", "P5",
];

type Row = {
  clause: string;
  threshold?: string;
  thresholds?: Record<string, number>;
  source: string;
  status: string;
  expression: string;
  known_good: { value: number | string; file: string } | null;
  known_bad: { value: number | string; file: string } | null;
  noise: { value: number | string; file: string } | null;
  margin: Record<string, number> | null;
};

function rows(): Row[] {
  return (JSON.parse(readFileSync(SOURCES, "utf8")) as { clauses: Row[] }).clauses;
}

function enforced(): Row[] {
  return rows().filter((c) => c.status === "enforced" || c.status.startsWith("enforced "));
}

describe("the face-gate clauses name their source (h1: midpoints, no brief floors)", () => {
  it("(1) the moved gate files live in this directory", () => {
    const files = readdirSync(DIR);
    for (const f of ["face_gate.py", "face_gate_v2.py", "clause-sources.json", "flat-vs-lit-sweep.json"]) {
      expect(
        files.includes(f),
        `${f} is missing from tools/openclinxr/evidence/face-gate. Restore it: face_gate.py + face_gate_v2.py move here from S/gate/, sweep + clause-sources are recorded here.`,
      ).toBe(true);
    }
  });

  it("(2) clause-sources.json has one row per clause and no empty source", () => {
    const ids = rows().map((c) => c.clause).sort();
    expect(
      ids,
      `clause set drifted to [${ids}]. Restoration: exactly [${[...EXPECTED_CLAUSES].sort()}] — no tint-patch, no lid-coverage, no decimation rows.`,
    ).toEqual([...EXPECTED_CLAUSES].sort());
    const empty = rows().filter((c) => !c.source || !c.source.trim() || !c.expression || !c.expression.trim());
    expect(
      empty.map((c) => c.clause),
      "empty source or expression is a fail. Restoration: record the source, or mark the row underived/report-only.",
    ).toEqual([]);
  });

  it("(3) every enforced row carries a good/bad-anchored expression, never a brief floor", () => {
    for (const r of enforced()) {
      expect(
        /good|bad|external/i.test(r.expression),
        `${r.clause} expression names no known-good/known-bad or cited external floor. Restoration: derive it as a midpoint separation (a) or cite the external floor (b).`,
      ).toBe(true);
      if (r.known_good !== null && r.known_bad !== null) {
        for (const anchor of [r.known_good.value, r.known_bad.value]) {
          for (const num of String(anchor).split("/").map((s) => s.trim())) {
            expect(
              r.expression.includes(num),
              `${r.clause} expression omits recorded anchor ${num}. Restoration: write the exact formula with the recorded good and bad numbers.`,
            ).toBe(true);
          }
        }
      }
      const text = `${r.source} ${r.expression} ${r.threshold ?? ""} ${r.status}`;
      expect(
        text.includes("brief_floor") || /STARTING/i.test(text),
        `${r.clause} still cites an unsourced brief floor or STARTING value. Restoration: replace with a good/bad midpoint or mark underived/report-only.`,
      ).toBe(false);
      expect(
        r.margin !== null,
        `${r.clause} has no margins. Restoration: record threshold-known_good and known_bad-threshold.`,
      ).toBe(true);
    }
  });

  it("(4) face_gate.py enforces exactly the sourced numbers, nothing unsourced", () => {
    const v1 = readFileSync(V1, "utf8");
    expect(v1.includes("brief_floor") || v1.includes("STARTING value from brief")).toBe(false);
    const want: Record<string, string> = {
      C1_de2000: "8.0", C2a_abstol: "0.895", C2b_abstol: "7.69", C3a_abstol: "5.16",
      C3b_abstol: "1.085", C3ratio_abstol: "0.0595", C4_abstol: "3.085",
      C5_abstol: "2.53", C6_frac: "0.42",
    };
    for (const [key, value] of Object.entries(want)) {
      const m = new RegExp(`"${key}":\\s*\\{"value":\\s*([\\d.]+)`).exec(v1);
      expect(
        m?.[1],
        `face_gate.py THRESHOLDS[${key}] missing. Restoration: re-add it with the clause-sources.json number.`,
      ).toBe(String(value));
    }
  });

  it("(5) report-only rows are not enforced by face_gate", () => {
    const v1 = readFileSync(V1, "utf8");
    for (const r of rows().filter((c) => c.status !== "enforced" && !c.status.startsWith("enforced "))) {
      expect(
        new RegExp(`"${r.clause}[_"]`).test(v1),
        `${r.clause} is ${r.status} but face_gate.py THRESHOLDS still enforces it. Restoration: remove it from THRESHOLDS and keep it as a displayed number only.`,
      ).toBe(false);
    }
  });

  it("(6) G10 inverted guard: vacuous as specified, report-only, code kept", () => {
    const g10 = rows().find((c) => c.clause === "G10")!;
    const g10text = `${g10.source} ${g10.expression}`;
    expect(/report-only|inverted/i.test(g10.status)).toBe(true);
    expect(/restoration|re-demote|promote only/i.test(g10text)).toBe(true);
    expect(readFileSync(V2, "utf8").includes("def g10_verdict")).toBe(true);
    expect(readFileSync(SELFTEST_V2, "utf8").includes("vacuous")).toBe(true);
  });

  it("(7) G11 inverted guard: fails its own source, report-only, code kept", () => {
    const g11 = rows().find((c) => c.clause === "G11")!;
    const g11text = `${g11.source} ${g11.expression}`;
    expect(/report-only|inverted/i.test(g11.status)).toBe(true);
    expect(/0\.62.*0\.78|fails its own source|re-demote/i.test(g11text)).toBe(true);
    expect(readFileSync(V2, "utf8").includes("def g11_compare")).toBe(true);
  });

  it("(8) G7 stays unbuilt and says so", () => {
    const g7 = rows().find((c) => c.clause === "G7")!;
    expect(/unbuilt/i.test(g7.status)).toBe(true);
    expect(/def g7|G7 implemented/i.test(readFileSync(V2, "utf8"))).toBe(false);
  });

  it("(9) COUNTERWEIGHT: this file still tests G10 and G11 (a deleted guard is a fail)", () => {
    const self = readFileSync(join(DIR, "the-face-gate-clauses-name-their-source.test.ts"), "utf8");
    for (const g of ["G10", "G11"]) {
      expect(
        self.includes(`"${g} inverted guard"`) || self.includes(g === "G10" ? "(6)" : "(7)"),
        `${g} guard test deleted from this file. Restoration: restore the ${g} inverted-guard case.`,
      ).toBe(true);
    }
  });
});
