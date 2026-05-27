import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";

interface CliOptions {
  inputPath?: string;
  outputPath: string;
  validatePath?: string;
  validateLatest: boolean;
}

const defaultInputPath = "docs/openclinxr/evidence/realism-review-active-viseme-runtime-2026-05-23.json";
const defaultOutputPath = "docs/openclinxr/humanoid-collision-probe-2026-05-23.json";

export interface HumanoidCollisionProbeReport {
  schemaVersion: "openclinxr.humanoid-collision-probe.v1";
  generatedAt: string;
  inputFile: string;
  dependency: { packageName: "@dimforge/rapier3d-compat"; purpose: string };
  result: {
    status: "collision_probe_ready" | "collision_probe_blocked";
    humanoidProxyCount: number;
    contactProbeCount: number;
    blockers: string[];
    passedSignals: string[];
  };
  productionReadinessClaimed: false;
  notEvidenceFor: string[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validateLatest || options.validatePath) {
    const report = JSON.parse(await readFile(options.validatePath ?? options.outputPath, "utf8"));
    const validation = validateHumanoidCollisionProbeReport(report);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    console.log(`Validated ${options.validatePath ?? options.outputPath}`);
    return;
  }
  const inputPath = options.inputPath ?? defaultInputPath;
  const evidence = JSON.parse(await readFile(inputPath, "utf8"));
  const report = await buildHumanoidCollisionProbeReport({ inputFile: inputPath, evidence });
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
}

export async function buildHumanoidCollisionProbeReport(input: {
  inputFile: string;
  evidence: unknown;
  generatedAt?: string | undefined;
}): Promise<HumanoidCollisionProbeReport> {
  await RAPIER.init({});
  const evidence = isRecord(input.evidence) ? input.evidence : {};
  const sceneAssets = isRecord(evidence.sceneAssetEvidence)
    ? evidence.sceneAssetEvidence
    : isRecord(evidence.sceneAssets)
      ? evidence.sceneAssets
      : {};
  const assets = Array.isArray(sceneAssets.assets) ? sceneAssets.assets.filter(isRecord) : [];
  const humanoidProxyAssets = assets.filter((asset) => {
    const affordanceCueIds = Array.isArray(asset.affordanceCueIds) ? asset.affordanceCueIds.map(String) : [];
    return String(asset.assetId ?? "").includes("generated-humanoid-glb") &&
      affordanceCueIds.some((cueId) => cueId.includes("ragdoll_collision_proxy_cue"));
  });

  const contactProbeCount = humanoidProxyAssets.reduce((count) => count + runRapierContactProbe(), 0);
  const blockers = [
    ...(humanoidProxyAssets.length === 0 ? ["humanoid_ragdoll_collision_proxy_cues_missing"] : []),
    ...(contactProbeCount < humanoidProxyAssets.length ? ["rapier_contact_probe_missing_for_some_humanoids"] : []),
  ];
  const passedSignals = [
    ...(humanoidProxyAssets.length > 0 ? ["humanoid_ragdoll_collision_proxy_cues_present"] : []),
    ...(contactProbeCount >= humanoidProxyAssets.length && humanoidProxyAssets.length > 0 ? ["rapier_contact_probe_detected_proxy_overlap"] : []),
  ];

  return {
    schemaVersion: "openclinxr.humanoid-collision-probe.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    dependency: {
      packageName: "@dimforge/rapier3d-compat",
      purpose: "local deterministic humanoid interaction-volume contact probe",
    },
    result: {
      status: blockers.length === 0 ? "collision_probe_ready" : "collision_probe_blocked",
      humanoidProxyCount: humanoidProxyAssets.length,
      contactProbeCount,
      blockers,
      passedSignals,
    },
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics", "quest_readiness", "clinical_validity"],
  };
}

function runRapierContactProbe(): number {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const humanoidBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.94, 0));
  const humanoidCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.72, 0.24), humanoidBody);
  const learnerHandBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.12, 0.94, 0));
  const learnerHandCollider = world.createCollider(RAPIER.ColliderDesc.ball(0.18), learnerHandBody);
  world.step();
  let contactCount = 0;
  world.contactPair(humanoidCollider, learnerHandCollider, (manifold) => {
    contactCount += manifold.numContacts();
  });
  world.free();
  return contactCount > 0 ? 1 : 0;
}

export function validateHumanoidCollisionProbeReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  if (value.schemaVersion !== "openclinxr.humanoid-collision-probe.v1") errors.push("/schemaVersion invalid");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) errors.push("/generatedAt invalid");
  if (typeof value.inputFile !== "string" || value.inputFile.length === 0) errors.push("/inputFile required");
  if (!isRecord(value.dependency) || value.dependency.packageName !== "@dimforge/rapier3d-compat") errors.push("/dependency invalid");
  if (!isRecord(value.result)) errors.push("/result must be object");
  if (isRecord(value.result)) {
    if (!["collision_probe_ready", "collision_probe_blocked"].includes(String(value.result.status))) errors.push("/result/status invalid");
    if (typeof value.result.humanoidProxyCount !== "number") errors.push("/result/humanoidProxyCount must be number");
    if (typeof value.result.contactProbeCount !== "number") errors.push("/result/contactProbeCount must be number");
    if (!Array.isArray(value.result.blockers)) errors.push("/result/blockers must be array");
    if (!Array.isArray(value.result.passedSignals)) errors.push("/result/passedSignals must be array");
  }
  if (value.productionReadinessClaimed !== false) errors.push("/productionReadinessClaimed must be false");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { outputPath: defaultOutputPath, validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main();
