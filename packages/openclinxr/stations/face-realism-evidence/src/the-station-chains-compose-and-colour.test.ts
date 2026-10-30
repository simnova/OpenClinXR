import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runFaceRealism } from "@openclinxr/station-face-realism/runner";

/**
 * The station chains compose and colour.
 *
 * Stage 3 runs compose (face_replay_compose.py) and colour
 * (face_replay_colour.py) from the case instead of a stored pre-fix
 * albedo, then the chain-manifest hand steps derive..socket plus the
 * beard_shadow stage. All evidence comes from the tracked rechain
 * report (per-case per-run sub-stage records) cross-checked against
 * the tracked skin reports; known-good shas are read from those
 * reports live, never pasted. Store-output shas recompute when the
 * store exists.
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

const FACE_DIR = "packages/openclinxr/stations/face-realism/src";
const SKIN_DIR = "tools/openclinxr/asset-pipeline/skin/face-replay";
const STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases";

function shaFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

type SubStage = {
  script: string;
  argv: string[];
  inputs: Array<{ path: string; sha256: string }>;
  outputs: Array<{ path: string; sha256: string }>;
  ran: boolean;
  gate: { pass: boolean; detail: string };
};

type RechainReport = {
  cases: Record<string, { runs: Record<string, { status: string; subStages: SubStage[] }> }>;
  G1_aisha: {
    colourOut: string;
    colourExpected: string;
    colourPass: boolean;
    finalOut: string;
    finalExpected: string;
    finalPass: boolean;
  };
  G2_body2: {
    finalOut: string;
    r3Baseline: string;
    moved: boolean;
    paintBox: {
      paint_box_texels_differing_new_vs_r3: number;
      paint_box_n: number;
      new_paint_box_mean_RGB: number[];
      r3_paint_box_mean_RGB: number[];
    };
  };
  G3_determinism: Record<string, { run1EqualsRun2: boolean }>;
  sheets: Array<{ path: string; sha256: string }>;
  blocked: unknown[];
};

function readReport(): RechainReport {
  return JSON.parse(
    readFileSync(join(testRepoRoot(), FACE_DIR, "rechain-report.json"), "utf8"),
  ) as RechainReport;
}

function realChainAisha(): { chainAlbedo: string; socket: string } {
  const doc = JSON.parse(
    readFileSync(join(testRepoRoot(), SKIN_DIR, "aisha-real-chain-report.json"), "utf8"),
  ) as {
    subjects: { aisha: { chain_albedo_sha256: string } };
    G3_real_chain: { output_shas_with_beard: Record<string, string> };
  };
  return {
    chainAlbedo: doc.subjects.aisha.chain_albedo_sha256,
    socket: doc.G3_real_chain.output_shas_with_beard["albedo_socket.png"]!,
  };
}

/** r3 baseline: read from the tracked r3 report when it exists, else from
 * the rechain report's source-cited baseline (never pasted). */
function r3BaselineSocket(): { sha: string; from: string } {
  const root = testRepoRoot();
  const r3Path = join(root, "tools/openclinxr/evidence/second-subject/second-subject-r3-report.json");
  if (existsSync(r3Path)) {
    const doc = JSON.parse(readFileSync(r3Path, "utf8")) as {
      stages?: Record<string, { outputs_run1?: Record<string, string> }>;
    };
    const sha = doc.stages?.["3_replay_albedo"]?.outputs_run1?.["albedo_socket.png"];
    if (typeof sha === "string" && sha.length > 0) return { sha, from: "second-subject-r3-report.json" };
  }
  const report = readReport();
  return { sha: report.G2_body2.r3Baseline, from: "rechain-report.json G2_body2.r3Baseline (S/st-r3/r3-shas.json)" };
}

function subOut(subs: SubStage[], script: string, name: string): string {
  const sub = subs.find((s) => s.script.endsWith(script));
  if (!sub) throw new Error(`sub-stage ${script} missing`);
  const out = sub.outputs.find((o) => o.path.endsWith(name));
  if (!out) throw new Error(`output ${name} missing from ${script}`);
  return out.sha256;
}

describe("the station chains compose and colour", () => {
  it("(G1) colour output and stage-3 final equal the recorded real-chain shas", () => {
    const report = readReport();
    const recorded = realChainAisha();
    expect(report.G1_aisha.colourExpected, "report cites the real-chain colour sha").toBe(
      recorded.chainAlbedo,
    );
    expect(report.G1_aisha.finalExpected, "report cites the real-chain socket sha").toBe(
      recorded.socket,
    );
    expect(report.G1_aisha.colourOut, "colour reproduces 948b9a3e").toBe(recorded.chainAlbedo);
    expect(report.G1_aisha.finalOut, "final reproduces 8b4c1582").toBe(recorded.socket);
    expect(report.G1_aisha.colourPass).toBe(true);
    expect(report.G1_aisha.finalPass).toBe(true);
  });

  it("(G2) body2 albedo moved from r3; paint-box recorded; wash routed to the skin lane", () => {
    const report = readReport();
    const r3 = r3BaselineSocket();
    expect(report.G2_body2.r3Baseline, `r3 baseline agrees (${r3.from})`).toBe(r3.sha);
    expect(report.G2_body2.finalOut, "new albedo differs from r3").not.toBe(r3.sha);
    expect(report.G2_body2.moved).toBe(true);
    const box = report.G2_body2.paintBox;
    expect(box.paint_box_n).toBeGreaterThan(0);
    expect(box.paint_box_texels_differing_new_vs_r3, "crown changed throughout the box").toBe(
      box.paint_box_n,
    );
    expect(box.new_paint_box_mean_RGB, "donor-mouth dark paint gone from the box").not.toEqual(
      box.r3_paint_box_mean_RGB,
    );
  });

  it("(G3) every stage-3 output sha is equal run1 vs run2, both cases", () => {
    const report = readReport();
    for (const caseId of ["aisha", "body2"]) {
      expect(report.G3_determinism[caseId]!.run1EqualsRun2, `${caseId} run1==run2`).toBe(true);
    }
    const root = testRepoRoot();
    const runReport = JSON.parse(
      readFileSync(join(root, FACE_DIR, "case-run-report.json"), "utf8"),
    ) as {
      cases: Record<string, { runs: Record<string, { stages: Array<{ stage: number; outputs: Array<{ path: string; sha256: string }> }> }> }>;
    };
    for (const caseId of ["aisha", "body2"]) {
      const runs = runReport.cases[caseId]!.runs;
      const s3a = runs["run1"]!.stages.find((s) => s.stage === 3)!;
      const s3b = runs["run2"]!.stages.find((s) => s.stage === 3)!;
      const names = (s: { outputs: Array<{ path: string; sha256: string }> }): string[] =>
        s.outputs.map((o) => `${o.path.split("/").at(-1)}:${o.sha256}`).sort();
      expect(names(s3b), `${caseId} stage-3 run1==run2 (case-run report)`).toEqual(names(s3a));
    }
  });

  it("(G4) counterweight: no case-id literal in any non-test .ts or driver; every new value has a source", () => {
    const dir = join(testRepoRoot(), "packages/openclinxr/stations/face-realism/src");
    const lits = ["aisha", "body2", "adult_male_street_casual", "ob_patient_aisha"];
    const offenders: string[] = [];
    const check = (file: string): void => {
      const src = readFileSync(file, "utf8");
      for (const lit of lits) {
        if (src.includes(lit)) offenders.push(`${file.split("/").at(-1)} names ${lit}`);
      }
    };
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      check(join(dir, entry));
    }
    for (const entry of readdirSync(join(dir, "drivers"))) {
      check(join(dir, "drivers", entry));
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
    const inputs = JSON.parse(readFileSync(join(dir, "case-inputs.json"), "utf8")) as {
      cases: Record<string, unknown>;
    };
    const unsourced: string[] = [];
    const walk = (node: unknown, where: string): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${where}[${i}]`));
        return;
      }
      const rec = node as Record<string, unknown>;
      const value = rec["value"];
      const isLeaf =
        ("value" in rec && (typeof value !== "object" || value === null || Array.isArray(value))) ||
        typeof rec["assets"] === "string" ||
        typeof rec["sha256"] === "string" ||
        (typeof rec["shas"] === "object" && rec["shas"] !== null && !Array.isArray(rec["shas"]));
      if (isLeaf && typeof rec["source"] !== "string") {
        unsourced.push(where);
      }
      for (const [k, v] of Object.entries(rec)) {
        if (k === "source") continue;
        walk(v, `${where}.${k}`);
      }
    };
    for (const [caseId, rec] of Object.entries(inputs.cases)) {
      for (const key of Object.keys(rec as Record<string, unknown>)) {
        if (!key.startsWith("stage3_") && key !== "derive_size") continue;
        walk((rec as Record<string, unknown>)[key], `${caseId}.${key}`);
      }
    }
    expect(unsourced, unsourced.join("; ")).toEqual([]);
  });

  it(existsSync(STORE_CASES) ? "(store) every named store output sha recomputes" : "(store absent: sha verification skipped)", () => {
    if (!existsSync(STORE_CASES)) return;
    const report = readReport();
    const named = new Map<string, string>();
    for (const caseDoc of Object.values(report.cases)) {
      for (const runDoc of Object.values(caseDoc.runs)) {
        for (const sub of runDoc.subStages) {
          for (const io of [...sub.inputs, ...sub.outputs]) {
            if (!io.path.startsWith(STORE_CASES) || io.path.endsWith(".json")) continue;
            if (!existsSync(io.path) || !statSync(io.path).isFile()) continue;
            const prior = named.get(io.path);
            if (prior !== undefined) expect(prior, io.path).toBe(io.sha256);
            named.set(io.path, io.sha256);
          }
        }
      }
    }
    for (const sheet of report.sheets) {
      if (existsSync(sheet.path)) named.set(sheet.path, sheet.sha256);
    }
    expect(named.size).toBeGreaterThan(10);
    const mismatches: string[] = [];
    for (const [file, sha] of named) {
      if (shaFile(file) !== sha) mismatches.push(file);
    }
    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it("(guard) no blocked sub-stage; planning refuses the unknown case", () => {
    expect(readReport().blocked).toEqual([]);
    const first = runFaceRealism({
      actorId: "no_such_case_xyz",
      recordPath: "tools/openclinxr/asset-pipeline/reference-set/manifest.json",
    });
    expect(first["stop"]).toBe(true);
    expect(first["status"]).toBe("refused");
  });
});
