// Face-realism station runner: replays the stored record, makes 0 model calls.
// Pattern follows hair_editor/run.ts:16-37 (validate -> plan -> dry-run record).
import path from "node:path";
import { factoryStationSchemas } from "../catalog-mod.js";
import { repoRoot } from "../repo-root.js";
import type { StationPlanResult, StationRunner } from "../runner.js";
import { FACE_REALISM_DEFAULT_CHAIN_REL, planFaceRealism, type FaceRealismInput } from "./plan.js";

/** Replay-wide model-call counter. The replay path never records a call. */
let faceRealismModelCalls = 0;

export function faceRealismModelCallCount(): number {
  return faceRealismModelCalls;
}

/** Model-call gate. Only a live model invocation may call this; replay never does. */
export function recordFaceRealismModelCall(): number {
  faceRealismModelCalls += 1;
  return faceRealismModelCalls;
}

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
      processIsolation: "in_process_replay",
    },
  };
}

export function runFaceRealism(input: unknown): Record<string, unknown> {
  const planned = planFaceRealismStation(input);
  if (planned.issues !== undefined) {
    return { stationId: "face_realism", status: "issues", stop: true, issues: planned.issues, plan: null };
  }
  const plan = planned.plan as Record<string, unknown> & { caseId?: unknown };
  if (typeof plan["caseId"] !== "string") {
    return { stationId: "face_realism", status: "refused", stop: true, stop_reason: "missing record", plan: null };
  }
  return {
    stationId: "face_realism",
    status: "replayed",
    stop: true,
    plan: planned.plan,
    modelCalls: faceRealismModelCallCount(),
  };
}

export const faceRealismRunner: StationRunner = {
  stationId: "face_realism",
  validate: (value) => factoryStationSchemas.face_realism["~standard"].validate(value),
  plan: planFaceRealismStation,
  run: (value) => runFaceRealism(value),
};
