/**
 * physics_config.v1 — factory generator for physics simulation configuration.
 *
 * Derives a PhysicsConfigV1 from phenotype.bodyMechanics-shaped input.
 * Plain TS types only; no schemas/ package dependency required.
 *
 * The config drives physics simulation with:
 *   - Per-body-region masses
 *   - Per-joint ROM limits
 *   - Per-contact-region tissue compliance
 *   - Guarding trigger thresholds
 *   - Determinism metadata (seed, fixedDt, notEvidenceFor)
 */

import type { DeterminismScope } from "../types.js";
import { defaultNotEvidenceFor } from "../types.js";
import {
  selectComplianceTable,
  selectGuardingTriggers,
  selectJointLimitTable,
  selectMassTable,
  type ComplianceRegion,
  type ComplianceTable,
  type GuardingTriggerEntry,
  type Habitus,
  type HabitusBodyRegion,
  type HabitusJoint,
  type JointLimit,
  type JointLimitTable,
  type MassTable,
} from "./habitus-tables.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Physics configuration version 1 — the output of the factory.
 *
 * Contains all simulation-time parameters derived from case-def phenotype.
 * This is the canonical config object consumed by physics adapters.
 */
export type PhysicsConfigV1 = {
  /** Version marker for config shape migration. */
  configVersion: "v1";

  /** Per-body-region mass values (kg scale factors). */
  masses: Record<string, number>;

  /** Per-joint ROM limits (radians). */
  jointLimits: Record<string, JointLimit>;

  /** Per-contact-region tissue compliance factors (0-1). */
  tissueComplianceMap: Record<string, number>;

  /** Guarding trigger entries keyed by contact region. */
  guardingTriggers: GuardingTriggerEntry[];

  /** Declared determinism scope (C5). */
  determinismScope: DeterminismScope;

  /** Canonical notEvidenceFor list (C7). */
  notEvidenceFor: ReturnType<typeof defaultNotEvidenceFor>;

  /** The seed used for PRNG in this config. */
  seed: number;

  /** The fixed dt used (must be 1/60 per C1). */
  fixedDt: number;

  /** Habitus category used to derive these values. */
  habitus: Habitus;

  /** Generator version that produced this config. */
  generatorVersion: string;
};

/**
 * Body-mechanics input shape from phenotype (case-def extension).
 *
 * Plain TS type — no schemas/ package dependency.
 * The factory reads what is provided; missing fields fall back
 * to committed lookup tables from habitus-tables.ts.
 */
export type PhenotypeBodyMechanics = {
  /** Canonical habitus category. Defaults to "average". */
  habitus?: Habitus;

  /** Optional per-body-region mass overrides. */
  bodyPartMasses?: Partial<Record<HabitusBodyRegion, number>>;

  /** Optional per-joint ROM limit overrides. */
  jointLimits?: Partial<Record<HabitusJoint, JointLimit>>;

  /** Optional per-region tissue compliance overrides. */
  tissueCompliance?: Partial<Record<ComplianceRegion, number>>;

  /** Optional guarding trigger overrides (replaces, not merges). */
  guardingTriggers?: GuardingTriggerEntry[];

  /** Optional seed override. Default: derived from phenotype hash. */
  seed?: number;
};

/**
 * The phenotype input consumed by the factory.
 * Mirrors the case-def phenotype.bodyMechanics shape.
 */
export type PhysicsConfigPhenotypeInput = {
  /** Body-mechanics section of the phenotype. */
  bodyMechanics?: PhenotypeBodyMechanics;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Generate a PhysicsConfigV1 from a phenotype input.
 *
 * Resolution order:
 *   1. phenotype.bodyMechanics explicit overrides (highest priority)
 *   2. Habitus-table defaults from habitus-tables.ts
 *   3. "average" habitus if no habitus specified
 *
 * Seed: uses phenotype.bodyMechanics.seed if provided, otherwise derives
 * a deterministic seed from the phenotype shape hash.
 *
 * Deterministic: same phenotype object → identical PhysicsConfigV1.
 */
export function generatePhysicsConfigFromPhenotype(
  input: PhysicsConfigPhenotypeInput,
): PhysicsConfigV1 {
  const bm = input.bodyMechanics ?? {};
  const habitus: Habitus = bm.habitus ?? "average";

  // Resolve masses: table default + overrides
  const massTable: MassTable = selectMassTable(habitus);
  const masses: Record<string, number> = { ...massTable };
  if (bm.bodyPartMasses) {
    for (const [key, value] of Object.entries(bm.bodyPartMasses)) {
      if (value !== undefined) {
        masses[key] = value;
      }
    }
  }

  // Resolve joint limits: table default + overrides
  const jointLimitTable: JointLimitTable = selectJointLimitTable(habitus);
  const jointLimits: Record<string, JointLimit> = { ...jointLimitTable };
  if (bm.jointLimits) {
    for (const [key, value] of Object.entries(bm.jointLimits)) {
      if (value !== undefined) {
        jointLimits[key] = { ...value };
      }
    }
  }

  // Resolve tissue compliance: table default + overrides
  const complianceTable: ComplianceTable = selectComplianceTable(habitus);
  const tissueComplianceMap: Record<string, number> = { ...complianceTable };
  if (bm.tissueCompliance) {
    for (const [key, value] of Object.entries(bm.tissueCompliance)) {
      if (value !== undefined) {
        tissueComplianceMap[key] = value;
      }
    }
  }

  // Resolve guarding triggers: table default, or fully replaced by overrides
  const guardingTriggers: GuardingTriggerEntry[] =
    bm.guardingTriggers ?? selectGuardingTriggers(habitus);

  // Resolve seed: override or deterministic hash from input shape
  const seed: number =
    bm.seed ??
    deterministicSeedFromInput(input);

  return {
    configVersion: "v1",
    masses,
    jointLimits,
    tissueComplianceMap,
    guardingTriggers,
    determinismScope: "local",
    notEvidenceFor: defaultNotEvidenceFor(),
    seed,
    fixedDt: 1 / 60,
    habitus,
    generatorVersion: "0.1.0",
  };
}

// ---------------------------------------------------------------------------
// Deterministic seed derivation
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic integer seed from the phenotype input shape.
 *
 * Uses a simple FNV-1a hash of JSON.stringify(input) to produce a stable
 * seed. Same input → same seed every time.
 */
function deterministicSeedFromInput(
  input: PhysicsConfigPhenotypeInput,
): number {
  const json = JSON.stringify(input, Object.keys(input).sort());
  return fnv1a32(json);
}

/**
 * FNV-1a 32-bit hash (deterministic, no crypto dependency).
 */
function fnv1a32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Return as positive number in the safe integer range
  return (hash >>> 0) % 2147483647;
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Create a default PhysicsConfigV1 for average habitus with a given seed.
 * Used when no phenotype is available (e.g., standalone adapter testing).
 */
export function createDefaultPhysicsConfigV1(
  seed?: number,
): PhysicsConfigV1 {
  return generatePhysicsConfigFromPhenotype({
    bodyMechanics: {
      habitus: "average",
      seed: seed ?? 42,
    },
  });
}
