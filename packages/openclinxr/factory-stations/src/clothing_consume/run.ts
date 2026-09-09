import { existsSync } from "node:fs";
import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";
import { spawnBlenderProcess } from "../spawn-blender.js";

export const CLOTHING_CONSUME_STAGE_REL =
  "packages/openclinxr/factory-stations/src/clothing_consume/fit_stage.py";

const REFIT_FIELDS = [
  "garmentSourceHash",
  "bodyIdentity",
  "bindingTopologyId",
  "bodyDefinition",
  "licenseToken",
  "licenseSource",
  "skinTone",
  "topologyPreserved",
  "uvPreserved",
  "displacementMeanM",
  "displacementMaxM",
  "refusalReason",
] as const;

/** Refit contract fields that were present on the validated plan input. */
export function refitContractFrom(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REFIT_FIELDS) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

export const RIG_REFIT_STAGE_REL =
  "packages/openclinxr/factory-stations/src/clothing_consume/rig_refit_stage.py";

const RIG_REFIT_FIELDS = [
  "refitGlbPath",
  "refitReportPath",
  "clipSourceGlbPath",
] as const;

/** Rig-refit expansion fields that were present on the validated plan input. */
export function rigRefitContractFrom(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RIG_REFIT_FIELDS) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

export function planClothingConsume(input: unknown): StationPlanResult {
  return planFromCatalog("clothing_consume", input, (value) => ({
    actorId: value["actorId"],
    mhcloPath: value["mhcloPath"],
    ...refitContractFrom(value),
    ...rigRefitContractFrom(value),
    bakerId:
      value["refitGlbPath"] !== undefined || value["refitReportPath"] !== undefined
        ? "rig_refit_stage"
        : "makeclothes_fit_stage",
    stageId:
      value["refitGlbPath"] !== undefined || value["refitReportPath"] !== undefined
        ? "rig_refit_stage"
        : "makeclothes_fit_stage",
    stageScript: path.join(
      repoRoot(),
      value["refitGlbPath"] !== undefined || value["refitReportPath"] !== undefined
        ? RIG_REFIT_STAGE_REL
        : CLOTHING_CONSUME_STAGE_REL,
    ),
    stageScriptRel:
      value["refitGlbPath"] !== undefined || value["refitReportPath"] !== undefined
        ? RIG_REFIT_STAGE_REL
        : CLOTHING_CONSUME_STAGE_REL,
    processIsolation: "fresh_subprocess",
  }));
}

export type ClothingConsumeRunOptions = {
  blender: string;
  garmentObj: string;
  mhBaseObj: string;
  outGlb: string;
  outGradePng: string;
  report: string;
  garmentMeshName: string;
  annyObj?: string;
  // Refit contract passthrough to fit_stage.py flags (all optional).
  // bodyDefinition is JSON { macros?, statureTargetM?, bodyAssetId? }; the baker
  // builds the actor's body from it instead of the station-default body.
  garmentSourceHash?: string;
  bodyIdentity?: string;
  bindingTopologyId?: string;
  bodyDefinition?: string;
  licenseToken?: string;
  licenseSource?: string;
  skinTone?: string;
  extraStageFlags?: string[];
  cwd?: string;
  timeoutMs?: number;
};

/**
 * Unique spawn of fit_stage.py. Tests must call plan(), not run().
 */
export async function runClothingConsume(
  input: unknown,
  options: ClothingConsumeRunOptions,
): Promise<Record<string, unknown>> {
  const planned = planClothingConsume(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`fit stage script missing: ${stageScript}`);
  }
  const mhcloPath = String(planned.plan["mhcloPath"]);
  const blenderArgs = [
    "--background",
    "--python",
    stageScript,
    "--",
    "--mhclo",
    mhcloPath,
    "--garment-obj",
    options.garmentObj,
    "--mh-base-obj",
    options.mhBaseObj,
    "--out-glb",
    options.outGlb,
    "--out-grade-png",
    options.outGradePng,
    "--report",
    options.report,
    ...(options.extraStageFlags ?? []),
    "--garment-mesh-name",
    options.garmentMeshName,
  ];
  if (options.annyObj) blenderArgs.push("--anny-obj", options.annyObj);
  // Plan-carried refit contract: options override, plan fills the rest.
  const flagFrom = (opt: string | undefined, key: string): string | undefined =>
    opt !== undefined ? opt : (typeof planned.plan[key] === "string" ? String(planned.plan[key]) : undefined);
  const garmentSourceHash = flagFrom(options.garmentSourceHash, "garmentSourceHash");
  const bodyIdentity = flagFrom(options.bodyIdentity, "bodyIdentity");
  const bindingTopologyId = flagFrom(options.bindingTopologyId, "bindingTopologyId");
  const bodyDefinition = flagFrom(options.bodyDefinition, "bodyDefinition");
  const skinTone = flagFrom(options.skinTone, "skinTone");
  if (garmentSourceHash !== undefined) blenderArgs.push("--garment-source-hash", garmentSourceHash);
  if (bodyIdentity !== undefined) blenderArgs.push("--body-identity", bodyIdentity);
  if (bindingTopologyId !== undefined) blenderArgs.push("--binding-topology-id", bindingTopologyId);
  if (bodyDefinition !== undefined) blenderArgs.push("--body-definition", bodyDefinition);
  if (skinTone !== undefined) blenderArgs.push("--skin-tone", skinTone);
  if (options.licenseToken !== undefined) blenderArgs.push("--license-token", options.licenseToken);
  if (options.licenseSource !== undefined) blenderArgs.push("--license-source", options.licenseSource);

  const result = await spawnBlenderProcess(options.blender, blenderArgs, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? 600_000,
  });
  return {
    stationId: "clothing_consume",
    stageScript,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export type RigRefitRunOptions = {
  blender: string;
  refitGlb: string;
  refitReport: string;
  bodyDefinition: string;
  outGlb: string;
  report: string;
  mhclo?: string;
  clipSourceGlb?: string;
  cwd?: string;
  timeoutMs?: number;
};

/**
 * Unique spawn of rig_refit_stage.py. Tests must call plan(), not run().
 * Consumes a refit report + GLB and the actor's body definition; binds the
 * refitted garment to the actor's armature and extends the station report
 * with the rigging block (joint count, weight source per mesh, clips carried).
 * Refuses on incompatible skeleton rather than shipping a mislabeled static.
 */
export async function runRigRefit(
  input: unknown,
  options: RigRefitRunOptions,
): Promise<Record<string, unknown>> {
  const planned = planClothingConsume(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  const stageId = String(planned.plan["stageId"]);
  if (stageId !== "rig_refit_stage") {
    throw new Error(
      "runRigRefit requires refitGlbPath + refitReportPath on the plan input (rig_refit_stage)",
    );
  }
  const stageScript = String(planned.plan["stageScript"]);
  if (!existsSync(stageScript)) {
    throw new Error(`rig refit stage script missing: ${stageScript}`);
  }
  const mhcloPath = String(planned.plan["mhcloPath"]);
  const planRefitGlb =
    typeof planned.plan["refitGlbPath"] === "string" ? String(planned.plan["refitGlbPath"]) : undefined;
  const planRefitReport =
    typeof planned.plan["refitReportPath"] === "string" ? String(planned.plan["refitReportPath"]) : undefined;
  const planClip =
    typeof planned.plan["clipSourceGlbPath"] === "string" ? String(planned.plan["clipSourceGlbPath"]) : undefined;
  const blenderArgs = [
    "--background",
    "--python",
    stageScript,
    "--",
    "--refit-glb",
    options.refitGlb || planRefitGlb || "",
    "--refit-report",
    options.refitReport || planRefitReport || "",
    "--body-definition",
    options.bodyDefinition,
    "--mhclo",
    options.mhclo ?? mhcloPath,
    "--out-glb",
    options.outGlb,
    "--report",
    options.report,
  ];
  const clipSource = options.clipSourceGlb ?? planClip;
  if (clipSource) blenderArgs.push("--clip-source-glb", clipSource);
  const result = await spawnBlenderProcess(options.blender, blenderArgs, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? 600_000,
  });
  return {
    stationId: "clothing_consume",
    stageScript,
    stageId,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export const clothingConsumeRunner: StationRunner = {
  stationId: "clothing_consume",
  validate: (value) => factoryStationSchemas.clothing_consume["~standard"].validate(value),
  plan: planClothingConsume,
  run: (value) => runClothingConsume(value, {
    blender: "blender",
    garmentObj: "",
    mhBaseObj: "",
    outGlb: "",
    outGradePng: "",
    report: "",
    garmentMeshName: "",
  }),
};
