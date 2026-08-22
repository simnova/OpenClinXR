import { INFINIGEN_ENVIRONMENT_ASSETS } from "./infinigen-environment-assets.js";

/**
 * #575 — the loader used to derive a room filename from an asset NEED-ID
 * (`${environmentId without _vN}_environment.glb`) and no shipped file matched it, so every
 * station booted with the environment reported `failed` and a blank viewport. Resolution is
 * now table-driven: the same environmentId→GLB map that `loadInfinigenEnvironmentIntoStation`
 * consumes answers for the bundle path too. Version-insensitive: the need-id strips `_v1`,
 * so `pediatric_urgent_care_bay_environment` must resolve to the map row for
 * `pediatric_urgent_care_bay_v1`. Unmapped names fall through verbatim (e.g. `ed.glb`,
 * rewritten below by the pre-existing ED shell special case).
 */
export function resolveLocalEnvironmentRuntimeAssetFileName(fileName: string): string {
  const table = INFINIGEN_ENVIRONMENT_ASSETS as Readonly<Record<string, string>>;
  const stem = fileName.replace(/\.glb$/u, "");
  // A blobName that already IS an environmentId (e.g. `ed_exam_bay_v1.glb`).
  const direct = table[stem];
  if (direct) {
    return direct.split("/").at(-1)!;
  }
  // The factory's need-id form: `<environmentId without _vN>_environment.glb`.
  if (stem.endsWith("_environment")) {
    const mapped = table[`${stem.slice(0, -"_environment".length)}_v1`];
    if (mapped) {
      return mapped.split("/").at(-1)!;
    }
  }
  if (fileName === "ed.glb" || fileName === "ed_environment.glb") {
    return "ed-exam-bay-shell.glb";
  }
  return fileName;
}

/**
 * Equipment filenames arrive from factory reports already matching shipped files under
 * xr-assets/medical-equipment/ (`ecg-cart-12-lead.glb`, `iv-pole-with-pump.glb`); the
 * historical aliases stay because older bundles still carry them.
 */
export function resolveLocalEquipmentRuntimeAssetFileName(fileName: string): string {
  if (fileName === "ecg.glb") {
    return "ecg-cart-12-lead.glb";
  }
  if (fileName === "iv-pole.glb" || fileName === "iv_pole.glb") {
    return "iv-pole-with-pump.glb";
  }
  return fileName;
}
