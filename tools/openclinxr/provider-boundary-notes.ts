export type EncounterOperationalBoundaryClaimBoundary =
  | "provider_gate_metadata_not_live_provider_readiness"
  | "local_only_asset_pipeline_metadata_not_live_provider_readiness";

export type EncounterOperationalBoundaryNote = {
  claimBoundary: EncounterOperationalBoundaryClaimBoundary;
  executionEnabled: false;
  externalProviderExecutionAttempted: false;
  liveProviderReady: false;
  credentialEvidencePresent: false;
  runtimeEvidencePresent: false;
  reportMetadataOnly: true;
  surfacedInQueueReport: true;
  missingEvidenceIds: string[];
  notEvidenceFor: Array<
    | "provider_runtime_readiness"
    | "generated_asset_quality"
    | "production_asset_readiness"
    | "quest_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
  recommendedNextAction: string;
};

export type EncounterOperationalBoundaryNotes = {
  providerDisabledBoundary: EncounterOperationalBoundaryNote;
  localOnlyBoundary: EncounterOperationalBoundaryNote;
};

const providerDisabledBoundaryMissingEvidenceIds = [
  "provider_credentials_or_operator_approval_missing",
  "provider_runtime_evidence_missing",
];

const localOnlyBoundaryMissingEvidenceIds = [
  "local_blender_ffmpeg_toolchain_evidence_missing",
  "hunyuan3d_local_install_license_cache_evidence_missing",
  "shared_asset_library_lru_reuse_evidence_missing",
  "azurite_or_queue_emulator_evidence_missing",
  "durable_job_checkpoint_evidence_missing",
];

const notEvidenceForAllReadinessClaims = [
  "provider_runtime_readiness",
  "generated_asset_quality",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export function buildEncounterOperationalBoundaryNotes(): EncounterOperationalBoundaryNotes {
  return {
    providerDisabledBoundary: {
      claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
      executionEnabled: false,
      externalProviderExecutionAttempted: false,
      liveProviderReady: false,
      credentialEvidencePresent: false,
      runtimeEvidencePresent: false,
      reportMetadataOnly: true,
      surfacedInQueueReport: true,
      missingEvidenceIds: [...providerDisabledBoundaryMissingEvidenceIds],
      notEvidenceFor: [...notEvidenceForAllReadinessClaims],
      recommendedNextAction: "keep_live_provider_generation_disabled_until_operator_approval_and_runtime_evidence_exist",
    },
    localOnlyBoundary: {
      claimBoundary: "local_only_asset_pipeline_metadata_not_live_provider_readiness",
      executionEnabled: false,
      externalProviderExecutionAttempted: false,
      liveProviderReady: false,
      credentialEvidencePresent: false,
      runtimeEvidencePresent: false,
      reportMetadataOnly: true,
      surfacedInQueueReport: true,
      missingEvidenceIds: [...localOnlyBoundaryMissingEvidenceIds],
      notEvidenceFor: [...notEvidenceForAllReadinessClaims],
      recommendedNextAction: "attach_local_toolchain_and_queue_emulator_evidence_before_claiming_live_generation",
    },
  };
}

export function validateEncounterOperationalBoundaryNotes(
  value: unknown,
  path: string,
  errors: string[],
): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;

  validateOperationalBoundaryNote(
    value.providerDisabledBoundary,
    `${path}/providerDisabledBoundary`,
    "provider_gate_metadata_not_live_provider_readiness",
    providerDisabledBoundaryMissingEvidenceIds,
    errors,
  );
  validateOperationalBoundaryNote(
    value.localOnlyBoundary,
    `${path}/localOnlyBoundary`,
    "local_only_asset_pipeline_metadata_not_live_provider_readiness",
    localOnlyBoundaryMissingEvidenceIds,
    errors,
  );
}

function validateOperationalBoundaryNote(
  value: unknown,
  path: string,
  expectedClaimBoundary: EncounterOperationalBoundaryClaimBoundary,
  expectedMissingEvidenceIds: readonly string[],
  errors: string[],
): void {
  requireRecord(value, path, errors);
  if (!isRecord(value)) return;

  requireLiteral(value.claimBoundary, expectedClaimBoundary, `${path}/claimBoundary`, errors);
  requireLiteral(value.executionEnabled, false, `${path}/executionEnabled`, errors);
  requireLiteral(value.externalProviderExecutionAttempted, false, `${path}/externalProviderExecutionAttempted`, errors);
  requireLiteral(value.liveProviderReady, false, `${path}/liveProviderReady`, errors);
  requireLiteral(value.credentialEvidencePresent, false, `${path}/credentialEvidencePresent`, errors);
  requireLiteral(value.runtimeEvidencePresent, false, `${path}/runtimeEvidencePresent`, errors);
  requireLiteral(value.reportMetadataOnly, true, `${path}/reportMetadataOnly`, errors);
  requireLiteral(value.surfacedInQueueReport, true, `${path}/surfacedInQueueReport`, errors);
  requireArray(value.missingEvidenceIds, `${path}/missingEvidenceIds`, errors);
  requireArray(value.notEvidenceFor, `${path}/notEvidenceFor`, errors);
  requireString(value.recommendedNextAction, `${path}/recommendedNextAction`, errors);
  for (const missingEvidenceId of expectedMissingEvidenceIds) {
    requireStringArrayIncludes(
      value.missingEvidenceIds,
      missingEvidenceId,
      `${path}/missingEvidenceIds`,
      errors,
    );
  }
  for (const notEvidenceFor of notEvidenceForAllReadinessClaims) {
    requireStringArrayIncludes(value.notEvidenceFor, notEvidenceFor, `${path}/notEvidenceFor`, errors);
  }
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
  }
}

function requireLiteral(value: unknown, expected: string | number | boolean, path: string, errors: string[]): void {
  if (value !== expected) {
    errors.push(`${path} must be ${JSON.stringify(expected)}`);
  }
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be array`);
  }
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be non-empty string`);
  }
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
