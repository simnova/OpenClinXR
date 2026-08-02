/**
 * Tests for physics_config.v1 factory.
 *
 * Requirements:
 *   1. Same phenotype → same config hash (deterministic)
 *   2. Different habitus → different masses
 *   3. Overrides work correctly
 *   4. seed derivation is deterministic
 */

import { describe, expect, it } from "vitest";
import { hashState } from "../../snapshot-hash.js";
import {
  createDefaultPhysicsConfigV1,
  generatePhysicsConfigFromPhenotype,
  type PhysicsConfigPhenotypeInput,
} from "../physics-config-v1.js";

// ---------------------------------------------------------------------------
// Determinism: same phenotype → same config hash
// ---------------------------------------------------------------------------

describe("physics_config.v1 determinism", () => {
  it("same phenotype (average) → identical config hash", () => {
    const input: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "average" },
    };

    const config1 = generatePhysicsConfigFromPhenotype(input);
    const config2 = generatePhysicsConfigFromPhenotype(input);

    const hash1 = hashState(config1);
    const hash2 = hashState(config2);

    expect(hash1).toBe(hash2);
  });

  it("same phenotype (obese) → identical config hash", () => {
    const input: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "obese" },
    };

    const config1 = generatePhysicsConfigFromPhenotype(input);
    const config2 = generatePhysicsConfigFromPhenotype(input);

    expect(hashState(config1)).toBe(hashState(config2));
  });

  it("identical overrides produce identical configs", () => {
    const input: PhysicsConfigPhenotypeInput = {
      bodyMechanics: {
        habitus: "average",
        bodyPartMasses: { head: 0.12, abdomen: 0.20 },
        seed: 999,
      },
    };

    const config1 = generatePhysicsConfigFromPhenotype(input);
    const config2 = generatePhysicsConfigFromPhenotype(input);

    expect(hashState(config1)).toBe(hashState(config2));
  });

  it("identical inputs with no bodyMechanics produce identical configs", () => {
    const input: PhysicsConfigPhenotypeInput = {};

    const config1 = generatePhysicsConfigFromPhenotype(input);
    const config2 = generatePhysicsConfigFromPhenotype(input);

    expect(hashState(config1)).toBe(hashState(config2));
  });
});

// ---------------------------------------------------------------------------
// Different habitus → different masses
// ---------------------------------------------------------------------------

describe("habitus mass differentiation", () => {
  it("average vs obese → different masses", () => {
    const avgInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "average" },
    };
    const obeseInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "obese" },
    };

    const avgConfig = generatePhysicsConfigFromPhenotype(avgInput);
    const obeseConfig = generatePhysicsConfigFromPhenotype(obeseInput);

    // Abdomen mass should differ
    expect(obeseConfig.masses['abdomen']!).toBeGreaterThan(
      avgConfig.masses['abdomen']!,
    );

    // Head mass should be lower for obese (proportionally)
    expect(obeseConfig.masses['head']!).toBeLessThan(
      avgConfig.masses['head']!,
    );
  });

  it("average vs frail → different masses", () => {
    const avgInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "average" },
    };
    const frailInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "frail" },
    };

    const avgConfig = generatePhysicsConfigFromPhenotype(avgInput);
    const frailConfig = generatePhysicsConfigFromPhenotype(frailInput);

    // Frail should have lower thigh mass
    expect(frailConfig.masses['thigh_R']!).toBeLessThan(
      avgConfig.masses['thigh_R']!,
    );

    // Frail should have lower abdomen mass
    expect(frailConfig.masses['abdomen']!).toBeLessThan(
      avgConfig.masses['abdomen']!,
    );
  });

  it("obese vs frail → different masses", () => {
    const obeseInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "obese" },
    };
    const frailInput: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "frail" },
    };

    const obeseConfig = generatePhysicsConfigFromPhenotype(obeseInput);
    const frailConfig = generatePhysicsConfigFromPhenotype(frailInput);

    expect(obeseConfig.masses['abdomen']!).toBeGreaterThan(
      frailConfig.masses['abdomen']!,
    );

    // Full config hashes should differ
    expect(hashState(obeseConfig)).not.toBe(hashState(frailConfig));
  });

  it("different habitus → different full config hashes", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const obeseConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "obese" },
    });
    const frailConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "frail" },
    });

    const avgHash = hashState(avgConfig);
    const obeseHash = hashState(obeseConfig);
    const frailHash = hashState(frailConfig);

    expect(avgHash).not.toBe(obeseHash);
    expect(avgHash).not.toBe(frailHash);
    expect(obeseHash).not.toBe(frailHash);
  });
});

// ---------------------------------------------------------------------------
// Different habitus → different compliance / joint limits / guarding
// ---------------------------------------------------------------------------

describe("habitus differentiation beyond masses", () => {
  it("average vs obese → different tissue compliance", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const obeseConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "obese" },
    });

    // Obese should have higher compliance (softer tissue)
    expect(obeseConfig.tissueComplianceMap['abdomen_rlq']!).toBeGreaterThan(
      avgConfig.tissueComplianceMap['abdomen_rlq']!,
    );
  });

  it("average vs frail → different joint limits", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const frailConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "frail" },
    });

    // Frail should have reduced shoulder ROM
    expect(frailConfig.jointLimits['shoulder_R']!.max).toBeLessThan(
      avgConfig.jointLimits['shoulder_R']!.max,
    );
  });

  it("different habitus → different guarding thresholds", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const frailConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "frail" },
    });

    const avgRlq = avgConfig.guardingTriggers.find(
      (g) => g.region === "abdomen_rlq",
    );
    const frailRlq = frailConfig.guardingTriggers.find(
      (g) => g.region === "abdomen_rlq",
    );

    // Frail should have lower guarding threshold (more sensitive)
    expect(frailRlq!.forceThreshold).toBeLessThan(
      avgRlq!.forceThreshold,
    );

    // Frail should have higher response strength
    expect(frailRlq!.responseStrength).toBeGreaterThan(
      avgRlq!.responseStrength,
    );
  });
});

// ---------------------------------------------------------------------------
// Override behavior
// ---------------------------------------------------------------------------

describe("phenotype overrides", () => {
  it("bodyPartMasses override replaces habitus-table values", () => {
    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: {
        habitus: "average",
        bodyPartMasses: { head: 0.99, abdomen: 0.01 },
      },
    });

    expect(config.masses['head']!).toBe(0.99);
    expect(config.masses['abdomen']!).toBe(0.01);
    // Non-overridden values should come from average table
    expect(config.masses['torso']!).toBe(0.28);
  });

  it("tissueCompliance overrides replace habitus-table values", () => {
    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: {
        habitus: "average",
        tissueCompliance: { abdomen_rlq: 0.99 },
      },
    });

    expect(config.tissueComplianceMap['abdomen_rlq']!).toBe(0.99);
    // Non-overridden stays at habitus default
    expect(config.tissueComplianceMap['abdomen_llq']!).toBe(0.45);
  });

  it("jointLimits overrides replace habitus-table values", () => {
    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: {
        habitus: "average",
        jointLimits: {
          shoulder_R: { min: -2.0, max: 4.0 },
        },
      },
    });

    expect(config.jointLimits['shoulder_R']!.min).toBe(-2.0);
    expect(config.jointLimits['shoulder_R']!.max).toBe(4.0);
    // Non-overridden stays at habitus default
    expect(config.jointLimits['elbow_R']!.max).toBe(2.5);
  });

  it("guardingTriggers override fully replaces habitus-table triggers", () => {
    const customTriggers = [
      {
        region: "abdomen_rlq" as const,
        forceThreshold: 0.99,
        responseStrength: 0.99,
      },
    ];

    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: {
        habitus: "average",
        guardingTriggers: customTriggers,
      },
    });

    // Should only have the custom trigger, not the full table
    expect(config.guardingTriggers).toHaveLength(1);
    expect(config.guardingTriggers[0]!.forceThreshold).toBe(0.99);
  });

  it("explicit seed is respected", () => {
    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average", seed: 12345 },
    });

    expect(config.seed).toBe(12345);
  });

  it("seed derivation is deterministic (no explicit seed)", () => {
    const input: PhysicsConfigPhenotypeInput = {
      bodyMechanics: { habitus: "average" },
    };

    const config1 = generatePhysicsConfigFromPhenotype(input);
    const config2 = generatePhysicsConfigFromPhenotype(input);

    expect(config1.seed).toBe(config2.seed);
    // Derived seed should be the same no matter how many times called
    expect(config1.seed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Config shape validation
// ---------------------------------------------------------------------------

describe("PhysicsConfigV1 shape", () => {
  it("has configVersion 'v1'", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.configVersion).toBe("v1");
  });

  it("has fixedDt = 1/60 (C1)", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.fixedDt).toBe(1 / 60);
  });

  it("has determinismScope 'local'", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.determinismScope).toBe("local");
  });

  it("carries full notEvidenceFor (C7)", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("has generatorVersion", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.generatorVersion).toBe("0.1.0");
  });

  it("has habitus matching input", () => {
    const config = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "obese" },
    });
    expect(config.habitus).toBe("obese");
  });

  it("defaults habitus to average when not specified", () => {
    const config = generatePhysicsConfigFromPhenotype({});
    expect(config.habitus).toBe("average");
  });
});

// ---------------------------------------------------------------------------
// createDefaultPhysicsConfigV1
// ---------------------------------------------------------------------------

describe("createDefaultPhysicsConfigV1", () => {
  it("returns a valid config with default seed 42", () => {
    const config = createDefaultPhysicsConfigV1();
    expect(config.seed).toBe(42);
    expect(config.configVersion).toBe("v1");
    expect(config.habitus).toBe("average");
  });

  it("accepts a custom seed", () => {
    const config = createDefaultPhysicsConfigV1(777);
    expect(config.seed).toBe(777);
  });

  it("is deterministic with the same seed", () => {
    const config1 = createDefaultPhysicsConfigV1(42);
    const config2 = createDefaultPhysicsConfigV1(42);
    expect(hashState(config1)).toBe(hashState(config2));
  });

  it("produces different hashes with different seeds", () => {
    const config1 = createDefaultPhysicsConfigV1(42);
    const config2 = createDefaultPhysicsConfigV1(99);
    expect(hashState(config1)).not.toBe(hashState(config2));
  });
});
