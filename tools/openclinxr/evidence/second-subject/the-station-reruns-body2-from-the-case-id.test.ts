import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_7ba4b2efbcb3e20e (R3): the face station reruns body2 from its
 * case id through run-case.ts after the skin and eye fixes, plus the aisha
 * counter-subject.
 *
 * Reads tools/openclinxr/evidence/second-subject/second-subject-r3-report.json:
 * G1 every r3 stage ran from run-case.ts for both cases, run1/run2 output
 * shas equal per stage (stage-4 GLB bytes may differ: the per-mesh POSITION
 * sha fallback the runner records is the comparator); G2 tuned_for_subject[]
 * recorded (expected empty; each entry carries stage+file:line+value_needed);
 * G3 counterweight (no file under face-gate/, face-shape-clauses/,
 * lid-conform/, skin/, face_realism/case-inputs.json differs from
 * origin/main); G4 every check has a result row per subject
 * {value, threshold, pass|fail|blocked, reason}.
 * When /Volumes/files/openclinxr-assets/store/face-station-cases exists, the
 * sha256 of every r3 store output the report names is recomputed (else the
 * suite skips under a name containing "store absent").
 * r1/r2 tests and reports are unchanged.
 *
 * claimScope: the r3 station rerun and its recorded gates/checks.
 * notEvidenceFor: clinical_validity, production_asset_readiness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "second-subject-r3-report.json");
const STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases";
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";

type StageRow = {
  stage: number;
  name: string;
  script: string;
  argv: unknown[];
  ran: boolean;
  blocked: boolean;
  gate: { pass: boolean; detail: string };
  outputs: Array<{ name: string; path: string; sha256: string }>;
};

type RunRow = {
  cli_argv: string[];
  cli_run: string;
  storeDir: string;
  status: string;
  stages: StageRow[];
};

type CheckRow = {
  subject: string;
  value: number | string | null;
  threshold: number | string | null;
  threshold_source: string;
  result: string;
  reason: string;
};

type Report = {
  card: string;
  body2: { case_id: string; runs: Record<string, RunRow> };
  aisha: { case_id: string; runs: Record<string, RunRow> };
  tuned_for_subject: Array<{ stage: number; file: string; what: string; value_needed: string; why: string }>;
  repeatability: Record<string, { byteIdenticalStages: number[]; stage4BytesEqual: boolean; stage4Run1VsRun2PositionEqual: boolean }>;
  checks: CheckRow[];
  r2_vs_r3: Array<{ check: string; delta: string }>;
  coverage: Array<{ bucket: string; difference: string; evidence: string }>;
  sheet: { root: string; files: Record<string, string> };
  verdict: string;
  verdictNote: string;
  followUps: string[];
  orchestratorGrade: { sheet: string; sha256: string; body2: string[]; aisha: string[] };
};

function readReport(): Report {
  expect(existsSync(REPORT), `r3 report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function caseRuns(r: Report, c: "body2" | "aisha"): Record<string, RunRow> {
  return r[c].runs;
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const storePresent = existsSync(STORE_CASES);
const maybe = storePresent ? it : it.skip;

describe("the station reruns body2 from the case id (r3)", () => {
  it("(1) report names the card and both cases with two runs each", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_7ba4b2efbcb3e20e");
    for (const c of ["body2", "aisha"] as const) {
      expect(Object.keys(caseRuns(r, c)).sort()).toEqual(["r3-run1", "r3-run2"]);
    }
    expect(r.verdict).toBe("repeatable_with_0_tunings");
  });

  it("(2) G1: all 7 stages ran from run-case.ts; run1/run2 shas equal (stage-4 POSITION fallback)", () => {
    const r = readReport();
    for (const c of ["body2", "aisha"] as const) {
      const runs = caseRuns(r, c);
      for (const run of ["r3-run1", "r3-run2"]) {
        const row = runs[run]!;
        expect(row.cli_argv, `${c}/${run} cli argv`).toEqual([c]);
        expect(row.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        for (const s of row.stages) {
          expect(s.ran, `${c}/${run} stage ${s.stage} ran`).toBe(true);
          expect(s.script.length, `${c}/${run} stage ${s.stage} script`).toBeGreaterThan(0);
        }
      }
      const o1 = new Map(runs["r3-run1"]!.stages.flatMap((s) => s.outputs.map((o) => [`${s.stage}/${o.name}`, o.sha256] as const)));
      const o2 = new Map(runs["r3-run2"]!.stages.flatMap((s) => s.outputs.map((o) => [`${s.stage}/${o.name}`, o.sha256] as const)));
      for (const [key, h1] of o1) {
        expect(h1, `${c} ${key} sha`).toMatch(/^[0-9a-f]{64}$/);
        if (key.startsWith("4/") && (key.endsWith(".glb") || key.endsWith(".log"))) continue;
        expect(o2.get(key), `${c} ${key} run1==run2`).toBe(h1);
      }
      const rep = r.repeatability[c]!;
      expect(rep.stage4Run1VsRun2PositionEqual, `${c} stage-4 run1==run2 POSITION`).toBe(true);
    }
  });

  it("(3) G2: tuned_for_subject[] recorded (expected empty; entries carry stage+file:line+value_needed)", () => {
    const r = readReport();
    expect(Array.isArray(r.tuned_for_subject)).toBe(true);
    expect(r.tuned_for_subject.length).toBe(0);
    for (const t of r.tuned_for_subject) {
      expect(typeof t.stage, "stage").toBe("number");
      expect(t.file, "file:line").toMatch(/\.(py|ts):\d+(-\d+)?$/);
      expect(t.what.length, "what").toBeGreaterThan(0);
      expect(t.value_needed.length, "value_needed").toBeGreaterThan(0);
      expect(t.why.length, "why").toBeGreaterThan(0);
    }
  });

  it("(4) G3 counterweight: no threshold/case-input file differs from origin/main", () => {
    let out = "";
    try {
      execFileSync("git", ["diff", "--quiet", "origin/main", "--",
        "tools/openclinxr/evidence/face-gate",
        "tools/openclinxr/evidence/face-shape-clauses",
        "tools/openclinxr/asset-pipeline/realism-head/lid-conform",
        "tools/openclinxr/asset-pipeline/skin",
        "packages/openclinxr/factory-stations/src/face_realism/case-inputs.json",
      ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = String((e as { stdout?: unknown }).stdout ?? e);
    }
    expect(out, "threshold dirs + case-inputs identical to origin/main").toBe("");
  });

  it("(5) G4: every check has a result row per subject with value, threshold, verdict, reason", () => {
    const r = readReport();
    expect(r.checks.length).toBeGreaterThan(0);
    for (const s of ["body2", "aisha"]) {
      const rows = r.checks.filter((c) => c.subject === s);
      expect(rows.length, `${s} check rows`).toBeGreaterThan(5);
      for (const c of rows) {
        expect(["pass", "fail", "blocked", "report-only"].includes(c.result), `${s} result enum`).toBe(true);
        expect(String(c.threshold_source).length, "threshold source cites its file").toBeGreaterThan(0);
        expect(String(c.reason).length, "reason").toBeGreaterThan(0);
      }
    }
    expect(r.r2_vs_r3.length, "r2-vs-r3 deltas").toBeGreaterThan(5);
    expect(r.coverage.length, "coverage rows").toBeGreaterThan(3);
    for (const cov of r.coverage) {
      expect(cov.bucket).toMatch(/^(\([a-e]\)|fixed)/);
    }
    expect(r.verdict).toBe("repeatable_with_0_tunings");
    expect(String(r.verdictNote).length, "verdictNote").toBeGreaterThan(0);
    expect(Array.isArray(r.followUps) && r.followUps.length, "followUps").toBeGreaterThan(0);
  });

  it("(5b) H1: orchestratorGrade exists with the sheet sha of the file on disk", () => {
    const r = readReport();
    const g = r.orchestratorGrade;
    expect(g.body2.length).toBeGreaterThan(0);
    expect(g.aisha.length).toBeGreaterThan(0);
    expect(g.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(g.sha256).toBe(r.sheet.files["sheet-front-3col.png"]);
    if (storePresent) {
      const abs = join(r.sheet.root, "sheet-front-3col.png");
      expect(existsSync(abs), "grade sheet exists").toBe(true);
      expect(sha256File(abs), "grade sheet sha recomputes").toBe(g.sha256);
    }
  });

  maybe("(6) store absent skips here: every named r3 store output recomputes to its recorded sha256", () => {
    const r = readReport();
    expect(existsSync(STORE_CASES)).toBe(true);
    let n = 0;
    for (const c of ["body2", "aisha"] as const) {
      for (const run of ["r3-run1", "r3-run2"]) {
        for (const s of caseRuns(r, c)[run]!.stages) {
          for (const o of s.outputs) {
            const rel = String(o.path).replace(/^assets:/, "");
            const abs = join(STORE_ROOT, rel);
            expect(existsSync(abs), `store file exists: ${rel}`).toBe(true);
            expect(sha256File(abs), `sha recomputes: ${rel}`).toBe(o.sha256);
            n += 1;
          }
        }
      }
    }
    for (const [name, h] of Object.entries(r.sheet.files)) {
      const abs = join(r.sheet.root, name);
      expect(existsSync(abs), `sheet file exists: ${name}`).toBe(true);
      expect(sha256File(abs), `sheet sha recomputes: ${name}`).toBe(h);
      n += 1;
    }
    expect(n).toBeGreaterThan(40);
  });
});

describe("r1 and r2 records are unchanged", () => {
  it("r1/r2 reports and tests still exist", () => {
    for (const f of ["second-subject-report.json", "second-subject-r2-report.json",
      "the-station-runs-on-a-second-subject-without-tuning.test.ts",
      "the-station-reruns-on-body2-with-fewer-tunings.test.ts"]) {
      expect(existsSync(join(HERE, f)), f).toBe(true);
    }
    const dirFiles = readdirSync(STORE_CASES);
    expect(dirFiles.includes("body2") && dirFiles.includes("aisha")).toBe(true);
  });
});
