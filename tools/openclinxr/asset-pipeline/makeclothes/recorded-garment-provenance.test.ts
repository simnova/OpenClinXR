import { describe, expect, it } from "vitest";
import {
  isLegacyRecordedProceduralGown,
  RECORDED_ADULT_PRODUCER_KIND,
  RECORDED_ADULT_PRODUCER_TOOL,
  RECORDED_ED_INPUT_GLB,
  RECORDED_GOWN_GENERATOR_TOOL,
} from "./recorded-garment-provenance.ts";

/** Recorded-provenance consumer tests: RECORDED attribution only. */
const ADULT_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const ED_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.glb";
const ADULT_SHA = "88f094703dfc96811af56c6bb6070933f654a6a58c8ded3e5feac296e5561406";
const ED_SHA = "dedcbb3e417e59b28a19d3f5bc73169b3fae98ece580111193d3a092126ae1f5";
const RECIPE = "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py#regular-clinical-gown-cage";
const GOWN_EXTRAS = { garmentClass: "gown", licence: "first-party OpenClinXR procedural geometry", sourceRecipe: RECIPE };
const ADULT_LIN = {
  sourceOriginChain: { derivationCommits: [{ commit: "af1fed4e" }], derivationNote: "reconstructed chain" },
  operations: [
    {
      kind: RECORDED_ADULT_PRODUCER_KIND,
      tool: RECORDED_ADULT_PRODUCER_TOOL,
      inputSha256: "d99e55ff594247af91d53ec5d0f4192a39bc898174f5d11b40da7a7c7d709276",
      outputSha256: "0614cf0ece42b917683b26120bce07a7de813bbd6858195007dc78aa7bdb54b4",
    },
  ],
  outputSha256: ADULT_SHA,
};
const ED_LIN = {
  assetPath: ED_PATH,
  outputSha256: ED_SHA,
  byteLineage: {
    derivationArgv: ["blender", "--background", "--python", RECORDED_GOWN_GENERATOR_TOOL, "--", "--input-glb", RECORDED_ED_INPUT_GLB, "--output-glb", "<OWN>/candidates/apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.glb"],
    inputSha256: "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66",
  },
  operations: [{ tool: RECORDED_GOWN_GENERATOR_TOOL, exit: 0 }],
  caseInputs: { source: "edChestPainScenario", caseModule: "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts", caseModuleSha256: "f083bbe68b014869ae8c4a03f3757b6e3bc03fa543bc4570bd808dcbe91cfe4f", fieldsReachingBuilderAtThisRun: ["garmentLayers=hospital_gown (exact)"] },
};

describe("recorded garment provenance", () => {
  it("accepts both recorded gowns", () => {
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: ADULT_LIN, sidecarAssetPath: ADULT_PATH, expectedAssetPath: ADULT_PATH, actualGlbSha256: ADULT_SHA, generatorFileExists: true })).toEqual({ ok: true, legacyType: "LEGACY_RECORDED_PROCEDURAL" });
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: ED_LIN, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true })).toEqual({ ok: true, legacyType: "LEGACY_RECORDED_PROCEDURAL" });
  });
  it("rejects tampered class/license/recipe/outputSHA/producer/lineage/fakeMhclo/malformed-modern/unknown", () => {
    const base = { meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: ADULT_LIN, sidecarAssetPath: ADULT_PATH, expectedAssetPath: ADULT_PATH, actualGlbSha256: ADULT_SHA, generatorFileExists: true };
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, garmentClass: "tshirt" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, licence: "CC0" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, sourceRecipe: "x#y" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, actualGlbSha256: "0".repeat(64) }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecar: { ...ADULT_LIN, outputSha256: "nothex" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecarAssetPath: ED_PATH }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecar: { ...ADULT_LIN, outputSha256: ADULT_SHA }, generatorFileExists: false }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecar: { outputSha256: ADULT_SHA } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecar: { ...ADULT_LIN, outputSha256: ADULT_SHA, sourceOriginChain: { derivationCommits: [], derivationNote: "n" } } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, sidecar: { ...ADULT_LIN, outputSha256: ADULT_SHA, operations: [{ kind: "other", tool: "x", inputSha256: "d99e55ff594247af91d53ec5d0f4192a39bc898174f5d11b40da7a7c7d709276", outputSha256: "0614cf0ece42b917683b26120bce07a7de813bbd6858195007dc78aa7bdb54b4" }] } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, sourceMhclo: "fake.mhclo" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, sourceKind: "procedural" } }).ok).toBe(false);
    expect(isLegacyRecordedProceduralGown({ ...base, meshName: "makeclothes_library_zzz_unknown_mesh", extras: {} }).ok).toBe(false);
  });
  it("raw C7 integration control: known gown with fake Mhclo fails, never continues", () => {
    const base = { meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: ADULT_LIN, sidecarAssetPath: ADULT_PATH, expectedAssetPath: ADULT_PATH, actualGlbSha256: ADULT_SHA, generatorFileExists: true };
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, sourceMhclo: "forged.mhclo" } })).toEqual({ ok: false, failed: "C7" });
  });
  it("modern inline valid passes legacy gate only as reject; legacy helper never launders modern", () => {
    const base = { meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: ADULT_LIN, sidecarAssetPath: ADULT_PATH, expectedAssetPath: ADULT_PATH, actualGlbSha256: ADULT_SHA, generatorFileExists: true };
    expect(isLegacyRecordedProceduralGown({ ...base, extras: { ...GOWN_EXTRAS, sourceKind: "procedural", sourceGenerator: "g", sourceHash: "h" } }).ok).toBe(false);
  });
  it("missing --output-glb, non-string argv, bare {random:1} caseInputs fail RECORD shape", () => {
    const noOut = { ...ED_LIN, byteLineage: { derivationArgv: ["blender", "--python", RECORDED_GOWN_GENERATOR_TOOL, "--", "--input-glb", RECORDED_ED_INPUT_GLB], inputSha256: "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66" } };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: noOut, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
    const nonStr = { ...ED_LIN, byteLineage: { derivationArgv: ["blender", "--python", RECORDED_GOWN_GENERATOR_TOOL, "--", "--input-glb", RECORDED_ED_INPUT_GLB, "--output-glb", "mpfb-gown-ed-robert-hayes.glb", 7], inputSha256: "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66" } };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: nonStr, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
    const bare = { ...ED_LIN, caseInputs: { random: 1 } };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: bare, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
    const wrongBase = { ...ED_LIN, byteLineage: { derivationArgv: ["blender", "--python", RECORDED_GOWN_GENERATOR_TOOL, "--", "--input-glb", RECORDED_ED_INPUT_GLB, "--output-glb", "other.glb"], inputSha256: "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66" } };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: wrongBase, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
  });
  it("dangling argv negative: --input-glb without value and bare caseInputs fail", () => {
    const noInputVal = { ...ED_LIN, byteLineage: { derivationArgv: ["blender", "--python", RECORDED_GOWN_GENERATOR_TOOL, "--", "--input-glb"], inputSha256: "27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66" } };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: noInputVal, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
    const bareCase = { ...ED_LIN, caseInputs: {} };
    expect(isLegacyRecordedProceduralGown({ meshName: "openclinxr_real_garment_hospital_gown_mesh", extras: GOWN_EXTRAS, sidecar: bareCase, sidecarAssetPath: ED_PATH, expectedAssetPath: ED_PATH, actualGlbSha256: ED_SHA, generatorFileExists: true }).ok).toBe(false);
  });
});
