import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

const execFileAsync = promisify(execFile);
const defaultOutputPath = `docs/openclinxr/anny-local-runtime-probe-${new Date().toISOString().slice(0, 10)}.json`;

type CliOptions = {
  outputPath?: string;
  pythonExecutable: string;
  validateLatest: boolean;
  validatePath?: string;
};

type PythonModuleStatus = {
  status: "available" | "missing";
  location: string | null;
};

export type AnnyLocalRuntimeProbeReport = {
  schemaVersion: "openclinxr.anny-local-runtime-probe.v1";
  generatedAt: string;
  claimScope: "local_anny_import_availability_only";
  providerBoundary: {
    providerId: "anny_local";
    localOnly: true;
    pythonOnlyImportProbe: true;
    annyForwardPassAttempted: false;
    modelWeightsLoaded: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialsUsed: false;
  };
  sourceRecord: {
    path: "sources/anny-github-2026.json";
    sourceId: string;
    title: string;
    licenseClaimSupported: string | null;
    questRuntimeClaimSupported: false;
    animationOrClothingClaimSupported: false;
  };
  python: {
    executable: string;
    version: string | null;
    modules: {
      anny: PythonModuleStatus;
      torch: PythonModuleStatus;
      numpy: PythonModuleStatus;
    };
  };
  readiness: {
    status: "blocked_missing_anny_module" | "import_probe_available_weights_not_loaded";
    localImportAvailable: boolean;
    realAnnyWeightsUsed: false;
    readyForCandidateGeneration: false;
    blockers: string[];
    nextSafeStep: string;
  };
  notEvidenceFor: [
    "real_anny_model_output",
    "anny_forward_pass_success",
    "provider_runtime_readiness",
    "generated_asset_quality",
    "b_plus_visual_realism_gate",
    "production_asset_readiness",
    "quest_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

type SourceRecord = {
  source_id?: unknown;
  title?: unknown;
  claims_supported?: unknown;
  claims_not_supported?: unknown;
};

type PythonProbeObservation = {
  executable: string;
  version: string | null;
  modules: AnnyLocalRuntimeProbeReport["python"]["modules"];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/anny-local-runtime-probe-*.json");
    if (!validatePath) throw new Error("Missing Anny local runtime probe report to validate.");
    const validation = validateAnnyLocalRuntimeProbeReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = await buildAnnyLocalRuntimeProbeReport({
    pythonExecutable: options.pythonExecutable,
  });
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export async function buildAnnyLocalRuntimeProbeReport(input: {
  generatedAt?: string;
  pythonExecutable?: string;
  sourceRecord?: SourceRecord;
  pythonObservation?: PythonProbeObservation;
} = {}): Promise<AnnyLocalRuntimeProbeReport> {
  const sourceRecord = input.sourceRecord ?? await readJson<SourceRecord>("sources/anny-github-2026.json");
  const python = input.pythonObservation ?? await probePython(input.pythonExecutable ?? "python3");
  const annyAvailable = python.modules.anny.status === "available";
  const blockers = unique([
    annyAvailable ? undefined : "python_module_anny_missing",
    python.modules.torch.status === "available" ? undefined : "python_module_torch_missing",
    python.modules.numpy.status === "available" ? undefined : "python_module_numpy_missing",
    "real_anny_weights_manifest_not_loaded",
    "case_actor_parameters_not_bound_to_real_anny_forward_pass",
  ]);

  return {
    schemaVersion: "openclinxr.anny-local-runtime-probe.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "local_anny_import_availability_only",
    providerBoundary: {
      providerId: "anny_local",
      localOnly: true,
      pythonOnlyImportProbe: true,
      annyForwardPassAttempted: false,
      modelWeightsLoaded: false,
      externalNetworkUsed: false,
      paidApiUsed: false,
      credentialsUsed: false,
    },
    sourceRecord: {
      path: "sources/anny-github-2026.json",
      sourceId: String(sourceRecord.source_id ?? "unknown"),
      title: String(sourceRecord.title ?? "unknown"),
      licenseClaimSupported: stringArray(sourceRecord.claims_supported).find((claim) => /apache-2\.0/i.test(claim)) ?? null,
      questRuntimeClaimSupported: false,
      animationOrClothingClaimSupported: false,
    },
    python,
    readiness: {
      status: annyAvailable ? "import_probe_available_weights_not_loaded" : "blocked_missing_anny_module",
      localImportAvailable: annyAvailable,
      realAnnyWeightsUsed: false,
      readyForCandidateGeneration: false,
      blockers,
      nextSafeStep: annyAvailable
        ? "Add a local-only manifest for Anny weights/source checkout, then run a no-commit real forward-pass smoke outside runtime promotion."
        : "Install or vendor the Apache-2.0 Anny package/source in an approved local-only path, then rerun this import probe before any forward pass.",
    },
    notEvidenceFor: [
      "real_anny_model_output",
      "anny_forward_pass_success",
      "provider_runtime_readiness",
      "generated_asset_quality",
      "b_plus_visual_realism_gate",
      "production_asset_readiness",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateAnnyLocalRuntimeProbeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.anny-local-runtime-probe.v1", "/schemaVersion", errors);
  requireLiteral(value["claimScope"], "local_anny_import_availability_only", "/claimScope", errors);
  const providerBoundary = value["providerBoundary"];
  if (!isRecord(providerBoundary)) errors.push("/providerBoundary must be object");
  else {
    requireLiteral(providerBoundary["localOnly"], true, "/providerBoundary/localOnly", errors);
    requireLiteral(providerBoundary["pythonOnlyImportProbe"], true, "/providerBoundary/pythonOnlyImportProbe", errors);
    requireLiteral(providerBoundary["annyForwardPassAttempted"], false, "/providerBoundary/annyForwardPassAttempted", errors);
    requireLiteral(providerBoundary["modelWeightsLoaded"], false, "/providerBoundary/modelWeightsLoaded", errors);
    requireLiteral(providerBoundary["externalNetworkUsed"], false, "/providerBoundary/externalNetworkUsed", errors);
    requireLiteral(providerBoundary["paidApiUsed"], false, "/providerBoundary/paidApiUsed", errors);
  }
  const python = value["python"];
  if (!isRecord(python)) errors.push("/python must be object");
  else {
    requireString(python["executable"], "/python/executable", errors);
    const modules = python["modules"];
    if (!isRecord(modules)) errors.push("/python/modules must be object");
    else for (const moduleName of ["anny", "torch", "numpy"]) validateModuleStatus(modules[moduleName], `/python/modules/${moduleName}`, errors);
  }
  const readiness = value["readiness"];
  if (!isRecord(readiness)) errors.push("/readiness must be object");
  else {
    requireLiteral(readiness["realAnnyWeightsUsed"], false, "/readiness/realAnnyWeightsUsed", errors);
    requireLiteral(readiness["readyForCandidateGeneration"], false, "/readiness/readyForCandidateGeneration", errors);
    requireStringArray(readiness["blockers"], "/readiness/blockers", errors);
  }
  for (const gate of ["real_anny_model_output", "anny_forward_pass_success", "production_asset_readiness", "quest_readiness", "learner_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value["notEvidenceFor"], gate, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function probePython(pythonExecutable: string): Promise<PythonProbeObservation> {
  const script = [
    "import importlib.util, json, sys",
    "mods = {}",
    "for name in ['anny', 'torch', 'numpy']:",
    "    spec = importlib.util.find_spec(name)",
    "    mods[name] = {'status': 'available' if spec else 'missing', 'location': spec.origin if spec else None}",
    "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'modules': mods}))",
  ].join("\n");
  try {
    const result = await execFileAsync(pythonExecutable, ["-c", script], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout) as PythonProbeObservation;
  } catch {
    return {
      executable: pythonExecutable,
      version: null,
      modules: {
        anny: { status: "missing", location: null },
        torch: { status: "missing", location: null },
        numpy: { status: "missing", location: null },
      },
    };
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { pythonExecutable: "python3", validateLatest: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--python") options.pythonExecutable = requireNext(args, ++index, arg);
    else if (arg === "--validate") options.validatePath = requireNext(args, ++index, arg);
    else if (arg === "--validate-latest") options.validateLatest = true;
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function validateModuleStatus(value: unknown, pointer: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pointer} must be object`);
    return;
  }
  if (!["available", "missing"].includes(String(value["status"]))) errors.push(`${pointer}/status invalid`);
  if (value["location"] !== null && typeof value["location"] !== "string") errors.push(`${pointer}/location must be string or null`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, pointer: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pointer} required`);
}

function requireLiteral(value: unknown, expected: unknown, pointer: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pointer} must be ${JSON.stringify(expected)}`);
}

function requireStringArray(value: unknown, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) errors.push(`${pointer} must be string array`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pointer: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pointer} must include ${expected}`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
