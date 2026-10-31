import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_2c547dda8753bba0 h1: the station bakes the fitted face only when
 * the per-case opt-in is on; the identity gate records experiment rows.
 *
 * All heavy evidence comes from the tracked identity-report.json plus the
 * store files it names. No threshold is a literal here: every bound is read
 * from the report, whose thresholds cite their sources. M1 is marked
 * invalid_instrument (no threshold); M2 carries enforced/report-only status.
 */

/** Local repo-root walk: repo-root.js is entrypoint-reachable, so importing
 * it here would count against the test-internal-import ceiling. */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

type GateRow = {
  m1Mm: number;
  m2: number;
  glb: { path: string; sha256: string };
  flatRender: { path: string; sha256: string };
  m1MappingMaxMm: number;
};

type IdentityReport = {
  card: string;
  d5caveat: string;
  cases: Record<string, { rows: Record<string, GateRow> }>;
  thresholds: {
    m1: { status: string; reason?: string; mapMaxMm?: unknown; threshold?: number };
    m2: {
      status: string;
      knownGood: { value: number; source: string };
      knownBad: { value: number; source: string };
      margin: number;
      noise: number;
      noiseSource: string;
      threshold?: number;
      plainStatement?: string;
    };
  };
  defect: { defect: string; evidence: { sheet: string; panel: string }; suspectedWeights: string[]; verdict: string };
  experiments: Array<{
    case: string;
    fitbake: Array<{ run: string; glb: string; glbSha256: string; log: string; applied: Array<{ name: string; weight: number }>; logAppliedCount: number }>;
    nomouth: { run: string; glb: string; glbSha256: string; log: string; appliedCount: number; logAppliedCount: number };
  }>;
  verdicts: { g1: { status: string }; g2: { status: string }; g3: { pass: boolean } };
  sheets: Array<{ case: string; sheet: string; sha256: string }>;
};

function readIdentity(): IdentityReport {
  const root = testRepoRoot();
  return JSON.parse(
    readFileSync(join(root, "tools/openclinxr/evidence/face-fit/identity-report.json"), "utf8"),
  ) as IdentityReport;
}

function shaFile(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("the station bakes the fitted face", () => {
  it("(G1) M1 is either a verified topological measure or marked invalid_instrument with no threshold", () => {
    const report = readIdentity();
    const m1 = report.thresholds.m1;
    if (m1.status === "verified_topological") {
      const proof = m1 as { bijection?: { verified?: boolean; mapFile?: string } };
      expect(proof.bijection?.verified, "topological bijection verified on the pre-fix bake").toBe(true);
      expect(proof.bijection?.mapFile, "bijection map file named").toBeTruthy();
    } else {
      expect(m1.status, "M1 marked invalid_instrument").toBe("invalid_instrument");
      expect("threshold" in m1, "no threshold built on an invalid instrument").toBe(false);
      expect(String(m1.reason ?? ""), "reason recorded").toContain("map max");
      expect(report.verdicts.g1.status, "G1 verdict follows the instrument status").toBe("invalid_instrument");
    }
  });

  it("(G2) M2 status is enforced only when knownGood + noise < knownBad", () => {
    const report = readIdentity();
    const t = report.thresholds.m2;
    const separated = t.knownGood.value + t.noise < t.knownBad.value;
    expect(t.status, `M2 status matches separation (kg ${t.knownGood.value} + noise ${t.noise} vs kb ${t.knownBad.value})`).toBe(
      separated ? "enforced" : "report-only",
    );
    if (t.status === "enforced") {
      expect(t.threshold, "enforced threshold is the midpoint").toBeCloseTo(
        (t.knownGood.value + t.knownBad.value) / 2, 5,
      );
    } else {
      expect("threshold" in t, "report-only carries no threshold").toBe(false);
      expect(String(t.plainStatement ?? ""), "plain non-separation statement recorded").toContain("does not separate");
    }
    expect(report.verdicts.g2.status, "G2 verdict follows the M2 status").toBe(t.status);
  });

  it("(G3) aisha M2 verdict is recomputed from the report", () => {
    const report = readIdentity();
    const aisha = report.cases["aisha"]!.rows;
    expect(report.d5caveat, "D5 caveat carried").toContain("edit");
    const dM2 = aisha["fitbake"]!.m2 - aisha["pre"]!.m2;
    const noise = report.thresholds.m2.noise;
    expect(report.verdicts.g3.pass, `recorded G3 verdict matches recomputation (dM2 ${dM2})`).toBe(dM2 <= noise);
  });

  it("(G4) default runs carry NO FACE_TARGETS_APPLY while experiment rows do; opt-in stays off", () => {
    const root = testRepoRoot();
    const inputs = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/stations/face-realism/src/case-inputs.json"), "utf8"),
    ) as { cases: Record<string, { fit_bake?: { value?: unknown; source?: unknown } }> };
    for (const caseId of ["body2", "aisha"] as const) {
      expect(inputs.cases[caseId]?.fit_bake?.value, `${caseId} fit-bake opt-in stays off`).toBe(false);
      expect(String(inputs.cases[caseId]?.fit_bake?.source ?? ""), `${caseId} flag source names the card`).toContain(
        "tsk_2c547dda8753bba0",
      );
      for (const run of ["run1", "run2"]) {
        const logPath = `/Volumes/files/openclinxr-assets/store/face-station-cases/${caseId}/${run}/stage4-blender.log`;
        const log = readFileSync(logPath, "utf8");
        expect(log.includes("FACE_TARGETS_APPLY "), `${caseId} ${run} default bake has no fit`).toBe(false);
      }
    }
    const report = readIdentity();
    for (const exp of report.experiments) {
      for (const row of exp.fitbake) {
        const log = readFileSync(row.log, "utf8");
        const at = log.lastIndexOf("FACE_TARGETS_APPLY ");
        expect(at, `${exp.case} ${row.run} experiment bake proves the fit`).toBeGreaterThanOrEqual(0);
        const tail = log.slice(at + "FACE_TARGETS_APPLY ".length);
        const logged = JSON.parse(tail.slice(0, tail.indexOf("\n"))) as Record<string, number>;
        expect(Object.keys(logged).length, `${exp.case} ${row.run} log count equals applied[].length`).toBe(
          row.applied.length,
        );
        expect(row.logAppliedCount, `${exp.case} ${row.run} recorded count matches`).toBe(row.applied.length);
      }
      const nm = exp.nomouth;
      const nmLog = readFileSync(nm.log, "utf8");
      const nmAt = nmLog.lastIndexOf("FACE_TARGETS_APPLY ");
      expect(nmAt, `${exp.case} no-mouth bake proves its fit`).toBeGreaterThanOrEqual(0);
      const nmTail = nmLog.slice(nmAt + "FACE_TARGETS_APPLY ".length);
      const nmLogged = JSON.parse(nmTail.slice(0, nmTail.indexOf("\n"))) as Record<string, number>;
      expect(Object.keys(nmLogged).length, `${exp.case} no-mouth log count is 65`).toBe(65);
      expect(Object.keys(nmLogged).some((k) => k.startsWith("mouth-")), `${exp.case} no-mouth excludes mouth-*`).toBe(
        false,
      );
    }
  });

  it("(G5) counterweight: M1/M2 recompute from the named store files; thresholds come from the report", () => {
    const root = testRepoRoot();
    const gateScript = join(root, "tools/openclinxr/evidence/face-fit/identity_gate.py");
    const report = readIdentity();
    const rows: Array<{ caseId: string; side: string; row: GateRow }> = [];
    for (const caseId of ["body2", "aisha"] as const) {
      for (const side of ["pre", "fitbake", "nomouth"]) {
        rows.push({ caseId, side, row: report.cases[caseId]!.rows[side]! });
      }
    }
    for (const { caseId, side, row } of rows) {
      expect(existsSync(row.glb.path), `store GLB present: ${row.glb.path}`).toBe(true);
      expect(shaFile(row.glb.path), `${caseId} ${side} GLB sha recomputes`).toBe(row.glb.sha256);
      expect(existsSync(row.flatRender.path), `store flat render present`).toBe(true);
      expect(shaFile(row.flatRender.path), `${caseId} ${side} flat sha recomputes`).toBe(row.flatRender.sha256);
      const outTmp = join(os.tmpdir(), `.g5-recompute-${caseId}-${side}-${process.pid}.json`);
      const raw = execFileSync(
        "mise",
        ["exec", "-C", "/Volumes/files/src/openclinxr", "--", "python3", gateScript,
          "--case", caseId, "--glb", row.glb.path, "--flat-render", row.flatRender.path, "--out", outTmp],
        { encoding: "utf8", timeout: 600_000 },
      );
      expect(raw, `${caseId} ${side} gate recompute prints`).toContain("IDENTITY_GATE");
      const recomputed = JSON.parse(readFileSync(outTmp, "utf8")) as { m1Mm: number; m2: number };
      rmSync(outTmp, { force: true });
      // Deterministic recompute: epsilons cover report rounding only.
      expect(Math.abs(recomputed.m1Mm - row.m1Mm), `${caseId} ${side} M1 recomputes`).toBeLessThanOrEqual(0.001);
      expect(Math.abs(recomputed.m2 - row.m2), `${caseId} ${side} M2 recomputes`).toBeLessThanOrEqual(0.00002);
    }
    // No literal thresholds: status and bounds live in the report with sources.
    expect(report.thresholds.m1.status, "M1 status read from report").toBe("invalid_instrument");
    expect(["enforced", "report-only"], "M2 status read from report").toContain(report.thresholds.m2.status);
  }, 600_000);

  it("(defect) lower-lip wedge recorded with evidence, suspects, and a no-mouth experiment", () => {
    const report = readIdentity();
    const d = report.defect;
    expect(d.defect, "defect named").toBe("lower-lip wedge under fit bake");
    expect(d.verdict, "verdict cause_suspected").toBe("cause_suspected");
    expect(d.suspectedWeights.length, "suspected mouth weights listed").toBeGreaterThan(0);
    expect(d.suspectedWeights.every((w) => w.startsWith("mouth-")), "all suspects are mouth-*").toBe(true);
    const sheet = report.sheets.find((s) => s.case === "body2");
    expect(sheet, "body2 sheet recorded").toBeDefined();
    expect(existsSync(sheet!.sheet), "sheet file present").toBe(true);
    expect(shaFile(sheet!.sheet), "sheet sha recomputes").toBe(sheet!.sha256);
    for (const exp of report.experiments) {
      expect(exp.nomouth.appliedCount, `${exp.case} no-mouth applied count`).toBe(65);
    }
  });
});
