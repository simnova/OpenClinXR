import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createModelAssistProvider,
  type ModelAssistResponse,
  validateModelAssistResponse,
} from "./model-assist-provider.js";

export type MoonbridgeDeepSeekDirectProbe = {
  schemaVersion: "openclinxr.moonbridge-deepseek-direct-probe.v1";
  generatedAt: string;
  providerBoundary: "local_http_bridge_exception_approved_by_operator";
  baseUrl: string;
  endpoint: "/v1/responses";
  providerId: "moonbridge_deepseek";
  requestShape: "openai_responses_json";
  responseShape: "openai_responses_json" | "invalid_or_unavailable";
  requestedModel: "moonbridge";
  responseModel: string;
  status: "completed" | "blocked";
  promptKind: "bounded_policy_contract_probe";
  outputText: string;
  latencyMs: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  grade: {
    result: "useful_first_pass" | "not_worth_using" | "blocked";
    reason: string;
    recommendedUse: "cost_efficient_read_only_review_and_contract_probe" | "skip_until_bridge_recovers";
    upgradeToFrontierWhen: string[];
  };
  providerExecutionAllowed: true;
  externalPaidApiUsed: false;
  credentialsRequired: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "moonbridge_deepseek_local_agent_assist_not_runtime_or_readiness";
  notEvidenceFor: [
    "runtime_readiness",
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "learner_launch_readiness",
  ];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:38440/v1";
const DEFAULT_OUTPUT = path.join("docs", "openclinxr", "moonbridge-deepseek-direct-probe-2026-06-05.json");
const DEFAULT_PROMPT = [
  "You are reviewing this OpenClinXR local model-assist contract: Moonbridge is a local HTTP bridge on 127.0.0.1, requested as model moonbridge, used only for cheap first-pass read-only advisory review and bounded contract probes.",
  "It must not execute runtime assets, clear readiness gates, request credentials, use external paid APIs, or make clinical, scoring, Quest, learner, production, or asset-readiness claims.",
  "Reply in one concise sentence with whether this contract is acceptable for first-pass advisory review only and name the key boundary.",
  "Do not make clinical, scoring, Quest, learner, production, or asset-readiness claims.",
].join(" ");

const NOT_EVIDENCE_FOR = [
  "runtime_readiness",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
  "learner_launch_readiness",
] as const satisfies MoonbridgeDeepSeekDirectProbe["notEvidenceFor"];

export async function buildMoonbridgeDeepSeekDirectProbe(input: {
  baseUrl?: string;
  prompt?: string;
  now?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<MoonbridgeDeepSeekDirectProbe> {
  const baseUrl = (input.baseUrl ?? process.env["OPENCLINXR_MOONBRIDGE_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const provider = createModelAssistProvider({
    providerId: "moonbridge_deepseek",
    baseUrl,
    model: "moonbridge",
    fetchImpl: input.fetchImpl,
  });
  const providerResponse = await provider.run({
    taskKind: "bounded_policy_contract_probe",
    prompt: input.prompt ?? DEFAULT_PROMPT,
    maxOutputTokens: 1024,
  });
  const validation = validateModelAssistResponse(providerResponse);
  if (!validation.ok) return blockedProbeFromProvider(providerResponse, input.now, validation.errors.join("; "));
  return {
    schemaVersion: "openclinxr.moonbridge-deepseek-direct-probe.v1",
    generatedAt: input.now ?? new Date().toISOString(),
    providerBoundary: "local_http_bridge_exception_approved_by_operator",
    baseUrl,
    endpoint: "/v1/responses",
    providerId: "moonbridge_deepseek",
    requestShape: "openai_responses_json",
    responseShape: providerResponse.responseShape === "openai_responses_json" ? "openai_responses_json" : "invalid_or_unavailable",
    requestedModel: "moonbridge",
    responseModel: providerResponse.responseModel,
    status: providerResponse.status,
    promptKind: "bounded_policy_contract_probe",
    outputText: providerResponse.outputText,
    latencyMs: providerResponse.latencyMs,
    usage: providerResponse.usage,
    grade: providerResponse.grade,
    providerExecutionAllowed: true,
    externalPaidApiUsed: false,
    credentialsRequired: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "moonbridge_deepseek_local_agent_assist_not_runtime_or_readiness",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function validateMoonbridgeDeepSeekDirectProbe(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value["schemaVersion"], "openclinxr.moonbridge-deepseek-direct-probe.v1", "/schemaVersion", errors);
  requireLiteral(value["providerBoundary"], "local_http_bridge_exception_approved_by_operator", "/providerBoundary", errors);
  requireLiteral(value["providerId"], "moonbridge_deepseek", "/providerId", errors);
  requireLiteral(value["endpoint"], "/v1/responses", "/endpoint", errors);
  requireLiteral(value["requestShape"], "openai_responses_json", "/requestShape", errors);
  requireLiteral(value["requestedModel"], "moonbridge", "/requestedModel", errors);
  if (value["responseShape"] !== "openai_responses_json" && value["responseShape"] !== "invalid_or_unavailable") {
    errors.push("/responseShape must be openai_responses_json or invalid_or_unavailable");
  }
  requireLiteral(value["externalPaidApiUsed"], false, "/externalPaidApiUsed", errors);
  requireLiteral(value["credentialsRequired"], false, "/credentialsRequired", errors);
  for (const key of [
    "runtimeExecutionAllowed",
    "learnerLaunchAllowed",
    "questEvidenceRefreshAllowed",
    "productionAssetReadinessClaimed",
    "clinicalValidityClaimed",
    "scoringValidityClaimed",
  ]) {
    requireLiteral(value[key], false, `/${key}`, errors);
  }
  requireLiteral(value["claimBoundary"], "moonbridge_deepseek_local_agent_assist_not_runtime_or_readiness", "/claimBoundary", errors);
  requireArrayIncludes(value["notEvidenceFor"], "production_asset_readiness", "/notEvidenceFor", errors);
  requireArrayIncludes(value["notEvidenceFor"], "clinical_validity", "/notEvidenceFor", errors);
  requireArrayIncludes(value["notEvidenceFor"], "scoring_validity", "/notEvidenceFor", errors);
  if (isRecord(value["grade"])) {
    const result = value["grade"]["result"];
    if (result !== "useful_first_pass" && result !== "not_worth_using" && result !== "blocked") {
      errors.push("/grade/result must be useful_first_pass, not_worth_using, or blocked");
    }
  } else {
    errors.push("/grade must be object");
  }
  return { ok: errors.length === 0, errors };
}

async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.validatePath) {
    const validation = validateMoonbridgeDeepSeekDirectProbe(JSON.parse(await readFile(options.validatePath, "utf8")) as unknown);
    if (!validation.ok) {
      process.stderr.write(`Moonbridge DeepSeek direct probe validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${options.validatePath}`);
    return;
  }
  const probe = await buildMoonbridgeDeepSeekDirectProbe({ baseUrl: options.baseUrl ?? undefined, prompt: options.prompt ?? undefined });
  await writeFile(options.outputPath, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.outputPath}`);
  if (probe.status === "blocked" || probe.grade.result === "not_worth_using") process.exitCode = 1;
}

function blockedProbe(input: { baseUrl: string; latencyMs: number; now?: string; reason: string }): MoonbridgeDeepSeekDirectProbe {
  return {
    schemaVersion: "openclinxr.moonbridge-deepseek-direct-probe.v1",
    generatedAt: input.now ?? new Date().toISOString(),
    providerBoundary: "local_http_bridge_exception_approved_by_operator",
    baseUrl: input.baseUrl,
    endpoint: "/v1/responses",
    providerId: "moonbridge_deepseek",
    requestShape: "openai_responses_json",
    responseShape: "invalid_or_unavailable",
    requestedModel: "moonbridge",
    responseModel: "unknown",
    status: "blocked",
    promptKind: "bounded_policy_contract_probe",
    outputText: "",
    latencyMs: input.latencyMs,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    grade: {
      result: "blocked",
      reason: input.reason,
      recommendedUse: "skip_until_bridge_recovers",
      upgradeToFrontierWhen: ["Moonbridge local bridge is unavailable or returns invalid JSON."],
    },
    providerExecutionAllowed: true,
    externalPaidApiUsed: false,
    credentialsRequired: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "moonbridge_deepseek_local_agent_assist_not_runtime_or_readiness",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

function blockedProbeFromProvider(providerResponse: ModelAssistResponse, now: string | undefined, reason: string): MoonbridgeDeepSeekDirectProbe {
  return blockedProbe({
    baseUrl: providerResponse.baseUrl ?? DEFAULT_BASE_URL,
    latencyMs: providerResponse.latencyMs,
    now,
    reason: `model_assist_boundary_invalid: ${reason}`,
  });
}

function parseCliOptions(args: string[]): { outputPath: string; validatePath: string | null; baseUrl: string | null; prompt: string | null } {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let outputPath = DEFAULT_OUTPUT;
  let validatePath: string | null = null;
  let baseUrl: string | null = null;
  let prompt: string | null = null;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    } else if (arg === "--validate" && next) {
      validatePath = next;
      index += 1;
    } else if (arg === "--validate-latest") {
      validatePath = DEFAULT_OUTPUT;
    } else if (arg === "--base-url" && next) {
      baseUrl = next;
      index += 1;
    } else if (arg === "--prompt" && next) {
      prompt = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return { outputPath, validatePath, baseUrl, prompt };
}

function requireLiteral<T>(value: unknown, expected: T, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireArrayIncludes(value: unknown, expected: string, pathName: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pathName} must include ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
