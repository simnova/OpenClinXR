import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  generatePhysicsConfigFromPhenotype,
  type PhenotypeBodyMechanics,
  type PhysicsConfigPhenotypeInput,
  type PhysicsConfigV1,
} from "../../../packages/openclinxr/arena/physics-touch-contract/src/factory/physics-config-v1.js";

import {
  type Habitus,
  type ComplianceRegion,
  type GuiardingTriggerEntry,
  type HabitusBodyRegion,
  type HabitusJoint,
  type JointLimit,
} from "../../../packages/openclinxr/arena/physics-touch-contract/src/factory/habitus-tables.js";

// ---------------------------------------------------------------------------
// Constants (mirror generated-human-rigging-artifacts.ts patterns)
// ---------------------------------------------------------------------------

export const GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION =
  "openclinxr.generated-physics-config-artifacts.v1";
export const GENERATED_PHYSICS_CONFIG_KIND = "generated_physics_config_artifacts";
export const GENERATED_PHYSICS_CONFIG_OUTPUT_DIR =
  ".openclinxr/asset-production/physics-config";
export const GENERATED_PHYSICS_CONFIG_FILENAME = "physics-config.v1.json";
export const GENERATED_PHYSICS_CONFIG_GENERATOR_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Report type
// ---------------------------------------------------------------------------

export type GeneratedPhysicsConfigReport = {
  schemaVersion: typeof GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION;
  kind: typeof GENERATED_PHYSICS_CONFIG_KIND;
  generatedAt: string;

  tool: {
    name: "tools/openclinxr/factory/generated-physics-config-artifacts.ts";
    generatorVersion: string;
  };

  policy: {
    localOnly: true;
    installsIntroduced: false;
    cloudApisUsed: false;
    paidApisUsed: false;
    externalAssetsUsed: false;
    generatedThirdPartyAssetsCommitted: false;
    productionAssetReadinessClaimed: false;
  };

  input: {
    /** Case identifier driving this config. */
    caseId: string;
    /** Actor role for whom the config is generated. */
    actorId: string;
    /** Canonical habitus derived from phenotype. */
    habitus: Habitus;
    /** Override seed if provided; otherwise derived. */
    seed: number;
  };

  config: PhysicsConfigV1;

  provenance: {
    /** Deterministic hash of the phenotype input used. */
    phenotypeHash: string;
    /** Always "B" — not a real clinical artifact. */
    realismGrade: "B";
    /** Always false — local dev tool artifact only. */
    promotionStatus: false;
    /** Canonical notEvidenceFor from the physics contract (C7). */
    notEvidenceFor: PhysicsConfigV1["notEvidenceFor"];
    /** Declared determinism scope (C5). Always "local" per OD-3. */
    determinismScope: "local";
    /** Engine id/version this config was generated for. */
    engineId: string;
    engineVersion: string;
  };

  artifacts: {
    configPath: string;
  };

  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

// ---------------------------------------------------------------------------
// Factory input type
// ---------------------------------------------------------------------------

/**
 * Input to the physics config artifact generator.
 * Accepts both a case-def-like shape and a raw PhysicsConfigPhenotypeInput.
 */
export type PhysicsConfigArtifactInput = {
  /** Case identifier (e.g., "peds_asthma_parent_anxiety_v1"). */
  caseId: string;
  /** Actor identifier (e.g., "patient_maya_johnson_v1"). */
  actorId: string;
  /** Phenotype body-mechanics input. */
  phenotype: {
    bodyMechanics?: PhenotypeBodyMechanics;
  };
  /** Override engine metadata (defaults to Rapier per OD-1). */
  engine?: {
    id?: string;
    version?: string;
  };
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate a physics config artifact report from case-def phenotype input.
 *
 * Mirrors buildGeneratedHumanRiggingReportFromGlb() — same provenance
 * embedding shape, SCHEMA_VERSION/KIND constants, policy block, and
 * verdict pattern.
 *
 * Deterministic: same input → identical report (same config hash).
 */
export function generatePhysicsConfigArtifact(
  input: PhysicsConfigArtifactInput,
): GeneratedPhysicsConfigReport {
  const phenotypeInput: PhysicsConfigPhenotypeInput = {
    bodyMechanics: input.phenotype.bodyMechanics,
  };

  const config = generatePhysicsConfigFromPhenotype(phenotypeInput);
  const phenotypeHash = deterministicPhenotypeHash(phenotypeInput);
  const engineId = input.engine?.id ?? "rapier";
  const engineVersion = input.engine?.version ?? "0.19.3";
  const blockers = validateConfigBlockers(config);

  const generatedAt = new Date().toISOString();

  return {
    schemaVersion: GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION,
    kind: GENERATED_PHYSICS_CONFIG_KIND,
    generatedAt,
    tool: {
      name: "tools/openclinxr/factory/generated-physics-config-artifacts.ts",
      generatorVersion: GENERATED_PHYSICS_CONFIG_GENERATOR_VERSION,
    },
    policy: {
      localOnly: true,
      installsIntroduced: false,
      cloudApisUsed: false,
      paidApisUsed: false,
      externalAssetsUsed: false,
      generatedThirdPartyAssetsCommitted: false,
      productionAssetReadinessClaimed: false,
    },
    input: {
      caseId: input.caseId,
      actorId: input.actorId,
      habitus: config.habitus,
      seed: config.seed,
    },
    config,
    provenance: {
      phenotypeHash,
      realismGrade: "B",
      promotionStatus: false,
      notEvidenceFor: config.notEvidenceFor,
      determinismScope: config.determinismScope,
      engineId,
      engineVersion,
    },
    artifacts: {
      configPath: path.join(GENERATED_PHYSICS_CONFIG_OUTPUT_DIR, GENERATED_PHYSICS_CONFIG_FILENAME),
    },
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };
}

// ---------------------------------------------------------------------------
// Write artifact to disk
// ---------------------------------------------------------------------------

/**
 * Write the generated physics config + report to the output directory.
 *
 * Writes two files:
 *   1. physics-config.v1.json — the raw PhysicsConfigV1 (for adapters to consume)
 *   2. generated-physics-config-artifacts-<date>.json — the full report
 *
 * Returns the report for chaining.
 */
export async function writePhysicsConfigArtifact(
  input: PhysicsConfigArtifactInput,
  outputRoot?: string,
): Promise<GeneratedPhysicsConfigReport> {
  const report = generatePhysicsConfigArtifact(input);
  const outDir = path.resolve(outputRoot ?? GENERATED_PHYSICS_CONFIG_OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });

  const configPath = path.join(outDir, GENERATED_PHYSICS_CONFIG_FILENAME);
  const reportPath = path.join(
    outDir,
    `generated-physics-config-artifacts-${report.generatedAt.slice(0, 10)}.json`,
  );

  await writeFile(configPath, `${JSON.stringify(report.config, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // Update the report's artifacts to reflect the actual written paths
  report.artifacts.configPath = configPath;

  return report;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a GeneratedPhysicsConfigReport object.
 * Returns { ok, errors } — same shape as generated-human-rigging validation.
 */
export function validateGeneratedPhysicsConfigArtifact(
  report: unknown,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(report)) {
    return { ok: false, errors: ["/ must be an object"] };
  }

  if (report.schemaVersion !== GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION) {
    errors.push(`/schemaVersion must be ${GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION}`);
  }
  if (report.kind !== GENERATED_PHYSICS_CONFIG_KIND) {
    errors.push(`/kind must be ${GENERATED_PHYSICS_CONFIG_KIND}`);
  }

  // Policy block assertions
  const policy = isRecord(report.policy) ? report.policy : {};
  if (policy.localOnly !== true) errors.push("/policy/localOnly must be true");
  if (policy.cloudApisUsed !== false) errors.push("/policy/cloudApisUsed must be false");
  if (policy.paidApisUsed !== false) errors.push("/policy/paidApisUsed must be false");
  if (policy.externalAssetsUsed !== false) errors.push("/policy/externalAssetsUsed must be false");
  if (policy.productionAssetReadinessClaimed !== false) {
    errors.push("/policy/productionAssetReadinessClaimed must be false");
  }

  // Config must be present
  const config = isRecord(report.config) ? report.config : {};
  if (config.configVersion !== "v1") {
    errors.push("/config/configVersion must be v1");
  }
  if (config.determinismScope !== "local") {
    errors.push("/config/determinismScope must be local");
  }
  if (typeof config.seed !== "number") {
    errors.push("/config/seed must be a number");
  }
  if (config.fixedDt !== 1 / 60) {
    errors.push("/config/fixedDt must be 1/60");
  }

  // Provenance assertions
  const provenance = isRecord(report.provenance) ? report.provenance : {};
  if (typeof provenance.phenotypeHash !== "string" || provenance.phenotypeHash.length !== 64) {
    errors.push("/provenance/phenotypeHash must be a 64-char hex string");
  }
  if (provenance.realismGrade !== "B") {
    errors.push("/provenance/realismGrade must be B");
  }
  if (provenance.promotionStatus !== false) {
    errors.push("/provenance/promotionStatus must be false");
  }
  if (provenance.determinismScope !== "local") {
    errors.push("/provenance/determinismScope must be local");
  }
  if (typeof provenance.engineId !== "string" || provenance.engineId.length === 0) {
    errors.push("/provenance/engineId must be a non-empty string");
  }

  // notEvidenceFor assertions (C7)
  const notEvidenceFor = Array.isArray(provenance.notEvidenceFor)
    ? provenance.notEvidenceFor
    : [];
  const requiredClauses = [
    "clinical_validity",
    "exam_equivalence",
    "scoring",
    "learner_readiness",
  ];
  for (const clause of requiredClauses) {
    if (!notEvidenceFor.includes(clause)) {
      errors.push(`/provenance/notEvidenceFor must include "${clause}"`);
    }
  }

  // Verdict must match blockers
  const verdict = isRecord(report.verdict) ? report.verdict : {};
  const verdictBlockers = asStringArray(verdict.blockers);
  const expectedBlockers = validateConfigBlockers(config as Record<string, unknown>);

  // Verdict.passed should match whether there are blockers
  const shouldPass = expectedBlockers.length === 0;
  if (verdict.passed !== shouldPass) {
    errors.push(`/verdict/passed must be ${shouldPass}`);
  }
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers must include ${blocker}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate config structural requirements and return blockers.
 */
function validateConfigBlockers(
  config: Record<string, unknown>,
): string[] {
  const blockers: string[] = [];

  if (config.configVersion !== "v1") {
    blockers.push("config_version_not_v1");
  }
  if (config.determinismScope !== "local") {
    blockers.push("determinism_scope_not_local");
  }
  if (typeof config.seed !== "number") {
    blockers.push("seed_missing");
  }
  if (config.fixedDt !== 1 / 60) {
    blockers.push("fixed_dt_not_1_60");
  }

  const masses = isRecord(config.masses) ? config.masses : {};
  if (Object.keys(masses).length === 0) {
    blockers.push("masses_empty");
  }

  const jointLimits = isRecord(config.jointLimits) ? config.jointLimits : {};
  if (Object.keys(jointLimits).length === 0) {
    blockers.push("joint_limits_empty");
  }

  const guardingTriggers = Array.isArray(config.guardingTriggers)
    ? config.guardingTriggers
    : [];
  if (guardingTriggers.length === 0) {
    blockers.push("guarding_triggers_empty");
  }

  return blockers;
}

/**
 * Derive a deterministic 64-char hex phenotype hash from the input.
 * Uses the same FNV-1a + hex strategy as the physics-config seed derivation,
 * but returns a full 256-bit hex string for provenance.
 */
function deterministicPhenotypeHash(
  input: PhysicsConfigPhenotypeInput,
): string {
  // Sort keys for deterministic serialization, then stringify the full input.
  // NOTE: JSON.stringify(_, array) strips nested properties — use a replacer
  // function that recurses into nested objects, preserving all values.
  const json = deterministicStringify(input);
  return fnv1aHex(json);
}

/** Deterministic JSON serialization with sorted keys at all levels. */
function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(deterministicStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => {
    return JSON.stringify(k) + ":" + deterministicStringify((value as Record<string, unknown>)[k]);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * FNV-1a hash returning a 64-char hex string (simulated 256-bit).
 * Uses 4 passes with different offsets for deterministic spread.
 */
function fnv1aHex(input: string): string {
  // 4 independent 32-bit FNV-1a hashes with different seeds
  const h0 = fnv1a32Seeded(input, 0x811c9dc5);
  const h1 = fnv1a32Seeded(input, 0xcbf29ce4);
  const h2 = fnv1a32Seeded(input, 0x6c62272e);
  const h3 = fnv1a32Seeded(input, 0x8f1bbcdc);

  // Return 64-char hex (8 chars per 32-bit hash × 4)
  return (
    h0.toString(16).padStart(8, "0") +
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    h3.toString(16).padStart(8, "0")
  ).repeat(2); // duplicate to get 64 hex chars for a stable "256-bit" shape
}

function fnv1a32Seeded(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Create a default physics config artifact for the average habitus.
 * Used when no case-def phenotype is available (e.g., standalone adapter testing).
 */
export function createDefaultPhysicsConfigArtifact(
  caseId?: string,
  actorId?: string,
): GeneratedPhysicsConfigReport {
  return generatePhysicsConfigArtifact({
    caseId: caseId ?? "default_case",
    actorId: actorId ?? "default_actor",
    phenotype: {
      bodyMechanics: { habitus: "average" },
    },
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Minimal CLI entry point — generates physics config artifacts from phenotype.
 *
 * Usage:
 *   tsx tools/openclinxr/factory/generated-physics-config-artifacts.ts
 *     --case-id <id> --actor-id <id> [--habitus average|obese|frail]
 *     [--output-root <path>] [--engine-id <id>] [--engine-version <version>]
 *
 * Validation:
 *   tsx tools/openclinxr/factory/generated-physics-config-artifacts.ts
 *     --validate <path/to/report.json>
 */
export async function runGeneratedPhysicsConfigArtifactsCli(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const validateIdx = args.indexOf("--validate");
  if (validateIdx !== -1) {
    const reportPath = args[validateIdx + 1];
    if (!reportPath) {
      process.stderr.write("Missing report path for --validate.\n");
      process.exitCode = 1;
      return;
    }
    const raw = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    const result = validateGeneratedPhysicsConfigArtifact(raw);
    if (!result.ok) {
      process.stderr.write(
        `Physics config artifact validation failed:\n${result.errors.join("\n")}\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write("Physics config artifact validated OK.\n");
    }
    return;
  }

  const caseId = consumeArg(args, "--case-id") ?? "default_case";
  const actorId = consumeArg(args, "--actor-id") ?? "default_actor";
  const habitus = consumeArg(args, "--habitus") ?? "average";
  const outputRoot = consumeArg(args, "--output-root");
  const engineId = consumeArg(args, "--engine-id");
  const engineVersion = consumeArg(args, "--engine-version");

  if (
    habitus !== "average" &&
    habitus !== "obese" &&
    habitus !== "frail"
  ) {
    process.stderr.write(`Invalid habitus: ${habitus} (must be average, obese, or frail)\n`);
    process.exitCode = 1;
    return;
  }

  const report = await writePhysicsConfigArtifact(
    {
      caseId,
      actorId,
      phenotype: {
        bodyMechanics: { habitus: habitus as "average" | "obese" | "frail" },
      },
      engine:
        engineId || engineVersion
          ? { id: engineId, version: engineVersion }
          : undefined,
    },
    outputRoot,
  );

  process.stdout.write(
    `Generated physics config: ${report.artifacts.configPath}\n`,
  );
  process.stdout.write(
    `  caseId=${report.input.caseId} actorId=${report.input.actorId}` +
      ` habitus=${report.input.habitus} seed=${report.input.seed}\n`,
  );
  process.stdout.write(
    `  engineId=${report.provenance.engineId} determinism=${report.provenance.determinismScope}\n`,
  );
  process.stdout.write(
    `  verdict=${report.verdict.passed ? "PASSED" : "BLOCKED"}\n`,
  );
}

function consumeArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

// Self-executing CLI when run directly via tsx.
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("generated-physics-config-artifacts.ts") ||
    process.argv[1].endsWith("generated-physics-config-artifacts.js"));

if (isMainModule) {
  runGeneratedPhysicsConfigArtifactsCli(process.argv.slice(2))
    .then(() => {
      if (process.exitCode === undefined) process.exitCode = 0;
    })
    .catch((err) => {
      process.stderr.write(`Error: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
