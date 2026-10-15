// Pure face-realism replay planner: reads the stored record, never calls a model.
// No Blender, no network, no Imagine. Replay inputs only:
//   - case-reference record: tools/openclinxr/asset-pipeline/reference-set/manifest.json
//   - skin chain: tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json
//   - eye flags in tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
//     (--eye-asset high-poly --eye-cornea --eye-texture, default None keeps the
//     case-driven brown_eye.png selector path untouched)
//   - lash post-step: tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py
//   - shell flags (--eye-occlusion-shell --eye-tearline): graded not shippable
//     as-is, replayed OFF by default
//   - phenotype fields: packages/openclinxr/shared-schemas/src/face-phenotype/actor-phenotype.ts
//     (skin_asset_id, face_targets, lip_tone, reference_portrait)
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";

export const FACE_REALISM_STATION_ID = "face_realism" as const;

export const FACE_REALISM_DEFAULT_RECORD_REL =
  "tools/openclinxr/asset-pipeline/reference-set/manifest.json";
export const FACE_REALISM_DEFAULT_CHAIN_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json";
export const FACE_REALISM_LASH_STEP_REL =
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py";

export type FaceRealismInput = {
  actorId: string;
  recordPath: string;
  chainManifestPath?: string;
  outDir?: string;
};

export type FaceRealismPlan = {
  status: "replay";
  caseId: string;
  promptSha: string;
  referenceSha256: string;
  chainManifestSha: string;
  chainStages: string[];
  eyeReplay: { asset: "high-poly"; cornea: true; texture: true };
  lashPostStep: string;
  shellDefault: "off";
  phenotypeKeys: string[];
  modelCalls: 0;
};

export type FaceRealismPlanResult =
  | { status: "replay"; plan: FaceRealismPlan }
  | { status: "issues"; issues: string[] };

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveRecordPath(recordPath: string): string {
  return path.isAbsolute(recordPath) ? recordPath : path.join(repoRoot(), recordPath);
}

function resolveChainPath(chainManifestPath: string | undefined): string {
  if (chainManifestPath !== undefined && chainManifestPath.length > 0) {
    return path.isAbsolute(chainManifestPath) ? chainManifestPath : path.join(repoRoot(), chainManifestPath);
  }
  return path.join(repoRoot(), FACE_REALISM_DEFAULT_CHAIN_REL);
}

export function planFaceRealism(input: FaceRealismInput): FaceRealismPlanResult {
  const recordFile = resolveRecordPath(input.recordPath);
  if (!existsSync(recordFile)) {
    return { status: "issues", issues: [`missing record: refused (${input.recordPath})`] };
  }
  let record: { cases?: Record<string, { references?: Record<string, { prompt?: unknown; output?: { sha256?: unknown } }> }> };
  try {
    record = JSON.parse(readFileSync(recordFile, "utf8")) as typeof record;
  } catch {
    return { status: "issues", issues: ["record is not valid JSON: refused"] };
  }
  const caseIds = Object.keys(record.cases ?? {});
  if (caseIds.length === 0) {
    return { status: "issues", issues: ["record holds no cases: refused"] };
  }
  const caseId = caseIds.includes("aisha") ? "aisha" : caseIds[0]!;
  const goalFront = record.cases?.[caseId]?.references?.["goal_front"];
  if (typeof goalFront?.prompt !== "string" || typeof goalFront?.output?.sha256 !== "string") {
    return { status: "issues", issues: [`record case ${caseId} has no goal_front prompt/output sha: refused`] };
  }
  const chainFile = resolveChainPath(input.chainManifestPath);
  if (!existsSync(chainFile)) {
    return { status: "issues", issues: [`missing chain manifest: refused (${chainFile})`] };
  }
  let chain: { stages?: Array<{ name?: unknown }> };
  try {
    chain = JSON.parse(readFileSync(chainFile, "utf8")) as typeof chain;
  } catch {
    return { status: "issues", issues: ["chain manifest is not valid JSON: refused"] };
  }
  if (!Array.isArray(chain.stages) || chain.stages.length === 0) {
    return { status: "issues", issues: ["chain manifest holds no stages: refused"] };
  }
  return {
    status: "replay",
    plan: {
      status: "replay",
      caseId,
      promptSha: sha256Hex(goalFront.prompt),
      referenceSha256: goalFront.output.sha256,
      chainManifestSha: sha256Hex(readFileSync(chainFile)),
      chainStages: chain.stages.map((stage) => String(stage.name)),
      eyeReplay: { asset: "high-poly", cornea: true, texture: true },
      lashPostStep: FACE_REALISM_LASH_STEP_REL,
      shellDefault: "off",
      phenotypeKeys: ["skin_asset_id", "face_targets", "lip_tone", "reference_portrait"],
      modelCalls: 0,
    },
  };
}
