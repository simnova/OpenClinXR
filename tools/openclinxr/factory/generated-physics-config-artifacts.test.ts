/**
 * Tests for generated-physics-config-artifacts.ts.
 *
 * Requirements:
 *   1. Same phenotype → same config + provenance (deterministic)
 *   2. Different habitus → different configs
 *   3. Report embeds all required provenance fields (promotionStatus, realismGrade,
 *      notEvidenceFor, phenotypeHash, engineId+version, determinismScope)
 *   4. Schema version + kind constants are correct
 *   5. Validation catches bad reports
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultPhysicsConfigArtifact,
  generatePhysicsConfigArtifact,
  GENERATED_PHYSICS_CONFIG_KIND,
  GENERATED_PHYSICS_CONFIG_OUTPUT_DIR,
  GENERATED_PHYSICS_CONFIG_SCHEMA_VERSION,
  type GeneratedPhysicsConfigReport,
  type PhysicsConfigArtifactInput,
  validateGeneratedPhysicsConfigArtifact,
} from "./generated-physics-config-artifacts.js";

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — determinism", () => {
  it("same phenotype → identical report (structural equality)", () => {
    const input: PhysicsConfigArtifactInput = {
      caseId: "peds_asthma_parent_anxiety_v1",
      actorId: "patient_maya_johnson_v1",
      phenotype: {
        bodyMechanics: { habitus: "average" },
      },
    };

    const report1 = generatePhysicsConfigArtifact(input);
    const report2 = generatePhysicsConfigArtifact(input);

    // Timestamps will differ, so compare the stable fields
    expect(report1.config.seed).toBe(report2.config.seed);
    expect(report1.provenance.phenotypeHash).toBe(report2.provenance.phenotypeHash);
    expect(report1.config.masses).toEqual(report2.config.masses);
    expect(report1.config.jointLimits).toEqual(report2.config.jointLimits);
    expect(report1.config.tissueComplianceMap).toEqual(report2.config.tissueComplianceMap);
    expect(report1.config.guardingTriggers).toEqual(report2.config.guardingTriggers);
    expect(report1.config.habitus).toBe(report2.config.habitus);
  });

  it("identical inputs with no bodyMechanics produce identical configs", () => {
    const report1 = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: {},
    });

    const report2 = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: {},
    });

    expect(report1.config.seed).toBe(report2.config.seed);
    expect(report1.provenance.phenotypeHash).toBe(report2.provenance.phenotypeHash);
    expect(report1.config.masses).toEqual(report2.config.masses);
  });
});

// ---------------------------------------------------------------------------
// Habitus differentiation
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — habitus differentiation", () => {
  it("average vs obese → different masses", () => {
    const avg = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "average" } },
    });

    const obese = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "obese" } },
    });

    // Obese should have higher abdominal mass
    expect(obese.config.masses["abdomen"]).toBeGreaterThan(
      avg.config.masses["abdomen"],
    );
  });

  it("average vs frail → different compliance", () => {
    const avg = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "average" } },
    });

    const frail = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "frail" } },
    });

    // Frail should have lower torso mass and different compliance
    expect(frail.config.masses["torso"]).toBeGreaterThan(
      avg.config.masses["torso"],
    );
    expect(
      frail.config.tissueComplianceMap["abdomen_ruq"],
    ).toBeLessThan(avg.config.tissueComplianceMap["abdomen_ruq"]);
  });
});

// ---------------------------------------------------------------------------
// Provenance embedding
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — provenance", () => {
  it("embeds all required provenance fields", () => {
    const report = generatePhysicsConfigArtifact({
      caseId: "ed_chest_pain_priority_v2",
      actorId: "patient_ed_chest_pain_v1",
      phenotype: {
        bodyMechanics: { habitus: "average" },
      },
    });

    // Promotion status — always false
    expect(report.provenance.promotionStatus).toBe(false);

    // Realism grade — always B
    expect(report.provenance.realismGrade).toBe("B");

    // Determinism scope — always local (OD-3)
    expect(report.provenance.determinismScope).toBe("local");

    // notEvidenceFor — C7 clauses present
    expect(report.provenance.notEvidenceFor).toContain("clinical_validity");
    expect(report.provenance.notEvidenceFor).toContain("exam_equivalence");
    expect(report.provenance.notEvidenceFor).toContain("scoring");
    expect(report.provenance.notEvidenceFor).toContain("learner_readiness");

    // Phenotype hash — 64-char hex string
    expect(report.provenance.phenotypeHash).toMatch(/^[0-9a-f]{64}$/);

    // Engine metadata
    expect(report.provenance.engineId).toBe("rapier");
    expect(report.provenance.engineVersion).toBeTruthy();
  });

  it("engine metadata can be overridden", () => {
    const report = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: {},
      engine: {
        id: "havok",
        version: "2.5.0-wasm",
      },
    });

    expect(report.provenance.engineId).toBe("havok");
    expect(report.provenance.engineVersion).toBe("2.5.0-wasm");
  });

  it("phenotypeHash changes when bodyMechanics change", () => {
    const r1 = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "average" } },
    });

    const r2 = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: { bodyMechanics: { habitus: "obese" } },
    });

    expect(r1.provenance.phenotypeHash).not.toBe(r2.provenance.phenotypeHash);
  });

  it("phenotypeHash is stable for identical input", () => {
    const input: PhysicsConfigArtifactInput = {
      caseId: "peds_asthma_parent_anxiety_v1",
      actorId: "patient_maya_johnson_v1",
      phenotype: {
        bodyMechanics: {
          habitus: "average",
          seed: 12345,
          bodyPartMasses: { head: 0.08 },
        },
      },
    };

    const r1 = generatePhysicsConfigArtifact(input);
    const r2 = generatePhysicsConfigArtifact(input);

    expect(r1.provenance.phenotypeHash).toBe(r2.provenance.phenotypeHash);
  });
});

// ---------------------------------------------------------------------------
// Schema version and kind
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — schema", () => {
  it("has correct schema version", () => {
    const report = createDefaultPhysicsConfigArtifact();
    expect(report.schemaVersion).toBe(
      "openclinxr.generated-physics-config-artifacts.v1",
    );
  });

  it("has correct kind", () => {
    const report = createDefaultPhysicsConfigArtifact();
    expect(report.kind).toBe("generated_physics_config_artifacts");
  });

  it("has correct output dir", () => {
    expect(GENERATED_PHYSICS_CONFIG_OUTPUT_DIR).toBe(
      ".openclinxr/asset-production/physics-config",
    );
  });
});

// ---------------------------------------------------------------------------
// Config structure
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — config structure", () => {
  it("config has all required fields", () => {
    const report = createDefaultPhysicsConfigArtifact();

    expect(report.config.configVersion).toBe("v1");
    expect(report.config.determinismScope).toBe("local");
    expect(report.config.fixedDt).toBe(1 / 60);
    expect(typeof report.config.seed).toBe("number");
    expect(typeof report.config.habitus).toBe("string");

    // Masses must be non-empty
    expect(Object.keys(report.config.masses).length).toBeGreaterThan(0);

    // Joint limits must be non-empty
    expect(Object.keys(report.config.jointLimits).length).toBeGreaterThan(0);

    // Tissue compliance must be non-empty
    expect(
      Object.keys(report.config.tissueComplianceMap).length,
    ).toBeGreaterThan(0);

    // Guarding triggers must be non-empty
    expect(report.config.guardingTriggers.length).toBeGreaterThan(0);
  });

  it("overrides work correctly", () => {
    const report = generatePhysicsConfigArtifact({
      caseId: "test",
      actorId: "actor",
      phenotype: {
        bodyMechanics: {
          habitus: "average",
          bodyPartMasses: { head: 0.5 },
        },
      },
    });

    expect(report.config.masses["head"]).toBe(0.5);
    // Other masses should still be populated from the table
    expect(report.config.masses["torso"]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — validation", () => {
  it("valid report passes validation", () => {
    const report = createDefaultPhysicsConfigArtifact();
    const result = validateGeneratedPhysicsConfigArtifact(report);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("null input fails validation", () => {
    const result = validateGeneratedPhysicsConfigArtifact(null);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("/ must be an object");
  });

  it("wrong schemaVersion fails validation", () => {
    const report = {
      ...createDefaultPhysicsConfigArtifact(),
      schemaVersion: "wrong.version",
    };
    const result = validateGeneratedPhysicsConfigArtifact(report);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "/schemaVersion must be openclinxr.generated-physics-config-artifacts.v1",
    );
  });

  it("wrong engineId fails validation", () => {
    const report = createDefaultPhysicsConfigArtifact();
    report.provenance.engineId = "";
    const result = validateGeneratedPhysicsConfigArtifact(report);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "/provenance/engineId must be a non-empty string",
    );
  });

  it("missing notEvidenceFor clauses fail validation", () => {
    const report = createDefaultPhysicsConfigArtifact();
    report.provenance.notEvidenceFor = [
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      // missing learner_readiness
    ] as any; // test fixture — overrides notEvidenceFor for validation
    
    const result = validateGeneratedPhysicsConfigArtifact(report);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      '/provenance/notEvidenceFor must include "learner_readiness"',
    );
  });
});

// ---------------------------------------------------------------------------
// Policy block
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — policy", () => {
  it("policy block asserts local-only, no external deps", () => {
    const report = createDefaultPhysicsConfigArtifact();

    expect(report.policy.localOnly).toBe(true);
    expect(report.policy.installsIntroduced).toBe(false);
    expect(report.policy.cloudApisUsed).toBe(false);
    expect(report.policy.paidApisUsed).toBe(false);
    expect(report.policy.externalAssetsUsed).toBe(false);
    expect(report.policy.productionAssetReadinessClaimed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

describe("generated physics config artifacts — verdict", () => {
  it("default average config passes with no blockers", () => {
    const report = createDefaultPhysicsConfigArtifact();
    expect(report.verdict.passed).toBe(true);
    expect(report.verdict.blockers).toHaveLength(0);
  });

  it("caseId and actorId are recorded in input", () => {
    const report = generatePhysicsConfigArtifact({
      caseId: "peds_asthma_parent_anxiety_v1",
      actorId: "patient_maya_johnson_v1",
      phenotype: { bodyMechanics: { habitus: "average" } },
    });

    expect(report.input.caseId).toBe("peds_asthma_parent_anxiety_v1");
    expect(report.input.actorId).toBe("patient_maya_johnson_v1");
    expect(report.input.habitus).toBe("average");
    expect(typeof report.input.seed).toBe("number");
  });
});
