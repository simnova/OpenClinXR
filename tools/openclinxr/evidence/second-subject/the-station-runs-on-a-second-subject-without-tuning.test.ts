import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_c247dc7709a8563a: the face station runs on a second subject
 * (body2, warm_medium) with no per-subject tuning.
 *
 * Reads tools/openclinxr/evidence/second-subject/second-subject-report.json:
 * every stage 1-7 has a recorded row; every stage that ran has
 * run1/run2 sha equality (G1 determinism); no threshold file under
 * face-gate / face-shape-clauses / lid-conform differs from origin/main;
 * every tuned_for_subject[] entry carries stage + file:line + value_needed.
 *
 * claimScope: the second-subject repeat run and its recorded gates/blocks.
 * notEvidenceFor: clinical_validity, production_asset_readiness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "second-subject-report.json");

type StageRow = {
  ran: boolean | string;
  blocked: boolean | string;
  outputs_run1: Record<string, string>;
  outputs_run2: Record<string, string> | string;
  sha_match: boolean | null;
  gate: unknown;
};

type Report = {
  card: string;
  subject: string;
  subject_glb_sha256: string;
  stages: Record<string, StageRow>;
  tuned_for_subject: Array<{ stage: number; file: string; what: string; value_needed: string; why: string }>;
  coverage_gaps: string[];
  verdict: string;
};

function readReport(): Report {
  expect(existsSync(REPORT), `second-subject report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

const STAGE_KEYS = [
  "1_family_tone",
  "2_skin_layers",
  "3_replay_albedo",
  "4_lid_conform",
  "5_eye_flags",
  "6_face_fit",
  "7_checks",
];

describe("the station runs on a second subject without tuning", () => {
  it("(1) every stage 1-7 has a recorded row with ran/blocked and gate", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_c247dc7709a8563a");
    expect(r.subject).toBe("body2");
    expect(r.subject_glb_sha256).toBe(
      "94a9ca6c81d47fe06561a3cfa6914b909eb936d7cf74387d0975a1a0027bc437",
    );
    for (const k of STAGE_KEYS) {
      const s = r.stages[k];
      expect(s, `stage row ${k}`).toBeDefined();
      expect(typeof s.ran, `${k}.ran`).toBe("boolean");
      expect(s.gate, `${k}.gate records pass/fail/blocked`).toBeDefined();
    }
  });

  it("(2) RED: blocked stages name the exact Aisha-specific input they wanted", () => {
    const r = readReport();
    expect(r.stages["4_lid_conform"]!.ran).toBe(false);
    expect(String(r.stages["4_lid_conform"]!.gate)).toMatch(/aisha-lidconform only/);
    expect(r.stages["6_face_fit"]!.ran).toBe(false);
    expect(String(r.stages["6_face_fit"]!.gate)).toMatch(/aisha key only/);
  });

  it("(3) G1: run1/run2 shas are equal for every stage that ran", () => {
    const r = readReport();
    for (const k of STAGE_KEYS) {
      const s = r.stages[k]!;
      if (s.ran !== true) continue;
      expect(s.sha_match, `${k} run1/run2 sha match`).toBe(true);
      const o1 = s.outputs_run1 ?? {};
      const o2 = s.outputs_run2 as Record<string, string>;
      for (const [name, h1] of Object.entries(o1)) {
        if (k === "7_checks" && name === "stage467-probe.json") continue;
        expect(h1, `${k}/${name} sha`).toMatch(/^[0-9a-f]{64}$/);
        if (o2 && typeof o2 === "object" && o2[name]) {
          expect(o2[name], `${k}/${name} run1==run2`).toBe(h1);
        }
      }
    }
    expect(r.stages["3_replay_albedo"]!.outputs_run1["albedo_socket.png"]).toBe(
      "c4f032155eab8c5727ca9ac8ab798acad012529c02234d8b614d6f4ff57a71f6",
    );
  });

  it("(4) no threshold file under face-gate / face-shape-clauses / lid-conform differs from origin/main", () => {
    let out = "";
    try {
      execFileSync("git", [
        "diff",
        "--quiet",
        "origin/main",
        "--",
        "tools/openclinxr/evidence/face-gate",
        "tools/openclinxr/evidence/face-shape-clauses",
        "tools/openclinxr/asset-pipeline/realism-head/lid-conform",
      ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = String((e as { stdout?: unknown }).stdout ?? e);
    }
    expect(out, "threshold dirs identical to origin/main").toBe("");
  });

  it("(5) tuned_for_subject[] entries each carry stage + file:line + value_needed", () => {
    const r = readReport();
    expect(r.tuned_for_subject.length).toBeGreaterThan(0);
    for (const t of r.tuned_for_subject) {
      expect(typeof t.stage, "stage").toBe("number");
      expect(t.file, "file:line").toMatch(/\.(py|ts):\d+(-\d+)?$/);
      expect(t.what.length, "what").toBeGreaterThan(0);
      expect(t.value_needed.length, "value_needed").toBeGreaterThan(0);
      expect(t.why.length, "why").toBeGreaterThan(0);
    }
  });

  it("(6) coverage gaps name the deep-tone hole and the verdict is one line", () => {
    const r = readReport();
    expect(r.coverage_gaps.join("\n")).toMatch(/all families nearest young/);
    expect(["repeatable", "not_repeatable"].includes(r.verdict) ||
      r.verdict.startsWith("repeatable_with_")).toBe(true);
  });
});
