import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../../..");
const REPORT_PATH = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/skin/vitruvian_dark/report.json",
);
const GLB_PATH = join(
  ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
);

type RegionMetric = {
  actual_region_minus_forehead: number[];
  african_region_minus_forehead: number[];
  absolute_error_a_star: number;
  absolute_error_b_star: number;
  two_x_patch_sd_a_star: number;
  two_x_patch_sd_b_star: number;
  pass: boolean;
};

type Report = {
  stage: string;
  output: { sha256: string; bytes: number };
  metrics: {
    regions: Record<"lip" | "ear" | "nose", RegionMetric>;
    forehead_to_cheek: { absolute_error: number; floor: number; pass: boolean };
  };
  multiplyControl: { regions: { lip: RegionMetric } };
  allNonSkinImagesUnchanged: boolean;
  allNonSkinBufferViewsUnchanged: boolean;
  nonSkinImagesUnchanged: Record<string, boolean>;
  probeZeroRegionSeparations: boolean;
  corrections: Record<string, { mode: string; detail_scale_lab?: number[] }>;
};

const REPORT = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the shipped dark atlas keeps the African map's regional chroma", () => {
  it("grades the shipped GLB bytes, not a detached candidate", () => {
    expect(REPORT.stage).toBe("vitruvian_dark_cielab_remap_v2");
    expect(REPORT.probeZeroRegionSeparations).toBe(false);
    // The remap output is either shipped as-is, or is the exact input of the later
    // JSON-only hair-colour stage (st-vitbrow r4, BIN chunk verbatim), whose output either ships
    // or feeds the provenance `stages` chain that ends at the shipped bytes.
    const shipped = sha256(GLB_PATH);
    const provenance = JSON.parse(readFileSync(GLB_PATH.replace(/\.glb$/, ".provenance.json"), "utf8")) as {
      actorHairColourPostExport?: { stage: string; inputGlbSha256: string; outputGlbSha256: string; outputBytes: number };
      actorBrowTransplantPostExport?: { stage: string; inputGlbSha256: string; outputGlbSha256: string; outputBytes: number };
      stages?: { stage: string; inputSha256: string; outputSha256: string; outputBytes: number }[];
    };
    const hair = provenance.actorHairColourPostExport;
    const transplant = provenance.actorBrowTransplantPostExport;
    const laterStages = provenance.stages ?? [];
    expect([
      transplant?.stage,
      hair?.stage,
      ...laterStages.map((row) => row.stage),
    ]).toEqual([
      "actor_brow_transplant_post_export_v1",
      "actor_hair_colour_post_export_v1",
      "subject_derived_roughness_breakup_v3",
    ]);
    // Hair is a byte no-op after transplant, so its earlier provenance row stays
    // intact; the adjacent hashes prove hair -> transplant -> roughness lineage.
    expect(transplant?.inputGlbSha256).toBe(hair?.outputGlbSha256);
    let chainEnd = transplant?.outputGlbSha256;
    let chainBytes = transplant?.outputBytes;
    for (const later of laterStages) {
      expect(later.inputSha256).toBe(chainEnd);
      chainEnd = later.outputSha256;
      chainBytes = later.outputBytes;
    }
    if (REPORT.output.sha256 === shipped) {
      expect(REPORT.output.bytes).toBe(readFileSync(GLB_PATH).byteLength);
    } else {
      expect(hair?.stage).toBe("actor_hair_colour_post_export_v1");
      expect(hair?.inputGlbSha256).toBe(REPORT.output.sha256);
      expect(chainEnd).toBe(shipped);
      expect(chainBytes).toBe(readFileSync(GLB_PATH).byteLength);
    }
  });

  it("R1-R3 cause guard: lip and lid use bounded-detail target fields", () => {
    for (const region of ["lip", "mouth_corner", "upper_lid"] as const) {
      expect(REPORT.corrections[region]?.mode).toBe("target_field_with_bounded_detail");
      expect(REPORT.corrections[region]?.detail_scale_lab).toEqual([0.75, 0.15, 0.15]);
    }
  });

  it("G1: lip, ear, and nose a*/b* separations are within two African patch SD", () => {
    for (const region of ["lip", "ear", "nose"] as const) {
      const row = REPORT.metrics.regions[region];
      expect(row.absolute_error_a_star, `${region} a*`).toBeLessThanOrEqual(row.two_x_patch_sd_a_star);
      expect(row.absolute_error_b_star, `${region} b*`).toBeLessThanOrEqual(row.two_x_patch_sd_b_star);
      expect(row.pass, region).toBe(true);
    }
  });

  it("G1 counterweight: the cheek RGB multiply fails the lip clause", () => {
    const lip = REPORT.multiplyControl.regions.lip;
    expect(lip.pass).toBe(false);
    expect(
      lip.absolute_error_a_star > lip.two_x_patch_sd_a_star
        || lip.absolute_error_b_star > lip.two_x_patch_sd_b_star,
    ).toBe(true);
  });

  it("G2: forehead-to-cheek dE00 stays within the r1 African-map floor", () => {
    const row = REPORT.metrics.forehead_to_cheek;
    expect(row.absolute_error).toBeLessThanOrEqual(row.floor);
    expect(row.pass).toBe(true);
  });

  it("G4: eyes, garments, hair, brows, and all other non-skin payloads are byte-identical", () => {
    expect(REPORT.allNonSkinImagesUnchanged).toBe(true);
    expect(REPORT.allNonSkinBufferViewsUnchanged).toBe(true);
    expect(Object.entries(REPORT.nonSkinImagesUnchanged)).toContainEqual(["vitruvian-iris-green", true]);
    expect(Object.values(REPORT.nonSkinImagesUnchanged).every(Boolean)).toBe(true);
  });
});

describe("deep_warm is a first-class authored tone token", () => {
  it("is present in the case, UI, materializer, refit rail, and reference constants", () => {
    const files = [
      "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts",
      "packages/openclinxr/ui-route-admin/src/actor-phenotype-fields.tsx",
      "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
      "packages/openclinxr/factory-stations/src/clothing_consume/refit_materials.py",
      "tools/openclinxr/asset-pipeline/reference-set/reference_constants.json",
    ];
    for (const file of files) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain("deep_warm");
    }
  });

  it("pins the D13 seed and selected actor in the case", () => {
    const source = readFileSync(
      join(ROOT, "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts"),
      "utf8",
    );
    expect(source).toContain('skin_tone_selection_seed: "st-vitdark-r2-2026-11-04"');
    expect(source).toContain('actorId: "spouse_anna_hayes_v1"');
    expect(source).toContain('skin_tone: "deep_warm"');
  });
});
