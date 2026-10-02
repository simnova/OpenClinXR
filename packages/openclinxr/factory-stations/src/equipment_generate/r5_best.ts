import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";

/**
 * R5-BEST export treatment for equipment_generate (MADR 0059 round 5b).
 * New logic lives here so equipment_generate/run.ts stays at its file-size budget.
 * The treatment itself is packages/.../equipment_generate/r5_best_treatment.py
 * (promoted from the round-5 evidence script); run_bake_isolated.py applies the
 * same steps inline when --export-treatment r5-best is passed.
 */

/** Closed opt-in enum value for EquipmentGeneratePlan.exportTreatment. */
export const R5_BEST_EXPORT_TREATMENT = "r5-best" as const;

/** Pipeline record stages, in order (mirrors the promoted script's record). */
export const R5_BEST_TREATMENT_PIPELINE = [
  "cpu_fill_holes",
  "weld_5dp",
  "island_filter",
  "to_glb_decimate_40000",
  "uv_unwrap",
  "pbr_bake_512",
] as const;

/** Guarded island-filter face share (round5b manifest: 18 -> 1 components). */
export const R5_BEST_THRESHOLD_SHARE = 0.0001;

/** Pre-bake decimation target faces. */
export const R5_BEST_DECIMATION_TARGET = 40_000;

/** PBR bake texture edge length. */
export const R5_BEST_TEXTURE_SIZE = 512;

/** Round-5b conditioning image, repo-relative (same file generate-round3.py uses). */
export const R5_BEST_ECG_CART_CONDITIONING_IMAGE_REL =
  "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/inputs/ecg-cart-oracle-matted.png" as const;

/** Abs path of the promoted R5-BEST treatment script. */
export function r5BestTreatmentScriptPath(root = repoRoot()): string {
  return path.join(root, "packages/openclinxr/factory-stations/src/equipment_generate/r5_best_treatment.py");
}

/** Abs path of the round-5b conditioning image (null when absent). */
export function r5BestConditioningImagePath(root = repoRoot()): string | null {
  const abs = path.join(root, R5_BEST_ECG_CART_CONDITIONING_IMAGE_REL);
  return existsSync(abs) ? abs : null;
}

/** True exactly for the closed opt-in value. */
export function isR5BestExportTreatment(value: unknown): value is typeof R5_BEST_EXPORT_TREATMENT {
  return value === R5_BEST_EXPORT_TREATMENT;
}

export type R5BestPlanFields = {
  exportTreatment: typeof R5_BEST_EXPORT_TREATMENT | null;
  treatmentPipeline: readonly string[] | null;
};

/** Plan-time R5-BEST fields. Absent input -> both null (plan otherwise unchanged). */
export function r5BestPlanFields(input: Record<string, unknown>): R5BestPlanFields {
  if (!isR5BestExportTreatment(input["exportTreatment"])) {
    return { exportTreatment: null, treatmentPipeline: null };
  }
  return { exportTreatment: R5_BEST_EXPORT_TREATMENT, treatmentPipeline: [...R5_BEST_TREATMENT_PIPELINE] };
}

/**
 * Input images for an R5-BEST run: the subject pack views when present,
 * else the round-5b conditioning image for ecg-cart (which ships no pack).
 */
export function r5BestInputImages(
  subjectId: string,
  packImagePaths: string[],
  root = repoRoot(),
): string[] {
  if (packImagePaths.length > 0) return packImagePaths;
  if (subjectId === "ecg-cart") {
    const conditioning = r5BestConditioningImagePath(root);
    if (conditioning) return [conditioning];
  }
  return packImagePaths;
}

/** Bake flags forcing the adopted treatment (appended after the standard argv). */
export function r5BestBakeArgvExtra(): string[] {
  return [
    "--export-treatment",
    R5_BEST_EXPORT_TREATMENT,
    "--island-threshold-share",
    String(R5_BEST_THRESHOLD_SHARE),
    "--decimation-target",
    String(R5_BEST_DECIMATION_TARGET),
    "--texture-size",
    String(R5_BEST_TEXTURE_SIZE),
  ];
}
