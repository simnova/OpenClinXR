import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: every face-gate clause names an honest source, and no enforced
 * threshold has less margin than run-to-run noise. Spike C2-C6 were unlabeled
 * starting values (S/STATION-DESIGN.md:88-92); brief floors and the 1.5x / 0.5
 * multipliers are unsourced, so enforced C2-C6 thresholds are midpoints
 * between one recorded known-good and one recorded known-bad — and a midpoint
 * whose min margin is below measured noise is report-only, not enforced.
 * G10/G11 are inverted guards; G7 stays unbuilt.
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

/** Midpoint-derived arms: the noise-margin rule applies to each of these. */
const MIDPOINT_ARMS = ["C2a", "C2b", "C3a", "C3b", "C3ratio", "C4", "C5", "C6"];

type Num = { value: number | string; file: string };
type Row = {
  clause: string;
  threshold?: string;
  thresholds?: Record<string, number>;
  source: string;
  status: string;
  expression: string;
  derivation: string;
  known_good: Num | null;
  known_bad: Num | null;
  noise: Num | null;
  margin: Record<string, number> | null;
  noise_margin_ratio: number | string | Record<string, number | string> | null;
  report_only_arms?: string[];
};

function rows(): Row[] {
  return (JSON.parse(readFileSync(SOURCES, "utf8")) as { clauses: Row[] }).clauses;
}

function enforced(): Row[] {
  return rows().filter((c) => c.status === "enforced" || c.status.startsWith("enforced "));
}

/** ratio >= 1, or infinite where measured noise is exactly zero. */
function ratioClears(ratio: number | string | null, noiseValue: number | string | null): boolean {
  if (typeof ratio === "number") return ratio >= 1;
  if (typeof ratio === "string") return ratio.startsWith("+inf") && noiseValue === 0;
  return false;
}

describe("the face-gate clauses name their source (h2: margin must clear noise)", () => {
  it("(1) the moved gate files live in this directory", () => {
    const files = readdirSync(DIR);
    for (const f of ["face_gate.py", "face_gate_v2.py", "clause-sources.json", "flat-vs-lit-sweep.json"]) {
      expect(
        files.includes(f),
        `${f} is missing from tools/openclinxr/evidence/face-gate. Restoration: face_gate.py + face_gate_v2.py move here from S/gate/, sweep + clause-sources are recorded here.`,
      ).toBe(true);
    }
  });

  it("(2) clause-sources.json has one row per clause and no empty source", () => {
    const ids = rows().map((c) => c.clause).sort();
    expect(
      ids,
      `clause set drifted to [${ids}]. Restoration: exactly [${[...EXPECTED_CLAUSES].sort()}].`,
    ).toEqual([...EXPECTED_CLAUSES].sort());
    const empty = rows().filter((c) => !c.source?.trim() || !c.expression?.trim() || !c.derivation?.trim());
    expect(
      empty.map((c) => c.clause),
      "empty source, expression or derivation is a fail. Restoration: record it, or mark the row underived/report-only.",
    ).toEqual([]);
    const noRatio = rows().filter((c) => !("noise_margin_ratio" in c));
    expect(
      noRatio.map((c) => c.clause),
      "missing noise_margin_ratio is a fail. Restoration: record min(margin)/noise on every row (null only with a stated reason).",
    ).toEqual([]);
  });

  it("(3) every enforced row carries a good/bad-anchored expression, never a brief floor", () => {
    for (const r of enforced()) {
      expect(
        /good|bad|external/i.test(r.expression),
        `${r.clause} expression names no known-good/known-bad or cited external floor. Restoration: midpoint separation (a) or cited floor (b).`,
      ).toBe(true);
      if (r.known_good !== null && r.known_bad !== null) {
        for (const anchor of [r.known_good.value, r.known_bad.value]) {
          for (const num of String(anchor).split("/").map((s) => s.trim())) {
            expect(
              r.expression.includes(num),
              `${r.clause} expression omits recorded anchor ${num}. Restoration: write the exact formula with the recorded numbers.`,
            ).toBe(true);
          }
        }
      }
      const text = `${r.source} ${r.expression} ${r.threshold ?? ""} ${r.status}`;
      expect(
        text.includes("brief_floor") || /STARTING/i.test(text),
        `${r.clause} still cites an unsourced brief floor or STARTING value. Restoration: midpoint, cited floor, or report-only.`,
      ).toBe(false);
      expect(r.margin !== null, `${r.clause} has no margins. Restoration: record threshold-known_good and known_bad-threshold.`).toBe(true);
    }
  });

  it("(4) enforced midpoint arms clear noise; sub-noise arms are report-only", () => {
    for (const r of rows()) {
      const ratios = r.noise_margin_ratio;
      if (ratios === null || typeof ratios !== "object") continue;
      for (const [arm, ratio] of Object.entries(ratios)) {
        if (!MIDPOINT_ARMS.includes(arm)) continue;
        const parked = (r.report_only_arms ?? []).includes(arm);
        const noiseVal = r.noise === null ? null : Number(String(r.noise.value).split("/")[arm === "C2a" ? 0 : arm === "C2b" ? 1 : 0]);
        if (parked) {
          expect(
            !ratioClears(ratio, typeof ratio === "string" ? 0 : (noiseVal ?? NaN)),
            `${r.clause}.${arm} is parked report-only but clears noise. Restoration: enforce it or correct the ratio.`,
          ).toBe(true);
        } else {
          const clears = typeof ratio === "number"
            ? ratio >= 1
            : typeof ratio === "string" && ratio.startsWith("+inf");
          expect(
            clears,
            `${r.clause}.${arm} enforced with ratio ${ratio} < 1. Restoration: report-only + gate it out of face_gate.py.`,
          ).toBe(true);
        }
      }
    }
    const c4 = rows().find((c) => c.clause === "C4")!;
    expect(c4.status.startsWith("report-only")).toBe(true);
    expect(c4.noise_margin_ratio).toBe(0.7);
    const c2 = rows().find((c) => c.clause === "C2")!;
    expect(c2.report_only_arms).toEqual(["C2a"]);
  });

  it("(5) C6 noise is measured run-to-run, not the target value", () => {
    const c6 = rows().find((c) => c.clause === "C6")!;
    expect(typeof c6.noise?.value === "number", "C6 noise must be a measured number, not a target property.").toBe(true);
    expect(c6.noise!.value, "C6 noise must be the measured run-to-run value 0.0, not v_target 0.235.").toBe(0);
    expect(/repeat|run-to-run|determinism/i.test(c6.noise!.file)).toBe(true);
    const sweep = JSON.parse(readFileSync(SWEEP, "utf8")) as { rows: { clause: string; noise?: number }[] };
    const det = sweep.rows.find((x) => x.clause === "C6.run_to_run_v");
    expect(det?.noise, "sweep artifact must record the C6 determinism measurement.").toBe(0);
  });

  it("(6) face_gate.py enforces exactly the sourced numbers, nothing below noise", () => {
    const v1 = readFileSync(V1, "utf8");
    expect(v1.includes("brief_floor") || v1.includes("STARTING value from brief")).toBe(false);
    const want: Record<string, string> = {
      C1_de2000: "8.0", C2a_abstol: "0.895", C2b_abstol: "7.69", C3a_abstol: "5.16",
      C3b_abstol: "1.085", C3ratio_abstol: "0.0595", C4_abstol: "3.085",
      C5_abstol: "2.53", C6_frac: "0.42",
    };
    for (const [key, value] of Object.entries(want)) {
      const m = new RegExp(`"${key}":\\s*\\{"value":\\s*([\\d.]+)`).exec(v1);
      expect(m?.[1], `face_gate.py THRESHOLDS[${key}] missing or drifted.`).toBe(value);
    }
    expect(
      v1.includes('"C2a_abstol", "C4_abstol"'),
      "REPORT_ONLY set must name exactly the sub-noise arms. Restoration: REPORT_ONLY = C2a + C4.",
    ).toBe(true);
    expect(v1.includes('"pass": bool(c2b["pass"])')).toBe(true);
    expect(v1.includes('for k in ["C1", "C2", "C3", "C5"]')).toBe(true);
    expect(/REPORT_ONLY[^)]*C6/.test(v1), "C6 clears noise and must stay enforced.").toBe(false);
  });

  it("(7) report-only rows are not enforced by face_gate", () => {
    const v1 = readFileSync(V1, "utf8");
    for (const id of ["G10", "G11", "G7"]) {
      expect(
        new RegExp(`"${id}[_"]`).test(v1),
        `${id} is not enforced but face_gate.py THRESHOLDS names it. Restoration: display only.`,
      ).toBe(false);
    }
    // C2a/C4 keep displayed numbers in THRESHOLDS and are gated out instead.
    for (const key of ["C2a_abstol", "C4_abstol"]) {
      expect(
        v1.includes(`"${key}"`) && v1.includes("REPORT_ONLY"),
        `${key} must stay displayed AND gated out. Restoration: keep the number, name it in REPORT_ONLY.`,
      ).toBe(true);
    }
  });

  it("(8) G10 inverted guard: vacuous as specified, report-only, code kept", () => {
    const g10 = rows().find((c) => c.clause === "G10")!;
    const text = `${g10.source} ${g10.expression}`;
    expect(/report-only|inverted/i.test(g10.status)).toBe(true);
    expect(/restoration|re-demote|promote only/i.test(text)).toBe(true);
    expect(readFileSync(V2, "utf8").includes("def g10_verdict")).toBe(true);
    expect(readFileSync(SELFTEST_V2, "utf8").includes("vacuous")).toBe(true);
  });

  it("(9) G11 inverted guard: fails its own source, report-only, code kept", () => {
    const g11 = rows().find((c) => c.clause === "G11")!;
    const text = `${g11.source} ${g11.expression}`;
    expect(/report-only|inverted/i.test(g11.status)).toBe(true);
    expect(/0\.62.*0\.78|fails its own source|re-demote/i.test(text)).toBe(true);
    expect(readFileSync(V2, "utf8").includes("def g11_compare")).toBe(true);
  });

  it("(10) G7 stays unbuilt and says so", () => {
    const g7 = rows().find((c) => c.clause === "G7")!;
    expect(/unbuilt/i.test(g7.status)).toBe(true);
    expect(/def g7|G7 implemented/i.test(readFileSync(V2, "utf8"))).toBe(false);
  });

  it("(11) COUNTERWEIGHT: this file still tests G10 and G11 (a deleted guard is a fail)", () => {
    const self = readFileSync(join(DIR, "the-face-gate-clauses-name-their-source.test.ts"), "utf8");
    for (const g of ["G10", "G11"]) {
      expect(
        self.includes(`"${g} inverted guard"`) || self.includes(g === "G10" ? "(8)" : "(9)"),
        `${g} guard test deleted from this file. Restoration: restore the ${g} inverted-guard case.`,
      ).toBe(true);
    }
  });
});
