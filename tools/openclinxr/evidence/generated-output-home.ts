import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const GENERATED_OUTPUT_POLICY_PATH = "docs/openclinxr/generated-output-storage-policy-2026-06-06.md";
export const LOCAL_GENERATED_OUTPUT_ROOT = ".openclinxr";
export const LOCAL_ASSET_PRODUCTION_ROOT = ".openclinxr/asset-production";
export const LOCAL_EVIDENCE_ROOT = ".openclinxr/evidence";
export const MODEL_VETTING_PUBLIC_CAGEMATCH_ROOT = "apps/arena/model-vetting-studio/public/cagematch";

export type GeneratedOutputHome = {
  schemaVersion: "openclinxr.generated-output-home.v1";
  generatedOutputPolicyPath: typeof GENERATED_OUTPUT_POLICY_PATH;
  localRoot: typeof LOCAL_GENERATED_OUTPUT_ROOT;
  assetProductionRoot: typeof LOCAL_ASSET_PRODUCTION_ROOT;
  evidenceRoot: typeof LOCAL_EVIDENCE_ROOT;
  publicCagematchRoot: typeof MODEL_VETTING_PUBLIC_CAGEMATCH_ROOT;
  localOnly: true;
  gitSourceControlled: false;
};

export type CagematchOutputHome = {
  schemaVersion: "openclinxr.cagematch-output-home.v1";
  lane: string;
  runId: string;
  localArtifactDir: string;
  localEvidenceDir: string;
  publicMirrorDir: string;
  publicMirrorUrlPath: string;
  generatedOutputPolicyPath: typeof GENERATED_OUTPUT_POLICY_PATH;
  gitSourceControlled: false;
  runtimePromotionAllowed: false;
};

export function buildGeneratedOutputHome(): GeneratedOutputHome {
  return {
    schemaVersion: "openclinxr.generated-output-home.v1",
    generatedOutputPolicyPath: GENERATED_OUTPUT_POLICY_PATH,
    localRoot: LOCAL_GENERATED_OUTPUT_ROOT,
    assetProductionRoot: LOCAL_ASSET_PRODUCTION_ROOT,
    evidenceRoot: LOCAL_EVIDENCE_ROOT,
    publicCagematchRoot: MODEL_VETTING_PUBLIC_CAGEMATCH_ROOT,
    localOnly: true,
    gitSourceControlled: false,
  };
}

export function buildCagematchOutputHome(lane: string, runId = isoDate()): CagematchOutputHome {
  const safeLane = safePathSegment(lane);
  const safeRunId = safePathSegment(runId);
  const publicMirrorDir = path.join(MODEL_VETTING_PUBLIC_CAGEMATCH_ROOT, safeLane, safeRunId);
  return {
    schemaVersion: "openclinxr.cagematch-output-home.v1",
    lane: safeLane,
    runId: safeRunId,
    localArtifactDir: path.join(LOCAL_ASSET_PRODUCTION_ROOT, "cagematch", safeLane, safeRunId),
    localEvidenceDir: path.join(LOCAL_EVIDENCE_ROOT, "cagematch", safeLane, safeRunId),
    publicMirrorDir,
    publicMirrorUrlPath: `/${path.relative("apps/arena/model-vetting-studio/public", publicMirrorDir).replaceAll(path.sep, "/")}`,
    generatedOutputPolicyPath: GENERATED_OUTPUT_POLICY_PATH,
    gitSourceControlled: false,
    runtimePromotionAllowed: false,
  };
}

export async function ensureGeneratedOutputHome(home = buildGeneratedOutputHome()): Promise<GeneratedOutputHome> {
  await Promise.all([
    mkdir(home.assetProductionRoot, { recursive: true }),
    mkdir(home.evidenceRoot, { recursive: true }),
    mkdir(home.publicCagematchRoot, { recursive: true }),
  ]);
  return home;
}

export async function ensureCagematchOutputHome(home: CagematchOutputHome): Promise<CagematchOutputHome> {
  await Promise.all([
    mkdir(home.localArtifactDir, { recursive: true }),
    mkdir(home.localEvidenceDir, { recursive: true }),
    mkdir(home.publicMirrorDir, { recursive: true }),
  ]);
  return home;
}

async function main(): Promise<void> {
  const lane = argValue(process.argv.slice(2), "--lane") ?? "general";
  const runId = argValue(process.argv.slice(2), "--run-id") ?? isoDate();
  const outputPath = argValue(process.argv.slice(2), "--write-manifest");
  const home = await ensureCagematchOutputHome(buildCagematchOutputHome(lane, runId));
  await ensureGeneratedOutputHome();
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(home, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(home, null, 2));
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!safe) throw new Error(`Invalid generated output path segment: ${value}`);
  return safe;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
