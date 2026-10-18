// Face-realism station runner: executes the 7 case-driven stages in order,
// each through its landed stage script as a subprocess.
//
// Pattern follows hair_editor/run.ts:16-37 (validate -> plan -> run record).
//
// Guard (throws, never counts): a stage whose manifest kind is imagine or
// llm is refused before any subprocess starts, and every subprocess runs
// with model credentials stripped from the env so a model call would fail
// loudly. The replay path itself records no model calls.
//
// Case data lives only in case-inputs.json next to this file. This module
// names no case: every per-case value (chain subject key, bake argv,
// weights, input paths) is read from that record at runtime.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog-mod.js";
import { repoRoot } from "../repo-root.js";
import type { StationPlanResult, StationRunner } from "../runner.js";
import {
  assertNoModelStage,
  planChainManifest,
  prepareFixtureReplayDir,
  runReplayChain,
  stageSyntheticFixtureGlb,
} from "./chain.js";
import { FACE_REALISM_DEFAULT_CHAIN_REL, planFaceRealism, type FaceRealismInput } from "./plan.js";
import {
  type ChainStage,
  caseValue,
  emptyStageRecord,
  loadCaseRecord,
  readJsonFile,
  sanitizedFaceRealismEnv,
  type StageIO,
  type StageRecord,
} from "./shared.js";
import { runStage1, runStage2, runStage3 } from "./stages-a.js";
import { runStage4, runStage7 } from "./stages-b.js";
import { runStage5, runStage6 } from "./stages-d.js";

export {
  assertNoModelStage,
  planChainManifest,
  prepareFixtureReplayDir,
  runReplayChain,
  stageSyntheticFixtureGlb,
};
export { sanitizedFaceRealismEnv };
export type { StageGate, StageIO, StageRecord } from "./shared.js";
export { FACE_REALISM_FIXTURE_ALBEDO_REL, FACE_REALISM_REPLAY_REL } from "./chain.js";

/** Replay-wide model-call counter (legacy; the guard throws, it never gates). */
let faceRealismModelCalls = 0;

/**
 * Reads the replay-wide model-call counter, which the replay path never increments.
 */
export function faceRealismModelCallCount(): number {
  return faceRealismModelCalls;
}

/** Model-call gate. Only a live model invocation may call this; replay never does. */
export function recordFaceRealismModelCall(): number {
  faceRealismModelCalls += 1;
  return faceRealismModelCalls;
}

/**
 * Validates the catalog payload and attaches the dry-run face-realism replay plan.
 * Never executes a model call or a chain stage.
 */
export function planFaceRealismStation(input: unknown): StationPlanResult {
  const checked = factoryStationSchemas.face_realism["~standard"].validate(input);
  if (checked.issues !== undefined) return checked;
  const plan = planFaceRealism(checked.value as FaceRealismInput);
  if (plan.status === "issues") {
    return { issues: plan.issues.map((message) => ({ message })) };
  }
  return {
    value: checked.value,
    plan: {
      mode: "dry-run",
      stationId: "face_realism",
      ...plan.plan,
      bakerId: "face_realism",
      stageId: "face_realism",
      stageScriptRel: FACE_REALISM_DEFAULT_CHAIN_REL,
      stageScript: path.join(repoRoot(), FACE_REALISM_DEFAULT_CHAIN_REL),
      processIsolation: "fresh_subprocess",
    },
  };
}

/**
 * Executes the 7 case-driven stages (family/tone, skin layers, skin chain,
 * lid-conform bake, eye flags, face fit, checks) in order, each through its
 * landed stage script as a subprocess, writing outputs to the caller-given
 * out dir and returning a per-stage record.
 *
 * Without a caller-given out dir it returns the legacy dry-run replayed
 * record. A missing record, an unknown case, or a model-marked chain stage
 * is refused with stop set instead of generating anything.
 */
export function runFaceRealism(input: unknown): Record<string, unknown> {
  const planned = planFaceRealismStation(input);
  if (planned.issues !== undefined) {
    const first = planned.issues[0]?.message ?? "refused";
    return {
      stationId: "face_realism",
      status: "refused",
      stop: true,
      stop_reason: first,
      plan: null,
    };
  }
  const plan = planned.plan as Record<string, unknown> & { caseId?: unknown };
  if (typeof plan["caseId"] !== "string") {
    return {
      stationId: "face_realism",
      status: "refused",
      stop: true,
      stop_reason: "missing record",
      plan: null,
    };
  }
  const raw = (input ?? {}) as { chainManifestPath?: unknown; outDir?: unknown; recordPath?: unknown };
  const outRaw = typeof raw.outDir === "string" && raw.outDir.length > 0 ? raw.outDir : null;
  if (outRaw === null) {
    return {
      stationId: "face_realism",
      status: "replayed",
      stop: true,
      plan: planned.plan,
      modelCalls: faceRealismModelCallCount(),
    };
  }
  const caseId = plan["caseId"] as string;
  const caseRec = loadCaseRecord(caseId);
  const recordChainManifest =
    typeof raw.chainManifestPath === "string" && raw.chainManifestPath.length > 0
      ? raw.chainManifestPath
      : undefined;
  const guardChainFile =
    recordChainManifest ?? caseValue<string>(caseRec, "chain_manifest");
  const guardChainAbs = path.isAbsolute(guardChainFile)
    ? guardChainFile
    : path.join(repoRoot(), guardChainFile);
  assertNoModelStage(
    readJsonFile(guardChainAbs) as { stages?: ChainStage[] },
  );
  const recordPath =
    typeof raw.recordPath === "string" && raw.recordPath.length > 0
      ? raw.recordPath
      : "tools/openclinxr/asset-pipeline/reference-set/manifest.json";
  const outDir = path.isAbsolute(outRaw) ? outRaw : path.join(repoRoot(), outRaw);
  mkdirSync(outDir, { recursive: true });
  const stages: StageRecord[] = [];
  const runStage = (fn: () => StageRecord): StageRecord => {
    try {
      return fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partial = emptyStageRecord(stages.length + 1, `stage_${stages.length + 1}`);
      partial.ran = false;
      partial.blocked = true;
      partial.blockReason = message.slice(0, 500);
      partial.gate = { pass: false, detail: `threw before completing: ${message.slice(0, 200)}` };
      return partial;
    }
  };
  stages.push(runStage(() => runStage1(caseId, caseRec, recordPath, outDir)));
  stages.push(runStage(() => runStage2(caseRec, outDir)));
  stages.push(runStage(() => runStage3(caseRec, recordChainManifest, outDir).record));
  stages.push(runStage(() => runStage4(caseRec, outDir, caseId)));
  stages.push(runStage(() => runStage5(caseRec, outDir)));
  stages.push(runStage(() => runStage6(caseRec, outDir)));
  const stage4 = stages.find((stage) => stage.stage === 4);
  if (stage4 === undefined) {
    throw new Error("stage 4 record missing: refusing to run checks without it");
  }
  stages.push(runStage(() => runStage7(caseRec, stage4, outDir)));
  const seen = new Set<string>();
  const unchainedInputs: Array<{ path: string; sha256: string; prevStageOutputs: StageIO[] }> = [];
  const prevOutputs: StageIO[] = [];
  for (const stage of stages) {
    for (const entry of stage.inputs) {
      if (!seen.has(entry.sha256)) {
        stage.unchainedInputs.push({ path: entry.path, sha256: entry.sha256, prevStageOutputs: [...prevOutputs] });
        unchainedInputs.push({
          path: entry.path,
          sha256: entry.sha256,
          prevStageOutputs: [...prevOutputs],
        });
      }
    }
    for (const entry of stage.outputs) {
      seen.add(entry.sha256);
      prevOutputs.push(entry);
    }
  }
  const failed = stages.filter((stage) => stage.blocked || !stage.gate.pass);
  return {
    stationId: "face_realism",
    status: failed.length === 0 ? "completed" : "partial",
    stop: true,
    plan: planned.plan,
    modelCalls: faceRealismModelCallCount(),
    outDir,
    stages,
    unchainedInputs,
    wallSeconds: stages.reduce((sum, stage) => sum + stage.wallSeconds, 0),
  };
}

/**
 * The face_realism station runner, reachable by station id through the runner registry.
 */
export const faceRealismRunner: StationRunner = {
  stationId: "face_realism",
  validate: (value) => factoryStationSchemas.face_realism["~standard"].validate(value),
  plan: planFaceRealismStation,
  run: (value) => runFaceRealism(value),
};
