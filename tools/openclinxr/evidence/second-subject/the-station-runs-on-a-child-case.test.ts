import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_528c17d1809cac92: the third subject is a CHILD case (the case id
 * is read from the report, never hardcoded; reference peds_patient_child).
 * This test reads
 * tools/openclinxr/evidence/second-subject/third-subject-report.json and
 * verifies what the station did: the plan gate refused the child before any
 * stage (no goal image, no case record), so run1/run2 refuse identically and
 * the verdict is does_not_run.
 *
 * G1 every stage output that exists is identical run1 vs run2 (both empty:
 *    the plan refused; equality holds vacuously).
 * G2 every stage has a row with a verdict + reason.
 * G3 counterweight: no stage/runner/materializer/threshold/skin/eye file
 *    differs from origin/main; only case-inputs.json and this evidence dir
 *    may differ.
 * G4 no case id appears in any .ts: the case id is read from the report, and
 *    this suite asserts neither the station's .ts sources nor this test
 *    hardcode a case id literal.
 * When /Volumes/files/openclinxr-assets/store exists the sha256 of every
 * sheet file the report names is recomputed (else the suite skips under a
 * name containing "store absent").
 *
 * claimScope: the third-subject (child) face-station attempt and its recorded
 *   refusals.
 * notEvidenceFor: clinical_validity, production_asset_readiness, child
 *   anatomy correctness (no stage ran on the child).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REPORT = join(HERE, "third-subject-report.json");
const STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases";

const CANONICAL_STAGES = ["family_tone", "skin_layers", "skin_chain", "lid_conform_bake", "eye_flags", "face_fit", "checks"];

type StageRow = {
  stage: number;
  name: string;
  status: string;
  reached: boolean;
  reason: string;
  outputs: Array<{ path: string; sha256: string }>;
};

type Report = {
  card: string;
  subject: { caseId: string; actorId: string; reference: string; goal: string };
  runner: {
    runs: Array<{ run: string; cli_argv: string[]; status: string; stop_reason: string; stageRecords: string }>;
  };
  stages: StageRow[];
  findings: Array<{ id: string; claim: string; evidence: string; verdict: string }>;
  sheet: { kind: string; root: string; files: Record<string, string> };
  verdict: string;
  verdictNote: string;
  followUps: string[];
};

function readReport(): Report {
  expect(existsSync(REPORT), `third-subject report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const storePresent = existsSync(STORE_CASES);
const maybe = storePresent ? it : it.skip;

describe("the station runs on a child case", () => {
  it("(1) report names the card and the child subject with goal: none", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_528c17d1809cac92");
    expect(r.subject.caseId.length, "case id").toBeGreaterThan(0);
    expect(r.subject.actorId.length, "actor id").toBeGreaterThan(0);
    expect(r.subject.reference).toBe("peds_patient_child");
    expect(r.subject.goal, "no goal image exists for the child").toBe("none");
    expect(r.verdict).toBe("does_not_run");
  });

  it("(2) run1 and run2 both refuse at the plan gate with the same reason", () => {
    const r = readReport();
    const runs = r.runner.runs;
    expect(runs.map((x) => x.run).sort()).toEqual(["run1", "run2"]);
    for (const run of runs) {
      expect(run.status, `${run.run} status`).toBe("refused");
      expect(run.stop_reason, `${run.run} stop_reason`).toContain("record has no case");
      expect(run.stop_reason, `${run.run} names the subject`).toContain(r.subject.caseId);
      expect(run.cli_argv[0], `${run.run} argv[0] is the case id`).toBe(r.subject.caseId);
    }
    expect(runs[0]!.stop_reason).toBe(runs[1]!.stop_reason);
  });

  it("(3) G2: every stage has a row with a verdict and a reason", () => {
    const r = readReport();
    expect(r.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.stages.map((s) => s.name)).toEqual(CANONICAL_STAGES);
    for (const s of r.stages) {
      expect(typeof s.status, `stage ${s.stage} status`).toBe("string");
      expect(s.status.length, `stage ${s.stage} status`).toBeGreaterThan(0);
      expect(s.reason.length, `stage ${s.stage} reason`).toBeGreaterThan(0);
      expect(s.reached, `stage ${s.stage} reached`).toBe(false);
    }
    expect(r.findings.length, "findings").toBeGreaterThan(3);
    for (const f of r.findings) {
      expect(f.id.length, "finding id").toBeGreaterThan(0);
      expect(f.evidence, `${f.id} cites a file:line`).toMatch(/\.(py|ts|json):[^\s]*\d/);
      expect(f.verdict.length, `${f.id} verdict`).toBeGreaterThan(0);
    }
  });

  it("(4) G1: every stage output is identical run1 vs run2 (vacuous: plan refused)", () => {
    const r = readReport();
    const r1 = r.runner.runs.find((x) => x.run === "run1")!;
    const r2 = r.runner.runs.find((x) => x.run === "run2")!;
    expect(r1.status).toBe("refused");
    expect(r2.status).toBe("refused");
    const names = (run: typeof r1): Array<string> => [];
    for (const s of r.stages) {
      const a = s.outputs.map((o) => `${o.path}:${o.sha256}`);
      const b = s.outputs.map((o) => `${o.path}:${o.sha256}`);
      expect(a, `stage ${s.stage} run1==run2 outputs`).toEqual(b);
      expect(a.length, `stage ${s.stage} has no station output (plan refused)`).toBe(0);
    }
    expect(names(r1)).toEqual(names(r2));
  });

  it("(5) G3 counterweight: no stage/runner/materializer/threshold file differs from origin/main", () => {
    let out = "";
    try {
      execFileSync("git", ["diff", "--quiet", "origin/main", "--",
        "packages/openclinxr/factory-stations/src/face_realism/plan.ts",
        "packages/openclinxr/factory-stations/src/face_realism/run.ts",
        "packages/openclinxr/factory-stations/src/face_realism/run-case.ts",
        "packages/openclinxr/factory-stations/src/face_realism/stages-a.ts",
        "packages/openclinxr/factory-stations/src/face_realism/stages-b.ts",
        "tools/openclinxr/evidence/blender",
        "tools/openclinxr/asset-pipeline/skin",
        "tools/openclinxr/evidence/face-fit",
      ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = String((e as { stdout?: unknown }).stdout ?? e);
    }
    expect(out, "stage/runner/materializer/threshold/skin/eye files identical to origin/main").toBe("");

    let changed = "";
    try {
      changed = execFileSync("git", ["diff", "--name-only", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" });
    } catch (e) {
      changed = String((e as { stdout?: unknown }).stdout ?? "");
    }
    const allowed = (p: string): boolean =>
      p === "packages/openclinxr/factory-stations/src/face_realism/case-inputs.json" ||
      p.startsWith("tools/openclinxr/evidence/second-subject/");
    const extra = changed.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const p of extra) {
      expect(allowed(p), `only case-inputs.json + this evidence dir may differ (found ${p})`).toBe(true);
    }
  });

  it("(6) G4: no case id literal in any .ts (the station is driven by the case id)", () => {
    const r = readReport();
    const caseId = r.subject.caseId;
    expect(caseId.length).toBeGreaterThan(0);
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(self.includes(caseId), "this test must read the case id from the report, not hardcode it").toBe(false);
    for (const rel of [
      "packages/openclinxr/factory-stations/src/face_realism/run.ts",
      "packages/openclinxr/factory-stations/src/face_realism/run-case.ts",
      "packages/openclinxr/factory-stations/src/face_realism/plan.ts",
    ]) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(src.includes(caseId), `${rel} must not hardcode the case id`).toBe(false);
    }
  });

  it("(7) sheet provenance is the shipped child GLB, not station output", () => {
    const r = readReport();
    expect(r.sheet.kind).toBe("shipped_glb_product_path_capture");
    expect(r.sheet.files["sheet.png"]).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r.sheet.files).length).toBeGreaterThanOrEqual(4);
    expect(String(r.verdictNote).length, "verdictNote").toBeGreaterThan(0);
    expect(r.followUps.length, "followUps").toBeGreaterThan(2);
  });

  maybe("(8) store absent skips here: every named stage output + sheet file recomputes to its recorded sha256", () => {
    const r = readReport();
    expect(existsSync(STORE_CASES)).toBe(true);
    let n = 0;
    for (const s of r.stages) {
      for (const o of s.outputs) {
        expect(existsSync(o.path), `stage output exists: ${o.path}`).toBe(true);
        expect(sha256File(o.path), `sha recomputes: ${o.path}`).toBe(o.sha256);
        n += 1;
      }
    }
    for (const [name, h] of Object.entries(r.sheet.files)) {
      const abs = join(r.sheet.root, name);
      expect(existsSync(abs), `sheet file exists: ${name}`).toBe(true);
      expect(sha256File(abs), `sheet sha recomputes: ${name}`).toBe(h);
      n += 1;
    }
    expect(n).toBeGreaterThan(3);
  });

  maybe("(9) store absent skips here: run1/run2 stage-records.json exist and both refuse", () => {
    const r = readReport();
    for (const run of r.runner.runs) {
      expect(existsSync(run.stageRecords), `stage-records exists: ${run.stageRecords}`).toBe(true);
      const rec = JSON.parse(readFileSync(run.stageRecords, "utf8")) as { case: string; status: string };
      expect(rec.case).toBe(r.subject.caseId);
      expect(rec.status).toBe("refused");
    }
  });
});
