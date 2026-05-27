import { stat } from "node:fs/promises";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type ExternalAiAssetProviderCandidateId =
  | "hunyuan3d_local"
  | "meshy_cloud_requires_approval"
  | "tripo_cloud_requires_approval"
  | "vlm_adversarial_reviewer_requires_approval";

export type ExternalAiAssetProviderPreflightReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.external-ai-asset-provider-preflight.v1";
  claimScope: "provider_preflight_metadata_only_no_execution";
  providerGate: {
    status: "blocked_until_operator_approval_and_runtime_evidence";
    evidenceKind: "external_ai_provider_preflight_metadata";
    executionEnabled: false;
    externalProviderExecutionAttempted: false;
    reportMetadataOnly: true;
    surfacedInProviderGateReport: true;
  };
  candidates: Array<{
    providerId: ExternalAiAssetProviderCandidateId;
    intendedTargets: string[];
    preferredOrderRole: string;
    executionEnabled: false;
    externalNetworkUsed: false;
    paidApiUsed: false;
    credentialRequiredBeforeExecution: boolean;
    requiredControls: string[];
      blockers: string[];
    }>;
  recommendedRouting: {
    humanoidMeshAndRig: ["meshy_cloud_requires_approval", "hunyuan3d_local", "blender_mixamo_style_rigging_fallback"];
    equipmentAndProps: ["hunyuan3d_local", "meshy_cloud_requires_approval", "tripo_cloud_requires_approval"];
    adversarialReview: ["local_open_vlm_if_available", "frontier_cloud_vlm_requires_approval", "deterministic_fixture"];
  };
  handoff: {
    providerDisabledBoundary: string;
    localOnlyBoundary: string;
    missingEvidenceIds: Array<
      | "hunyuan3d_not_installed"
      | "model_license_review_missing"
      | "runtime_smoke_evidence_missing"
      | "explicit_operator_approval_missing"
      | "credential_secret_missing"
      | "paid_api_budget_missing"
      | "asset_license_review_missing"
      | "approved_vlm_route_missing"
      | "screenshot_video_redaction_policy_missing"
    >;
    nextSafeProviderDisabledExecutionStep: string;
  };
  notEvidenceFor: Array<"provider_runtime_readiness" | "generated_asset_quality" | "production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/external-ai-asset-provider-preflight-*.json");
    if (!validatePath) throw new Error("Missing external AI asset provider preflight report to validate.");
    const validation = validateExternalAiAssetProviderPreflightReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const report = buildExternalAiAssetProviderPreflightReport();
  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

export function buildExternalAiAssetProviderPreflightReport(input: {
  generatedAt?: string;
} = {}): ExternalAiAssetProviderPreflightReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schemaVersion: "openclinxr.external-ai-asset-provider-preflight.v1",
    claimScope: "provider_preflight_metadata_only_no_execution",
    providerGate: {
      status: "blocked_until_operator_approval_and_runtime_evidence",
      evidenceKind: "external_ai_provider_preflight_metadata",
      executionEnabled: false,
      externalProviderExecutionAttempted: false,
      reportMetadataOnly: true,
      surfacedInProviderGateReport: true,
    },
    candidates: [
      {
        providerId: "hunyuan3d_local",
        intendedTargets: ["medical_equipment_glb", "room_props_glb", "humanoid_base_mesh_fallback"],
        preferredOrderRole: "first_for_equipment_and_props_fallback_for_humanoids",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: false,
        requiredControls: ["local_install_evidence", "model_license_review", "cache_location_recorded", "shared_asset_library_lru_lookup", "runtime_smoke_evidence"],
        blockers: ["hunyuan3d_not_installed", "model_license_review_missing", "runtime_smoke_evidence_missing"],
      },
      {
        providerId: "meshy_cloud_requires_approval",
        intendedTargets: ["role_specific_humanoid_glb", "humanoid_rigging", "basic_humanoid_animation", "equipment_comparison"],
        preferredOrderRole: "first_for_humanoid_mesh_and_rig_cloud_only_after_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        requiredControls: ["explicit_operator_approval", "credential_secret", "paid_api_budget", "asset_license_review", "shared_asset_library_lru_lookup", "human_review_before_learner_use"],
        blockers: ["explicit_operator_approval_missing", "credential_secret_missing", "paid_api_budget_missing", "asset_license_review_missing"],
      },
      {
        providerId: "tripo_cloud_requires_approval",
        intendedTargets: ["draft_props", "reference_image_to_3d_comparison", "equipment_comparison"],
        preferredOrderRole: "comparison_for_equipment_and_props_cloud_only_after_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        requiredControls: ["explicit_operator_approval", "credential_secret", "paid_api_budget", "asset_license_review", "shared_asset_library_lru_lookup"],
        blockers: ["explicit_operator_approval_missing", "credential_secret_missing", "paid_api_budget_missing", "asset_license_review_missing"],
      },
      {
        providerId: "vlm_adversarial_reviewer_requires_approval",
        intendedTargets: ["screenshot_realism_review", "video_motion_review", "aaa_realism_gap_detection", "visual_qa_blocker_generation"],
        preferredOrderRole: "local_open_vlm_first_frontier_cloud_only_after_approval",
        executionEnabled: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
        credentialRequiredBeforeExecution: true,
        requiredControls: ["local_or_cloud_model_policy", "screenshot_video_redaction", "explicit_operator_approval", "claim_boundary_enforced", "cost_budget", "shared_asset_library_lru_lookup"],
        blockers: ["approved_vlm_route_missing", "screenshot_video_redaction_policy_missing", "runtime_evidence_missing"],
      },
    ],
    recommendedRouting: {
      humanoidMeshAndRig: ["meshy_cloud_requires_approval", "hunyuan3d_local", "blender_mixamo_style_rigging_fallback"],
      equipmentAndProps: ["hunyuan3d_local", "meshy_cloud_requires_approval", "tripo_cloud_requires_approval"],
      adversarialReview: ["local_open_vlm_if_available", "frontier_cloud_vlm_requires_approval", "deterministic_fixture"],
    },
    handoff: {
      providerDisabledBoundary: "No external provider execution: keep executionEnabled false, do not request credentials, and do not use paid APIs or network calls.",
      localOnlyBoundary: "Offline/local metadata review only: restrict work to workspace evidence, deterministic fixtures, and local registry checks.",
      missingEvidenceIds: [
        "hunyuan3d_not_installed",
        "model_license_review_missing",
        "runtime_smoke_evidence_missing",
        "explicit_operator_approval_missing",
        "credential_secret_missing",
        "paid_api_budget_missing",
        "asset_license_review_missing",
        "approved_vlm_route_missing",
        "screenshot_video_redaction_policy_missing",
      ],
      nextSafeProviderDisabledExecutionStep: "Assemble the local evidence bundle for hunyuan3d_local and the approval-gated cloud candidates, then re-run this preflight in metadata-only mode without invoking any provider.",
    },
    notEvidenceFor: [
      "provider_runtime_readiness",
      "generated_asset_quality",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

export function validateExternalAiAssetProviderPreflightReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.external-ai-asset-provider-preflight.v1", "/schemaVersion", errors);
  requireLiteral(value.claimScope, "provider_preflight_metadata_only_no_execution", "/claimScope", errors);
  requireRecord(value.providerGate, "/providerGate", errors);
  requireArray(value.candidates, "/candidates", errors);
  requireRecord(value.recommendedRouting, "/recommendedRouting", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  if (isRecord(value.providerGate)) {
    requireLiteral(value.providerGate.status, "blocked_until_operator_approval_and_runtime_evidence", "/providerGate/status", errors);
    requireLiteral(value.providerGate.evidenceKind, "external_ai_provider_preflight_metadata", "/providerGate/evidenceKind", errors);
    requireLiteral(value.providerGate.executionEnabled, false, "/providerGate/executionEnabled", errors);
    requireLiteral(value.providerGate.externalProviderExecutionAttempted, false, "/providerGate/externalProviderExecutionAttempted", errors);
    requireLiteral(value.providerGate.reportMetadataOnly, true, "/providerGate/reportMetadataOnly", errors);
    requireLiteral(value.providerGate.surfacedInProviderGateReport, true, "/providerGate/surfacedInProviderGateReport", errors);
  }
  if (Array.isArray(value.candidates)) {
    const candidateIds = new Set(value.candidates.filter(isRecord).map((candidate) => String(candidate.providerId ?? "")));
    for (const providerId of ["hunyuan3d_local", "meshy_cloud_requires_approval", "tripo_cloud_requires_approval", "vlm_adversarial_reviewer_requires_approval"]) {
      if (!candidateIds.has(providerId)) errors.push(`/candidates must include ${providerId}`);
    }
    value.candidates.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        errors.push(`/candidates/${index} must be object`);
        return;
      }
      requireString(candidate.providerId, `/candidates/${index}/providerId`, errors);
      requireArray(candidate.intendedTargets, `/candidates/${index}/intendedTargets`, errors);
      requireString(candidate.preferredOrderRole, `/candidates/${index}/preferredOrderRole`, errors);
      requireLiteral(candidate.executionEnabled, false, `/candidates/${index}/executionEnabled`, errors);
      requireLiteral(candidate.externalNetworkUsed, false, `/candidates/${index}/externalNetworkUsed`, errors);
      requireLiteral(candidate.paidApiUsed, false, `/candidates/${index}/paidApiUsed`, errors);
      if (typeof candidate.credentialRequiredBeforeExecution !== "boolean") {
        errors.push(`/candidates/${index}/credentialRequiredBeforeExecution must be boolean`);
      }
      requireArray(candidate.requiredControls, `/candidates/${index}/requiredControls`, errors);
      requireArray(candidate.blockers, `/candidates/${index}/blockers`, errors);
      requireStringArrayIncludes(candidate.requiredControls, "shared_asset_library_lru_lookup", `/candidates/${index}/requiredControls`, errors);
    });
  }
  if (isRecord(value.recommendedRouting)) {
    requireStringArrayStartsWith(value.recommendedRouting.humanoidMeshAndRig, "meshy_cloud_requires_approval", "/recommendedRouting/humanoidMeshAndRig", errors);
    requireStringArrayStartsWith(value.recommendedRouting.equipmentAndProps, "hunyuan3d_local", "/recommendedRouting/equipmentAndProps", errors);
    requireStringArrayStartsWith(value.recommendedRouting.adversarialReview, "local_open_vlm_if_available", "/recommendedRouting/adversarialReview", errors);
  }
  requireRecord(value.handoff, "/handoff", errors);
  if (isRecord(value.handoff)) {
    requireLiteral(value.handoff.providerDisabledBoundary, "No external provider execution: keep executionEnabled false, do not request credentials, and do not use paid APIs or network calls.", "/handoff/providerDisabledBoundary", errors);
    requireLiteral(value.handoff.localOnlyBoundary, "Offline/local metadata review only: restrict work to workspace evidence, deterministic fixtures, and local registry checks.", "/handoff/localOnlyBoundary", errors);
    requireExactStringArray(
      value.handoff.missingEvidenceIds,
      [
        "hunyuan3d_not_installed",
        "model_license_review_missing",
        "runtime_smoke_evidence_missing",
        "explicit_operator_approval_missing",
        "credential_secret_missing",
        "paid_api_budget_missing",
        "asset_license_review_missing",
        "approved_vlm_route_missing",
        "screenshot_video_redaction_policy_missing",
      ],
      "/handoff/missingEvidenceIds",
      errors,
    );
    requireLiteral(
      value.handoff.nextSafeProviderDisabledExecutionStep,
      "Assemble the local evidence bundle for hunyuan3d_local and the approval-gated cloud candidates, then re-run this preflight in metadata-only mode without invoking any provider.",
      "/handoff/nextSafeProviderDisabledExecutionStep",
      errors,
    );
  }
  for (const notEvidenceFor of ["provider_runtime_readiness", "generated_asset_quality", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
    requireStringArrayIncludes(value.notEvidenceFor, notEvidenceFor, "/notEvidenceFor", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${pathName} must be object`);
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${pathName} must be array`);
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${pathName} must be non-empty string`);
}

function requireLiteral(value: unknown, expected: string | boolean, pathName: string, errors: string[]): void {
  if (value !== expected) errors.push(`${pathName} must be ${JSON.stringify(expected)}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, pathName: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) errors.push(`${pathName} must include ${expected}`);
}

function requireStringArrayStartsWith(value: unknown, expected: string, pathName: string, errors: string[]): void {
  if (!Array.isArray(value) || value[0] !== expected) errors.push(`${pathName} must start with ${expected}`);
}

function requireExactStringArray(value: unknown, expected: string[], pathName: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) {
    errors.push(`${pathName} must equal ${JSON.stringify(expected)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
