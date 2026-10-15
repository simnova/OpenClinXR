import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: every face-gate clause names its source, and no gate is tracked
 * without one. Spike clauses C2-C6 were unlabeled starting values
 * (S/STATION-DESIGN.md:88-92); C2-C6 are re-derived here from the recorded
 * flat-versus-lit sweep in this directory, G10/G11 are inverted guards, and
 * G7 stays unbuilt.
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

function sourcesJson(): {
  clauses: { clause: string; threshold?: string; source: string; status: string }[];
} {
  return JSON.parse(readFileSync(SOURCES, "utf8"));
}

describe("the face-gate clauses name their source", () => {
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
    const { clauses } = sourcesJson();
    const ids = clauses.map((c) => c.clause).sort();
    expect(
      ids,
      `clause set drifted to [${ids}]. Restoration: exactly [${[...EXPECTED_CLAUSES].sort()}] — one row per clause, no tint-patch, no lid-coverage, no decimation rows.`,
    ).toEqual([...EXPECTED_CLAUSES].sort());
    const empty = clauses.filter((c) => !c.source || !c.source.trim());
    expect(
      empty.map((c) => c.clause),
      "empty source is a fail. Restoration: give the clause a recorded source or mark it underived/report-only.",
    ).toEqual([]);
  });

  it("(3) C2-C6 thresholds are re-derived from the recorded sweep, not brief starts", () => {
    const { clauses } = sourcesJson();
    for (const id of ["C2", "C3", "C4", "C5", "C6"]) {
      const row = clauses.find((c) => c.clause === id)!;
      expect(
        /1\.5\*|chain_input|external/i.test(row.source),
        `${id} source names no independent reference. Restoration: write the expression as max(brief_floor, 1.5*noise) from flat-vs-lit-sweep.json or frac*chain_input.`,
      ).toBe(true);
    }
    const v1 = readFileSync(V1, "utf8");
    expect(
      v1.includes("STARTING value from brief"),
      "face_gate.py still carries unlabeled STARTING values. Restoration: re-derive C2-C6 in THRESHOLDS from flat-vs-lit-sweep.json and cite the expression.",
    ).toBe(false);
    expect(
      v1.includes('"C2b_abstol": {"value": 6.24'),
      "face_gate.py C2b is not the re-derived 6.24 = max(5.0, 1.5*4.16). Restoration: apply the sweep derivation (flat L-spread noise 4.16).",
    ).toBe(true);
    const sweep = JSON.parse(readFileSync(SWEEP, "utf8"));
    expect(sweep.rows.length).toBeGreaterThan(0);
  });

  it("(4) G10 inverted guard: vacuous as specified, report-only, code kept", () => {
    const { clauses } = sourcesJson();
    const g10 = clauses.find((c) => c.clause === "G10")!;
    expect(
      /report-only|inverted/i.test(g10.status),
      "G10 is not demoted. Restoration: re-demote G10 to report-only (inverted guard) per S/gate/RESULT-v2.md:9 — target sclera rims pass every render.",
    ).toBe(true);
    expect(
      /restoration|re-demote|promote only/i.test(g10.source),
      "G10 source names no restoration. Restoration: state the promotion bar (no-makeup eye reference or absolute rim cap).",
    ).toBe(true);
    expect(
      readFileSync(V2, "utf8").includes("def g10_verdict"),
      "G10 implementation deleted. Restoration: restore g10_verdict in face_gate_v2.py — demote, never delete.",
    ).toBe(true);
    expect(
      readFileSync(SELFTEST_V2, "utf8").includes("vacuous"),
      "G10 vacuous selftest deleted. Restoration: restore the G10 vacuous-as-specified record in selftest_v2.py.",
    ).toBe(true);
  });

  it("(5) G11 inverted guard: fails its own source, report-only, code kept", () => {
    const { clauses } = sourcesJson();
    const g11 = clauses.find((c) => c.clause === "G11")!;
    expect(
      /report-only|inverted/i.test(g11.status),
      "G11 is not demoted. Restoration: re-demote G11 to report-only (inverted guard) per S/gate/RESULT-v2.md:10 — source 0.62 < thr 0.78.",
    ).toBe(true);
    expect(
      /0\.62.*0\.78|fails its own source|re-demote/i.test(g11.source),
      "G11 source does not record the self-failure. Restoration: record source 0.62 < thr 0.78 and the re-demotion rule.",
    ).toBe(true);
    expect(
      readFileSync(V2, "utf8").includes("def g11_compare"),
      "G11 implementation deleted. Restoration: restore g11_compare in face_gate_v2.py — demote, never delete.",
    ).toBe(true);
  });

  it("(6) G7 stays unbuilt and says so", () => {
    const { clauses } = sourcesJson();
    const g7 = clauses.find((c) => c.clause === "G7")!;
    expect(
      /unbuilt/i.test(g7.status),
      "G7 claims a build. Restoration: mark G7 unbuilt — it needs lip vertex ids + camera (S/gate/RESULT-v2.md:8).",
    ).toBe(true);
    const v2 = readFileSync(V2, "utf8");
    expect(
      /def g7|G7 implemented/i.test(v2),
      "G7 must stay unbuilt in this slice. Restoration: remove the G7 implementation or move it behind its own card.",
    ).toBe(false);
  });

  it("(7) COUNTERWEIGHT: this file still tests G10 and G11 (a deleted guard is a fail)", () => {
    const self = readFileSync(join(DIR, "the-face-gate-clauses-name-their-source.test.ts"), "utf8");
    for (const g of ["G10", "G11"]) {
      expect(
        self.includes(`"${g} inverted guard"`) || self.includes(`(${g === "G10" ? "4" : "5"})`),
        `${g} guard test deleted from this file. Restoration: restore the ${g} inverted-guard case — an absent guard reads green having measured nothing.`,
      ).toBe(true);
    }
  });
});
