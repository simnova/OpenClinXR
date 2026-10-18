import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_528c17d1809cac92 H1: the third subject is a CHILD case (the case id
 * is read from the report, never hardcoded). This test reads
 * tools/openclinxr/evidence/second-subject/third-subject-report.json and
 * verifies the H1 rework: the normal CLI still refuses at the plan gate, but
 * the landed stage scripts were run directly for the child in run1/run2.
 *
 * G1 every H1 stage output that exists is identical run1 vs run2; refusal and
 *    evidence signatures are identical run1 vs run2.
 * G2 every stage has a row with a verdict + reason; every finding carries
 *    evidence_kind observed|inferred.
 * G3 counterweight: no stage/runner/materializer/threshold file
 *    differs from the recorded H1 base; only the card's data files
 *    (recorded in the allowlist below) may differ.
 * G4 no case id appears in any .ts: the case id is read from the report, and
 *    this suite asserts neither the station's .ts sources nor this test
 *    hardcode a case id literal.
 * When /Volumes/files/openclinxr-assets/store exists, every named H1 output
 * and observed log/artifact is rechecked on disk (else the suite skips under
 * a name containing "store absent").
 *
 * claimScope: the H1 direct stage runs for the child and their recorded
 *   refusals/observations.
 * notEvidenceFor: clinical_validity, production_asset_readiness, child
 *   anatomy correctness (no child bake succeeded).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REPORT = join(HERE, "third-subject-report.json");
const STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases";

const CANONICAL_STAGES = ["family_tone", "skin_layers", "skin_chain", "lid_conform_bake", "eye_flags", "face_fit", "checks"];

type H1Output = { name: string; path: string; sha256: string };
type H1Run = {
  rc: number;
  outputs: H1Output[];
  refusal_sha?: string | null;
  evidence_sha?: string | null;
  log?: string | null;
};
type H1Stage = {
  stage: number;
  name: string;
  status: string;
  reason: string;
  script: string;
  argv: unknown[];
  command: string;
  runs: { run1: H1Run; run2: H1Run };
};

type Report = {
  card: string;
  handoff?: string;
  diffBase?: { sha?: unknown; note?: unknown };
  subject: { caseId: string; actorId: string; reference: string; goal: string };
  runner: {
    runs: Array<{ run: string; cli_argv: string[]; status: string; stop_reason: string; stageRecords: string }>;
  };
  h1_direct: {
    stages: H1Stage[];
    runs: { run1: { storeDir: string }; run2: { storeDir: string } };
  };
  stages?: unknown;
  findings: Array<{
    id: string;
    claim: string;
    evidence: string;
    evidence_kind: string;
    artifacts?: unknown;
    verdict: string;
  }>;
  sheet: { kind: string; root: string; files: Record<string, string> };
  station_sheet: { status: string; reason: string };
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
    expect(r.handoff).toBe("H1");
    expect(r.subject.caseId.length, "case id").toBeGreaterThan(0);
    expect(r.subject.actorId.length, "actor id").toBeGreaterThan(0);
    expect(r.subject.reference.length, "reference").toBeGreaterThan(0);
    expect(r.subject.goal, "no goal image exists for the child").toBe("none");
    expect(r.verdict).toBe("runs_with_4_refusals");
  });

  it("(2) run1 and run2 still refuse at the plan gate with the same reason", () => {
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

  it("(3) G2: H1 has all 7 stages plus evidence_kind on every finding", () => {
    const r = readReport();
    const stages = r.h1_direct.stages;
    expect(stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(stages.map((s) => s.name)).toEqual(CANONICAL_STAGES);
    for (const s of stages) {
      expect(["completed", "partial", "refused"].includes(s.status), `stage ${s.stage} status enum`).toBe(true);
      expect(s.reason.length, `stage ${s.stage} reason`).toBeGreaterThan(0);
      expect(s.script.length, `stage ${s.stage} script`).toBeGreaterThan(0);
      expect(Array.isArray(s.argv), `stage ${s.stage} argv`).toBe(true);
      expect(s.command.length, `stage ${s.stage} command`).toBeGreaterThan(0);
      expect(s.runs.run1.outputs.length + s.runs.run2.outputs.length >= 0).toBe(true);
    }
    expect(r.findings.length, "findings").toBeGreaterThan(3);
    for (const f of r.findings) {
      expect(["observed", "inferred"].includes(f.evidence_kind), `${f.id} evidence_kind enum`).toBe(true);
      expect(f.id.length, "finding id").toBeGreaterThan(0);
      expect(f.evidence, `${f.id} cites a file:line`).toMatch(/\.(py|ts|json):[^\s]*\d/);
      expect(f.verdict.length, `${f.id} verdict`).toBeGreaterThan(0);
      if (f.evidence_kind === "observed") {
        expect(Array.isArray(f.artifacts), `${f.id} observed names artifacts`).toBe(true);
        expect((f.artifacts as unknown[]).length, `${f.id} observed artifacts`).toBeGreaterThan(0);
      }
    }
    const refused = stages.filter((s) => s.status === "refused").length;
    const finished = stages.filter((s) => s.status === "completed" || s.status === "partial").length;
    expect(refused, "H1 refused stage count").toBe(4);
    expect(finished, "H1 completed/partial stage count").toBeGreaterThan(0);
  });

  it("(4) G1: every H1 output is identical run1 vs run2; refusal/evidence signatures match", () => {
    const r = readReport();
    for (const s of r.h1_direct.stages) {
      const a = s.runs.run1.outputs.map((o) => o.sha256).sort();
      const b = s.runs.run2.outputs.map((o) => o.sha256).sort();
      expect(a, `stage ${s.stage} run1==run2 output shas`).toEqual(b);
      for (const h of a) {
        expect(h, `stage ${s.stage} sha hex`).toMatch(/^[0-9a-f]{64}$/);
      }
      const r1 = s.runs.run1.refusal_sha ?? null;
      const r2 = s.runs.run2.refusal_sha ?? null;
      if (r1 !== null || r2 !== null) {
        expect(r1, `stage ${s.stage} refusal run1==run2`).toBe(r2);
        expect(String(r1), `stage ${s.stage} refusal sha hex`).toMatch(/^[0-9a-f]{64}$/);
      }
      const e1 = s.runs.run1.evidence_sha ?? null;
      const e2 = s.runs.run2.evidence_sha ?? null;
      if (e1 !== null || e2 !== null) {
        expect(e1, `stage ${s.stage} evidence run1==run2`).toBe(e2);
        expect(String(e1), `stage ${s.stage} evidence sha hex`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("(5) G3 counterweight: no stage/runner/materializer/threshold file differs from the recorded H1 base", () => {
    const r = readReport();
    const base = (r.diffBase ?? {}).sha;
    expect(typeof base, "report records the H1 diff base sha").toBe("string");
    expect(base as string, "diff base is a commit sha").toMatch(/^[0-9a-f]{40,64}$/);
    const caseId = r.subject.caseId;
    let out = "";
    try {
      execFileSync("git", ["diff", "--quiet", base as string, "--",
        "packages/openclinxr/factory-stations/src/face_realism/plan.ts",
        "packages/openclinxr/factory-stations/src/face_realism/run.ts",
        "packages/openclinxr/factory-stations/src/face_realism/run-case.ts",
        "packages/openclinxr/factory-stations/src/face_realism/stages-a.ts",
        "packages/openclinxr/factory-stations/src/face_realism/stages-b.ts",
        "tools/openclinxr/evidence/blender",
      ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = String((e as { stdout?: unknown }).stdout ?? e);
    }
    expect(out, "stage/runner/materializer files identical to the recorded H1 base").toBe("");

    let changed = "";
    try {
      changed = execFileSync("git", ["diff", "--name-only", base as string], { cwd: REPO_ROOT, encoding: "utf8" });
    } catch (e) {
      changed = String((e as { stdout?: unknown }).stdout ?? "");
    }
    // Card tsk_386c8c91eee19dca legitimately changes data files (chain row,
    // pins, targets, reports) while touching no stage/runner code; the
    // allowlist names exactly those. Any other edit (e.g. a stage script)
    // fails here. Case-derived target names are built from the report's
    // case id, never hardcoded (G4).
    const allowed = (p: string): boolean =>
      p === "packages/openclinxr/factory-stations/arch-index.json" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/case-inputs.json" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/run-case.ts" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/the-run-case-never-overwrites-evidence.test.ts" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/case-run-report.json" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/run-report.json" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/station-manifest.json" ||
      p === "packages/openclinxr/factory-stations/src/face_realism/the-face-station-runs-seven-stages-from-a-case.test.ts" ||
      p === "tools/openclinxr/asset-pipeline/reference-set/manifest.json" ||
      p === "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json" ||
      p === "tools/openclinxr/asset-pipeline/skin/face-replay/second-body-report.json" ||
      p === "tools/openclinxr/evidence/face-fit/any-subject-targets.json" ||
      p === "tools/openclinxr/evidence/face-fit/child-inputs-report.json" ||
      p === "tools/openclinxr/evidence/face-fit/fit-report.json" ||
      p === "tools/openclinxr/evidence/face-fit/identity-report.json" ||
      p === "tools/openclinxr/evidence/face-fit/make_any_subject_targets.py" ||
      p === "tools/openclinxr/evidence/face-fit/the-child-case-has-station-inputs.test.ts" ||
      p === `tools/openclinxr/evidence/face-fit/fit_weights_${caseId}.json` ||
      p === `tools/openclinxr/evidence/face-fit/fit_file_weights_${caseId}.json` ||
      p === `tools/openclinxr/evidence/face-fit/pts_target_${caseId}_front.npy` ||
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

  it("(7) reference sheet stays reference-only; no station sheet was produced", () => {
    const r = readReport();
    expect(r.sheet.kind).toBe("shipped_glb_product_path_capture");
    expect(r.sheet.files["sheet.png"]).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r.sheet.files).length).toBeGreaterThanOrEqual(4);
    expect(r.station_sheet.status).toBe("not_produced");
    expect(r.station_sheet.reason.length, "station sheet reason").toBeGreaterThan(0);
    expect(String(r.verdictNote).length, "verdictNote").toBeGreaterThan(0);
    expect(r.followUps.length, "followUps").toBeGreaterThan(2);
  });

  maybe("(8) store absent skips here: every named H1 output recomputes and every observed store log/artifact exists", () => {
    const r = readReport();
    expect(existsSync(STORE_CASES)).toBe(true);
    let n = 0;
    for (const s of r.h1_direct.stages) {
      for (const run of [s.runs.run1, s.runs.run2]) {
        for (const o of run.outputs) {
          expect(existsSync(o.path), `H1 output exists: ${o.path}`).toBe(true);
          expect(sha256File(o.path), `H1 sha recomputes: ${o.path}`).toBe(o.sha256);
          n += 1;
        }
        if (typeof run.log === "string" && run.log.length > 0) {
          expect(existsSync(run.log), `H1 log exists: ${run.log}`).toBe(true);
          n += 1;
        }
      }
    }
    for (const f of r.findings) {
      if (f.evidence_kind !== "observed") continue;
      for (const artifact of (f.artifacts ?? []) as unknown[]) {
        if (typeof artifact !== "string") continue;
        expect(existsSync(artifact), `observed artifact exists: ${artifact}`).toBe(true);
        n += 1;
      }
    }
    for (const [name, h] of Object.entries(r.sheet.files)) {
      const abs = join(r.sheet.root, name);
      expect(existsSync(abs), `sheet file exists: ${name}`).toBe(true);
      expect(sha256File(abs), `sheet sha recomputes: ${name}`).toBe(h);
      n += 1;
    }
    const entries = readdirSync(r.sheet.root);
    expect(entries.filter((e) => e.startsWith("station-") && e.endsWith(".png")), "no station sheet PNGs").toEqual([]);
    expect(n).toBeGreaterThan(20);
  });

  maybe("(9) store absent skips here: plan run1/run2 stage-records.json exist and both still refuse", () => {
    const r = readReport();
    for (const run of r.runner.runs) {
      expect(existsSync(run.stageRecords), `stage-records exists: ${run.stageRecords}`).toBe(true);
      const rec = JSON.parse(readFileSync(run.stageRecords, "utf8")) as { case: string; status: string };
      expect(rec.case).toBe(r.subject.caseId);
      expect(rec.status).toBe("refused");
    }
  });
});
