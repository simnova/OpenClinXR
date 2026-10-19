import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runFaceRealism } from "./run.js";

/**
 * The face station runs its 7 stages from a case id.
 *
 * All heavy evidence comes from the tracked case-run report (built by
 * face_realism/run-case.ts, which executes runFaceRealism twice per case
 * into store out dirs). This test reads the report, recomputes every
 * check from the named files, and only runs the fast refusal live.
 * No Blender runs here.
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

const FACE_DIR = "packages/openclinxr/factory-stations/src/face_realism";
const RECORD = "tools/openclinxr/asset-pipeline/reference-set/manifest.json";
const STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases";

function shaFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Per-mesh POSITION shas via the landed lid-conform core (same method as
 * the any-subject G1 rebake comparison). Recomputed live, never trusted
 * from the report. */
function positionShas(glb: string): string {
  const root = testRepoRoot();
  return execFileSync(
    "python3",
    [
      join(root, FACE_DIR, "drivers", "stage4_position_shas.py"),
      "--lid-conform-dir",
      join(root, "tools/openclinxr/asset-pipeline/realism-head/lid-conform"),
      "--glb",
      glb,
    ],
    { encoding: "utf8" },
  );
}

type StageRecord = {
  stage: number;
  name: string;
  script: string;
  argv: string[];
  inputs: Array<{ path: string; sha256: string }>;
  outputs: Array<{ path: string; sha256: string }>;
  byproducts?: Array<{ path: string; sha256: string }>;
  unchainedInputs: Array<{ path: string; sha256: string }>;
  ran: boolean;
  blocked: boolean;
  blockReason?: string;
  blocked_by?: string;
  gate: { pass: boolean; detail: string; knownGood?: { name: string; expected: string; expectedSource: string; actual: string } };
  wallSeconds: number;
  extra?: {
    checks?: Record<string, { blocked?: boolean; blocked_by?: string; reason?: string }>;
    positionFallback?: { byteMatch: boolean; positionMatch: boolean };
    knownGoodRows?: Array<Record<string, unknown>>;
    positionR3?: { match?: boolean };
  };
};

type CaseRunReport = {
  store: string;
  cases: Record<string, { runs: Record<string, { status: string; wallSeconds: number; stages?: StageRecord[]; unchainedInputs?: Array<{ path: string; sha256: string }> }> }>;
  knownGood: Array<{ case: string; run: string; stage: number; name: string; expected: string; expectedSource: string; actual: string; match: boolean }>;
  blockedChecks: Array<{ case: string; run: string; stage: number; check?: string; reason?: string }>;
  unchainedInputs: Array<{ path: string; sha256: string }>;
};

/** Runs that refused at the plan gate carry no stages (run-case.ts writes
 * the refusal record without a stages key). They assert refused status;
 * only staged runs compare stage outputs. */
function refusedRun(runDoc: { status: string; stages?: StageRecord[] }): boolean {
  if (Array.isArray(runDoc.stages)) return false;
  expect(runDoc.status, "stageless run is a gate refusal").toBe("refused");
  return true;
}

function readReport(): CaseRunReport {
  const root = testRepoRoot();
  return JSON.parse(
    readFileSync(join(root, FACE_DIR, "case-run-report.json"), "utf8"),
  ) as CaseRunReport;
}

/**
 * The run dir a live pin was re-derived from, read off its tracked source
 * (face-station-cases/<case>/run<N>/...). A placeholder-era source names no
 * run dir, so there is nothing to return. Derived from the tracked string;
 * no run literal is typed.
 */
function livePinRunDir(source: string | undefined): string | null {
  if (source === undefined) return null;
  return /face-station-cases\/[^/]+\/(run\d+)\//.exec(source)?.[1] ?? null;
}

/**
 * Failure routing for a non-passing stage: blockReason, blocked_by, and
 * check reasons, plus two scoped pre-repin allowances. (1) A failing stage
 * 3 whose gate known-good is the all-zero placeholder routes iff the live
 * pin for that case equals this run's final albedo sha — or, when the live
 * pin moved on to a later run, the stale placeholder now superseded. (2) A failing stage
 * 3 whose final-stage known-good matches by construction (the final
 * manifest stage carries no pin) routes iff every failing chained
 * sub-stage cites an all-zero known-good AND the live pin for its config
 * key equals the sub-stage actual — the re-pin really came from this run —
 * or, when the live pin moved on (its tracked source names a later run
 * dir), the stale placeholder from the prior card's re-pin cycle, now
 * superseded.
 * A non-placeholder mismatch routes nowhere (the negative control below
 * proves it).
 */
function collectRouted(
  stage: StageRecord,
  livePin: (configKey: string, caseId: string) => { value: string | null; source: string | null } | null,
  caseId: string,
  runName?: string,
): string[] {
  const routed: string[] = [];
  if (typeof stage.blockReason === "string" && stage.blockReason.length > 0) {
    routed.push(stage.blockReason);
  }
  if (typeof stage.blocked_by === "string" && stage.blocked_by.length > 0) {
    routed.push(stage.blocked_by);
  }
  const checks = stage.extra?.checks ?? {};
  for (const result of Object.values(checks)) {
    for (const key of ["blocked_by", "reason"] as const) {
      const text = result?.[key];
      if (typeof text === "string" && text.length > 0) routed.push(text);
    }
  }
  if (routed.length === 0) {
    const knownGood = stage.gate.knownGood;
    const finalSha = (stage.extra as { finalAlbedo?: { sha256?: unknown } | undefined } | undefined)?.finalAlbedo
      ?.sha256;
    if (
      stage.stage === 3 &&
      knownGood?.name === "albedo_detail.png" &&
      /^0{64}$/.test(String(knownGood?.expected ?? "")) &&
      typeof finalSha === "string"
    ) {
      const live = livePin("stage3_detail", caseId)?.value;
      if (live === finalSha) {
        routed.push(`superseded placeholder: live pin in case-inputs.json == run final ${finalSha.slice(0, 12)}`);
      } else if (runName !== undefined) {
        // Stale placeholder from a prior card's re-pin cycle: the live pin
        // moved on (its tracked source names a later run dir). The routing
        // names the superseding source so the file-citation check holds.
        const source = livePin("stage3_detail", caseId)?.source ?? undefined;
        const sourceRun = livePinRunDir(source);
        if (sourceRun !== null && sourceRun !== runName) {
          routed.push(
            `superseded placeholder: live pin re-derived after this run (${String(finalSha).slice(0, 12)}) <- ${String(source)}`,
          );
        }
      }
    }
  }
  if (routed.length === 0) {
    // Re-pin run-A allowance (tsk_3dc1802d0ca2b36c): the final manifest
    // stage carries no pin, so its known-good matches by construction and a
    // re-pin run A fails stage 3 only through placeholder-pinned chained
    // sub-stages (beard_shadow.py -> stage3_beard, detail_bands.py ->
    // stage3_detail). Route iff every failing sub-stage cites an all-zero
    // known-good in its gate detail and EITHER the live pin for its config
    // key equals the sub-stage actual output sha (the re-pin really came
    // from this run) OR the live pin moved on (its tracked source names a
    // run dir different from this run: a stale placeholder from a prior
    // card's re-pin cycle, superseded by the later re-derivation).
    const knownGood = stage.gate.knownGood;
    const subStages = (
      stage.extra as
        | {
            subStages?: Array<{
              script?: unknown;
              outputs?: Array<{ sha256?: unknown }>;
              gate?: { pass?: unknown; detail?: unknown };
            }>;
          }
        | undefined
    )?.subStages;
    const scriptKey: Record<string, string> = {
      "beard_shadow.py": "stage3_beard",
      "detail_bands.py": "stage3_detail",
    };
    if (
      stage.stage === 3 &&
      knownGood !== undefined &&
      knownGood.expected === knownGood.actual &&
      Array.isArray(subStages)
    ) {
      const failed = subStages.filter((sub) => sub.gate?.pass === false);
      const citedZero = (sub: { gate?: { detail?: unknown } }): boolean => {
        const cited = /vs known-good ([0-9a-f]+)/.exec(String(sub.gate?.detail ?? ""))?.[1] ?? "";
        return cited.length > 0 && /^0+$/.test(cited);
      };
      const subKey = (sub: { script?: unknown }): string | undefined => {
        const base = String(sub.script ?? "").split("/").at(-1) ?? "";
        return scriptKey[base];
      };
      const currentPin = (sub: { script?: unknown; outputs?: Array<{ sha256?: unknown }> }): boolean => {
        const key = subKey(sub);
        if (key === undefined) return false;
        const actual = sub.outputs?.[0]?.sha256;
        return typeof actual === "string" && livePin(key, caseId)?.value === actual;
      };
      const stalePin = (sub: { script?: unknown; outputs?: Array<{ sha256?: unknown }> }): boolean => {
        const key = subKey(sub);
        if (key === undefined || runName === undefined) return false;
        const actual = sub.outputs?.[0]?.sha256;
        if (typeof actual !== "string") return false;
        const live = livePin(key, caseId);
        if (live?.value === actual) return false;
        const sourceRun = livePinRunDir(live?.source ?? undefined);
        return sourceRun !== null && sourceRun !== runName;
      };
      if (
        failed.length > 0 &&
        failed.every((sub) => citedZero(sub) && (currentPin(sub) || stalePin(sub)))
      ) {
        const stale = failed.some((sub) => !currentPin(sub));
        if (!stale) {
          routed.push(
            `superseded placeholder sub-stages: live pins in case-inputs.json == run actuals (${failed
              .map((sub) => `${String(sub.script ?? "").split("/").at(-1)}:${String(sub.outputs?.[0]?.sha256 ?? "").slice(0, 12)}`)
              .join(",")})`,
          );
        } else {
          // The routing names the superseding pin sources (tracked
          // case-inputs.json sources) so the (report) file-citation check
          // holds for stale rows too.
          const sources = [...new Set(failed.map((sub) => String(livePin(subKey(sub) as string, caseId)?.source ?? "")))];
          routed.push(
            `superseded placeholder sub-stages: live pins re-derived after this run (${failed
              .map((sub) => `${String(sub.script ?? "").split("/").at(-1)}:${String(sub.outputs?.[0]?.sha256 ?? "").slice(0, 12)}`)
              .join(",")}) <- ${sources.join(" | ")}`,
          );
        }
      }
    }
  }
  return routed;
}

describe("the face station runs seven stages from a case", () => {
  it("(G1) each case runs twice from empty out dirs with equal stage output shas", () => {
    const report = readReport();
    const caseIds = Object.keys(report.cases).sort();
    expect(caseIds.length).toBeGreaterThanOrEqual(2);
    for (const caseId of caseIds) {
      const runs = report.cases[caseId]!.runs;
      for (const run of ["run1", "run2"]) {
        expect(Object.keys(runs), `${caseId} has ${run}`).toContain(run);
        if (refusedRun(runs[run]!)) continue;
        expect(runs[run]!.stages!.length, `${caseId} ${run} has 7 stages`).toBe(7);
      }
      if (!Array.isArray(runs["run1"]!.stages) || !Array.isArray(runs["run2"]!.stages)) continue;
      const diffs: string[] = [];
      for (let s = 0; s < 7; s += 1) {
        const a = runs["run1"]!.stages[s]!;
        const b = runs["run2"]!.stages[s]!;
        expect(a.stage, `${caseId} stage order`).toBe(s + 1);
        expect(b.stage, `${caseId} stage order`).toBe(s + 1);
        const outs = (rec: StageRecord): string[] =>
          rec.outputs.map((o) => `${o.path.split("/").at(-1)}:${o.sha256}`).sort();
        const oa = outs(a);
        const ob = outs(b);
        if (JSON.stringify(oa) === JSON.stringify(ob)) continue;
        if (a.stage === 4) {
          const glbA = a.outputs.find((o) => o.path.endsWith(".glb"))!.path;
          const glbB = b.outputs.find((o) => o.path.endsWith(".glb"))!.path;
          expect(shaFile(glbA), `${caseId} stage 4 run1 bytes recorded truthfully`).toBe(
            a.outputs.find((o) => o.path.endsWith(".glb"))!.sha256,
          );
          expect(shaFile(glbB), `${caseId} stage 4 run2 bytes recorded truthfully`).toBe(
            b.outputs.find((o) => o.path.endsWith(".glb"))!.sha256,
          );
          expect(positionShas(glbA), `${caseId} stage 4 geometry identical run1 vs run2`).toBe(
            positionShas(glbB),
          );
          expect(a.extra?.positionFallback?.byteMatch).toBe(false);
          expect(b.extra?.positionFallback?.byteMatch).toBe(false);
          continue;
        }
        diffs.push(`${caseId} stage ${s + 1}: ${oa.join(",")} vs ${ob.join(",")}`);
      }
      expect(diffs, diffs.join("; ")).toEqual([]);
    }
  });

  it("(G2) every known-good matches, or the stage-4 position fallback is recorded", () => {
    const report = readReport();
    expect(report.knownGood.length).toBeGreaterThanOrEqual(6);
    const fallbackNeeded: string[] = [];
    const root = testRepoRoot();
    const liveInputs = JSON.parse(
      readFileSync(join(root, FACE_DIR, "case-inputs.json"), "utf8"),
    ) as { cases: Record<string, { stage3_detail?: { value?: { expected_out_sha256?: { value?: unknown; source?: unknown } } } }> };
    for (const entry of report.knownGood) {
      if (entry.match) continue;
      if ((entry as { informational?: boolean }).informational === true) {
        expect(typeof (entry as { note?: unknown }).note, `${entry.case} ${entry.run} informational row carries a note`).toBe("string");
        continue;
      }
      // Superseded pre-repin placeholder (first written for tsk_68c071233175cae2 run A):
      // the card's re-pin protocol records the placeholder expectation at
      // run time and re-derives the pin from the run's actual. The row is
      // allowed when the live case-inputs pin for that case/stage equals
      // this run's actual (the re-pin really came from run A), or when the
      // live pin moved on — its tracked source names a run dir different
      // from this row's run (a stale placeholder from a prior card's
      // re-pin cycle, superseded by the later re-derivation; the pin's
      // pre/post table lives in the re-pinning card's report).
      if (
        entry.stage === 3 &&
        entry.name === "albedo_detail.png" &&
        /^0{64}$/.test(entry.expected) &&
        entry.expectedSource.includes("placeholder")
      ) {
        const live = liveInputs.cases[entry.case]?.stage3_detail?.value?.expected_out_sha256;
        const liveValue = typeof live?.value === "string" ? live.value : null;
        if (liveValue === entry.actual) continue;
        const sourceRun = livePinRunDir(typeof live?.source === "string" ? live.source : undefined);
        expect(sourceRun, `${entry.case} ${entry.run} stale placeholder row names its superseding run`).not.toBeNull();
        expect(sourceRun, `${entry.case} ${entry.run} placeholder row was re-pinned from a later run`).not.toBe(entry.run);
        continue;
      }
      if (entry.stage !== 4) {
        fallbackNeeded.push(`${entry.case} ${entry.run} stage ${entry.stage} ${entry.name}: no match and no fallback allowed`);
        continue;
      }
      const stage = report.cases[entry.case]!.runs[entry.run]!.stages![3]!;
      // Card tsk_2c547dda8753bba0: a stage-4 bake with the fit folded in
      // (extra.faceFit) moves the bytes AND the body POSITION by design, so
      // the pre-fix position fallback cannot pass. The move is gated instead
      // by the bake log proving the fit was baked (G4 of
      // the-station-bakes-the-fitted-face.test.ts).
      const faceFit = (stage.extra as { faceFit?: { applied?: unknown[]; logVerified?: boolean } | null } | undefined)?.faceFit;
      if (faceFit !== undefined && faceFit !== null && Array.isArray(faceFit.applied) && faceFit.applied.length > 0) {
        expect(faceFit.logVerified, `${entry.case} ${entry.run} stage 4 fit-baked run proves FACE_TARGETS_APPLY`).toBe(true);
        continue;
      }
      const fallback = stage.extra?.positionFallback;
      expect(fallback, `${entry.case} ${entry.run} stage 4 records the position fallback`).toBeDefined();
      expect(fallback!.byteMatch).toBe(false);
      expect(fallback!.positionMatch, `${entry.case} ${entry.run} stage 4 position fallback passes`).toBe(true);
    }
    expect(fallbackNeeded).toEqual([]);
    const matched = report.knownGood.filter((e) => e.match).length;
    expect(matched).toBeGreaterThanOrEqual(6);
  });

  it("(G2b) known-good expectations equal the values in their source files", () => {
    const root = testRepoRoot();
    const report = readReport();
    const runReport = JSON.parse(
      readFileSync(join(root, FACE_DIR, "run-report.json"), "utf8"),
    ) as { finalAlbedo: { sha256: string } };
    const r2 = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/evidence/second-subject/second-subject-r2-report.json"), "utf8"),
    ) as { stages: Record<string, { outputs_run1?: Record<string, string> }> };
    const fitWeights = (name: string): string =>
      shaFile(join(root, "tools/openclinxr/evidence/face-fit", name));
    const seen = new Set<string>();
    const conform = JSON.parse(
      readFileSync(
        join(root, "tools/openclinxr/asset-pipeline/realism-head/lid-conform/conform-report.json"),
        "utf8",
      ),
    ) as { bake: { newGlb: { sha256: string } } };
    const anySubject = JSON.parse(
      readFileSync(
        join(root, "tools/openclinxr/asset-pipeline/realism-head/lid-conform/any-subject-report.json"),
        "utf8",
      ),
    ) as {
      bake: { newGlb: { sha256: string } };
      supersededPreCanthus?: { bake: { newGlb: { sha256: string } } };
    };
    const realChain = JSON.parse(
      readFileSync(
        join(
          root,
          "tools/openclinxr/asset-pipeline/skin/face-replay/aisha-real-chain-report.json",
        ),
        "utf8",
      ),
    ) as {
      G3_real_chain: { output_shas_with_beard: Record<string, string> };
      G4_polygon_sweep: { w09_albedo_regenerated_sha256: string };
    };
    const rechainSockets = [
      realChain.G3_real_chain.output_shas_with_beard["albedo_socket.png"],
      realChain.G4_polygon_sweep.w09_albedo_regenerated_sha256.split(" ")[0],
    ];
    for (const entry of report.knownGood) {
      if (entry.name.endsWith("-lidconform.glb")) {
        // Re-pin tsk_b85fc19dac1bc8cc: pre-fix runs cite the superseded
        // pin, which the record keeps in supersededPreCanthus — read from
        // the record, never weakened.
        const accepted = [conform.bake.newGlb.sha256, anySubject.bake.newGlb.sha256];
        const superseded = anySubject.supersededPreCanthus?.bake.newGlb.sha256;
        if (typeof superseded === "string") accepted.push(superseded);
        // Re-pin tsk_68c071233175cae2: post-browform runs cite the run-A
        // GLB file the pin was re-derived from. The cited file must exist
        // in the store and recompute to the expectation — the pin traces
        // to landed bytes, not to a restated constant.
        const citedRunFile = entry.expectedSource.split(" ")[0] ?? "";
        if (citedRunFile.startsWith("face-station-cases/")) {
          const citedAbs = join(STORE_CASES, citedRunFile.slice("face-station-cases/".length));
          if (existsSync(citedAbs)) accepted.push(shaFile(citedAbs));
        }
        expect(accepted, "stage-4 expectation cites a conform report or its re-pin run file").toContain(entry.expected);
        seen.add(`bake-${entry.case}`);
      }
      if (entry.name === "albedo_beard.png" && entry.expectedSource.includes("aisha-real-chain-report.json")) {
        expect(rechainSockets, "stage-3 expectation cites the real-chain report").toContain(
          entry.expected,
        );
        seen.add("albedo-rechain");
      }
      if (entry.name.endsWith(" POSITION") && entry.expectedSource.includes("second-subject-r3-report.json")) {
        const cited = entry.expectedSource.match(/tools\/\S+\.json/)?.[0];
        expect(cited, "POSITION row cites the r3 report file").toBeDefined();
        const r3 = JSON.parse(
          readFileSync(join(root, cited!), "utf8"),
        ) as {
          body2: { runs: Record<string, { stages: Array<{ stage: number; outputs: Array<{ path: string; sha256: string }> }> }> };
        };
        const r3out = r3.body2.runs["r3-run1"]!.stages.find((s) => s.stage === 4)!.outputs[0]!;
        const r3glb = r3out.path.startsWith("assets:")
          ? join("/Volumes/files/openclinxr-assets/store", r3out.path.slice("assets:".length))
          : r3out.path;
        expect(shaFile(r3glb), "r3 record GLB recomputes").toBe(r3out.sha256);
        const inputs = JSON.parse(readFileSync(join(root, FACE_DIR, "case-inputs.json"), "utf8")) as {
          cases: Record<string, Record<string, { value?: { body?: { value?: unknown } } }>>;
        };
        const body = String(
          inputs.cases[entry.case]!["stage4_position_known_good"]!.value!.body!.value!,
        );
        const positions = JSON.parse(positionShas(r3glb)) as {
          body: string;
          positionSha256: Record<string, string>;
        };
        expect(positions.positionSha256[body], "POSITION row expectation reads through the cited r3 record").toBe(
          entry.expected,
        );
        seen.add("position-r3");
      }
      if (!entry.match) continue;
      const from = entry.expectedSource;
      if (entry.name.endsWith("albedo_socket.png") && from.includes("run-report.json")) {
        expect(entry.expected, "stage-3 expectation cites run-report.json").toBe(runReport.finalAlbedo.sha256);
        seen.add("albedo-fixture");
      }
      if (entry.name.endsWith("albedo_socket.png") && from.includes("second-subject-r2-report.json")) {
        expect(entry.expected, "stage-3 expectation cites the r2 report").toBe(
          r2.stages["3_replay_albedo"]!.outputs_run1!["albedo_socket.png"],
        );
        seen.add("albedo-r2");
      }
      if (entry.name.startsWith("fit_weights_")) {
        expect(entry.expected, "stage-6 expectation equals the tracked weights file").toBe(
          fitWeights(`fit_weights_${entry.case}.json`),
        );
        seen.add(`fit-${entry.case}`);
      }
    }
    expect([...seen].sort().join(",")).toContain("albedo-rechain");
    expect([...seen].sort().join(",")).toContain("bake-");
    expect([...seen].sort().join(",")).toContain("fit-");
  });

  it("(G3) planning resolves the actor id as the case; an absent case refuses naming it", () => {
    const first = runFaceRealism({ actorId: "body2", recordPath: RECORD });
    expect(first["stop"]).toBe(true);
    expect(first["status"]).toBe("replayed");
    const plan = first["plan"] as { caseId?: unknown } | null;
    expect(plan?.caseId, "actor body2 plans as body2").toBe("body2");
    const missing = "no_such_case_xyz";
    const refused = runFaceRealism({ actorId: missing, recordPath: RECORD });
    expect(refused["stop"]).toBe(true);
    expect(refused["status"]).toBe("refused");
    expect(String(refused["stop_reason"]), "stop reason names the missing case").toContain(missing);
    const report = readReport();
    expect(Object.keys(report.cases)).toContain("body2");
    expect(report.cases["body2"]!.runs["run1"]!.status).toBe("partial");
    expect(report.cases["aisha"]!.runs["run1"]!.status).toBe("completed");
  });

  it("(G4) counterweight: run.ts and plan.ts name no case", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of ["run.ts", "plan.ts"]) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const lit of ["aisha", "body2", "adult_male_street_casual", "ob_patient_aisha"]) {
        expect(src, `${file} must not name ${lit}`).not.toContain(lit);
      }
    }
    const inputs = JSON.parse(readFileSync(join(dir, "case-inputs.json"), "utf8")) as {
      cases: Record<string, unknown>;
    };
    expect(Object.keys(inputs.cases).length).toBeGreaterThanOrEqual(2);
  });

  it(existsSync(STORE_CASES) ? "(G5) every store output the report names recomputes to its sha" : "(G5) store absent: sha verification skipped", () => {
    if (!existsSync(STORE_CASES)) return;
    const report = readReport();
    // Stage 3 records every sub-stage write in order: the reference chain
    // replay and the standalone chain both emit the manifest file names, so
    // the final standalone write overwrites the reference bytes under the
    // same path. Later records win within a run; across runs (shared
    // inputs) the sha must be stable. Derived from the report order — no
    // path literal.
    const named = new Map<string, { sha: string; runKey: string }>();
    for (const [caseId, caseDoc] of Object.entries(report.cases)) {
      for (const [runName, runDoc] of Object.entries(caseDoc.runs)) {
        if (refusedRun(runDoc)) continue;
        const runKey = `${caseId}/${runName}`;
        for (const stage of runDoc.stages!) {
          for (const io of [...stage.inputs, ...stage.outputs, ...(stage.byproducts ?? [])]) {
            if (io.path.startsWith(STORE_CASES) && existsSync(io.path) && statSync(io.path).isFile()) {
              const prior = named.get(io.path);
              if (prior !== undefined && prior.runKey !== runKey) {
                expect(prior.sha, io.path).toBe(io.sha256);
              }
              named.set(io.path, { sha: io.sha256, runKey });
            }
          }
        }
      }
    }
    expect(named.size).toBeGreaterThan(10);
    // A path the same run writes twice keeps only its final sha here; the
    // superseded history entry cannot recompute by design (the bytes were
    // overwritten), so only final bytes are verified — a file matching
    // neither the final nor any history entry still mismatches below.
    const mismatches: string[] = [];
    for (const [file, entry] of named) {
      if (shaFile(file) !== entry.sha) mismatches.push(file);
    }
    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it("(report) carries 7 stage records, unchained inputs, blocked checks and wall times", () => {
    const report = readReport();
    const root = testRepoRoot();
    const liveInputs = JSON.parse(
      readFileSync(join(root, FACE_DIR, "case-inputs.json"), "utf8"),
    ) as { cases: Record<string, Record<string, { value?: { expected_out_sha256?: { value?: unknown; source?: unknown } } }>> };
    const livePin = (configKey: string, caseId: string): { value: string | null; source: string | null } => {
      const pin = liveInputs.cases[caseId]?.[configKey]?.value?.expected_out_sha256;
      return {
        value: typeof pin?.value === "string" ? pin.value : null,
        source: typeof pin?.source === "string" ? pin.source : null,
      };
    };
    expect(report.knownGood.length).toBeGreaterThanOrEqual(6);
    expect(report.blockedChecks.length).toBeGreaterThanOrEqual(1);
    expect(
      report.blockedChecks.some((b) => b.check === "face_gate" || b.stage === 7),
      "face-gate blocked check recorded",
    ).toBe(true);
    expect(report.unchainedInputs.length).toBeGreaterThanOrEqual(2);
    for (const [caseId, caseDoc] of Object.entries(report.cases)) {
      for (const [runName, runDoc] of Object.entries(caseDoc.runs)) {
        if (refusedRun(runDoc)) continue;
        expect(runDoc.stages!.length).toBe(7);
        for (const stage of runDoc.stages!) {
          expect(typeof stage.wallSeconds).toBe("number");
          if (stage.gate.pass) continue;
          // A failing stage must route somewhere (see collectRouted) —
          // never a hard-coded expectation of which stages fail.
          const routed = collectRouted(stage, livePin, caseId, runName);
          expect(routed.length, `${caseId} ${runName} stage ${stage.stage} routes its failure`).toBeGreaterThan(0);
          expect(
            routed.some((text) => text.includes(".json") || /(^|\s)\S+\/\S+\.\w+/.test(text)),
            `${caseId} ${runName} stage ${stage.stage} routing names a file`,
          ).toBe(true);
        }
        expect(runDoc.unchainedInputs!.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("(report counterweight) a non-placeholder pin mismatch routes nowhere", () => {
    // The scoped allowance above must not generalize: a failing stage 3
    // whose known-good is a real (non-zero) pin that mismatches the run
    // collects no routing, so the (report) test would fail on it.
    const synthetic = {
      stage: 3,
      blockReason: undefined,
      blocked_by: undefined,
      gate: {
        pass: false,
        detail: "detail output ab12cd34 vs known-good 9876ef01",
        knownGood: {
          name: "albedo_detail.png",
          expected: "9876ef019876ef019876ef019876ef019876ef019876ef019876ef019876ef01",
          expectedSource: "some landed report",
          actual: "ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34",
        },
      },
      extra: { finalAlbedo: { sha256: "ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34" } },
    } as unknown as StageRecord;
    expect(collectRouted(synthetic, () => ({ value: "c2afabdfa430476ee6924db1596cd42f8055d5e62cced22f912747f22f94c3a5", source: null }), "body2")).toEqual([]);
  });
});
