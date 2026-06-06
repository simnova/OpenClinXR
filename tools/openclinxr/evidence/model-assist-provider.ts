export type ModelAssistProviderBoundary = {
  boundaryClass: "local_execution" | "approval_gated_external" | "blocked";
  localOnly: boolean;
  localHttpBridgeExceptionApproved: boolean;
  externalNetworkUsed: false;
  externalPaidApiUsed: false;
  credentialsRequired: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "local_model_assist_not_runtime_or_readiness";
  notEvidenceFor: [
    "runtime_readiness",
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "learner_launch_readiness",
  ];
};

export type ModelAssistProviderConfig = {
  providerId: "moonbridge_deepseek" | "disabled";
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

export type ModelAssistRequest = {
  taskKind: "bounded_policy_contract_probe" | "asset_pipeline_first_pass_review";
  prompt: string;
  maxOutputTokens?: number;
};

export type ModelAssistResponse = {
  providerId: "moonbridge_deepseek" | "disabled";
  providerLabel: string;
  status: "completed" | "blocked";
  boundary: ModelAssistProviderBoundary;
  endpoint: "/v1/responses" | null;
  requestShape: "openai_responses_json" | "disabled";
  responseShape: "openai_responses_json" | "invalid_or_unavailable" | "disabled";
  baseUrl: string | null;
  requestedModel: string | null;
  responseModel: string;
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
};

export type ModelAssistProvider = {
  providerId: ModelAssistResponse["providerId"];
  run(request: ModelAssistRequest): Promise<ModelAssistResponse>;
};

const defaultMoonbridgeBaseUrl = "http://127.0.0.1:38440/v1";
const protectedOverclaimPattern = /clinical validity|production ready|quest ready|learner ready|scoring valid/i;
const vagueOrUnusablePattern = /cannot assess|no basis|no public references|insufficient context/i;

export function createModelAssistProvider(config: ModelAssistProviderConfig): ModelAssistProvider {
  if (config.providerId === "moonbridge_deepseek") return new MoonbridgeDeepSeekModelAssistProvider(config);
  return new DisabledModelAssistProvider();
}

export function localModelAssistBoundary(): ModelAssistProviderBoundary {
  return {
    boundaryClass: "local_execution",
    localOnly: true,
    localHttpBridgeExceptionApproved: true,
    externalNetworkUsed: false,
    externalPaidApiUsed: false,
    credentialsRequired: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "local_model_assist_not_runtime_or_readiness",
    notEvidenceFor: [
      "runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ],
  };
}

export function validateModelAssistResponse(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  if (value["providerId"] !== "moonbridge_deepseek" && value["providerId"] !== "disabled") {
    errors.push("/providerId must be moonbridge_deepseek or disabled");
  }
  if (value["status"] !== "completed" && value["status"] !== "blocked") errors.push("/status must be completed or blocked");
  const boundary = value["boundary"];
  if (!isRecord(boundary)) errors.push("/boundary must be object");
  else {
    requireLiteral(boundary["localOnly"], true, "/boundary/localOnly", errors);
    requireLiteral(boundary["externalNetworkUsed"], false, "/boundary/externalNetworkUsed", errors);
    requireLiteral(boundary["externalPaidApiUsed"], false, "/boundary/externalPaidApiUsed", errors);
    requireLiteral(boundary["credentialsRequired"], false, "/boundary/credentialsRequired", errors);
    requireLiteral(boundary["runtimeExecutionAllowed"], false, "/boundary/runtimeExecutionAllowed", errors);
    requireLiteral(boundary["learnerLaunchAllowed"], false, "/boundary/learnerLaunchAllowed", errors);
    requireLiteral(boundary["questEvidenceRefreshAllowed"], false, "/boundary/questEvidenceRefreshAllowed", errors);
    requireLiteral(boundary["productionAssetReadinessClaimed"], false, "/boundary/productionAssetReadinessClaimed", errors);
    requireLiteral(boundary["clinicalValidityClaimed"], false, "/boundary/clinicalValidityClaimed", errors);
    requireLiteral(boundary["scoringValidityClaimed"], false, "/boundary/scoringValidityClaimed", errors);
    requireArrayIncludes(boundary["notEvidenceFor"], "production_asset_readiness", "/boundary/notEvidenceFor", errors);
    requireArrayIncludes(boundary["notEvidenceFor"], "clinical_validity", "/boundary/notEvidenceFor", errors);
    requireArrayIncludes(boundary["notEvidenceFor"], "scoring_validity", "/boundary/notEvidenceFor", errors);
  }
  const grade = value["grade"];
  if (!isRecord(grade)) errors.push("/grade must be object");
  else if (grade["result"] !== "useful_first_pass" && grade["result"] !== "not_worth_using" && grade["result"] !== "blocked") {
    errors.push("/grade/result must be useful_first_pass, not_worth_using, or blocked");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

class MoonbridgeDeepSeekModelAssistProvider implements ModelAssistProvider {
  providerId = "moonbridge_deepseek" as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ModelAssistProviderConfig) {
    this.baseUrl = (config.baseUrl ?? process.env["OPENCLINXR_MOONBRIDGE_BASE_URL"] ?? defaultMoonbridgeBaseUrl).replace(/\/+$/, "");
    this.model = config.model ?? process.env["OPENCLINXR_MOONBRIDGE_MODEL"] ?? "moonbridge";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async run(request: ModelAssistRequest): Promise<ModelAssistResponse> {
    const started = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens ?? 1024,
      }),
    });
    const latencyMs = Date.now() - started;
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      return blockedProviderResponse({
        providerId: this.providerId,
        providerLabel: "Moonbridge DeepSeek local HTTP bridge",
        endpoint: "/v1/responses",
        baseUrl: this.baseUrl,
        requestedModel: this.model,
        latencyMs,
        reason: `moonbridge_invalid_json_${response.status}`,
      });
    }
    if (!response.ok || !isRecord(payload)) {
      return blockedProviderResponse({
        providerId: this.providerId,
        providerLabel: "Moonbridge DeepSeek local HTTP bridge",
        endpoint: "/v1/responses",
        baseUrl: this.baseUrl,
        requestedModel: this.model,
        latencyMs,
        reason: `moonbridge_http_${response.status}`,
      });
    }
    const outputText = extractResponseText(payload);
    const usage = isRecord(payload["usage"]) ? payload["usage"] : {};
    const useful = outputText.length > 0
      && !protectedOverclaimPattern.test(outputText)
      && !vagueOrUnusablePattern.test(outputText);
    return {
      providerId: this.providerId,
      providerLabel: "Moonbridge DeepSeek local HTTP bridge",
  status: "completed",
      boundary: localModelAssistBoundary(),
      endpoint: "/v1/responses",
      requestShape: "openai_responses_json",
      responseShape: "openai_responses_json",
      baseUrl: this.baseUrl,
      requestedModel: this.model,
      responseModel: typeof payload["model"] === "string" ? payload["model"] : "unknown",
      outputText,
      latencyMs,
      usage: {
        inputTokens: typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : null,
        outputTokens: typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : null,
        totalTokens: typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : null,
      },
      grade: gradeModelAssistOutput(useful),
    };
  }
}

class DisabledModelAssistProvider implements ModelAssistProvider {
  providerId = "disabled" as const;

  async run(): Promise<ModelAssistResponse> {
    return blockedProviderResponse({
      providerId: this.providerId,
      providerLabel: "Disabled model assist provider",
      endpoint: null,
      baseUrl: null,
      requestedModel: null,
      latencyMs: 0,
      reason: "model_assist_provider_disabled",
    });
  }
}

function blockedProviderResponse(input: {
  providerId: ModelAssistResponse["providerId"];
  providerLabel: string;
  endpoint: ModelAssistResponse["endpoint"];
  baseUrl: string | null;
  requestedModel: string | null;
  latencyMs: number;
  reason: string;
}): ModelAssistResponse {
  return {
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    status: "blocked",
    boundary: localModelAssistBoundary(),
    endpoint: input.endpoint,
    requestShape: input.endpoint === null ? "disabled" : "openai_responses_json",
    responseShape: input.endpoint === null ? "disabled" : "invalid_or_unavailable",
    baseUrl: input.baseUrl,
    requestedModel: input.requestedModel,
    responseModel: "unknown",
    outputText: "",
    latencyMs: input.latencyMs,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    grade: {
      result: "blocked",
      reason: input.reason,
      recommendedUse: "skip_until_bridge_recovers",
      upgradeToFrontierWhen: ["Local model-assist provider is disabled, unavailable, or returns invalid JSON."],
    },
  };
}

function gradeModelAssistOutput(useful: boolean): ModelAssistResponse["grade"] {
  return {
    result: useful ? "useful_first_pass" : "not_worth_using",
    reason: useful
      ? "Provider returned a bounded local response without readiness overclaims."
      : "Provider response was empty or crossed a protected readiness boundary.",
    recommendedUse: useful ? "cost_efficient_read_only_review_and_contract_probe" : "skip_until_bridge_recovers",
    upgradeToFrontierWhen: [
      "implementation requires cross-file code edits",
      "review requires clinical, safety, legal, or protected-claim judgment",
      "local low-cost model output is vague, inconsistent, or misses repo guardrails",
    ],
  };
}

function extractResponseText(payload: Record<string, unknown>): string {
  if (typeof payload["output_text"] === "string" && payload["output_text"].trim().length > 0) {
    return payload["output_text"].trim();
  }
  const output = Array.isArray(payload["output"]) ? payload["output"].filter(isRecord) : [];
  const contentText = output.flatMap((entry) =>
    Array.isArray(entry["content"])
      ? entry["content"].filter(isRecord).map((content) => typeof content["text"] === "string" ? content["text"] : "")
      : []
  ).filter((text) => text.trim().length > 0);
  return contentText.join("\n").trim();
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
