/**
 * Real-garment sleeve-deform capture predicate — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The comparator argument is the app-owned
 * selectedHumanoidSourceComparator() value; the package never reads app state.
 */

import { selectedCaptureMode } from "./capture-mode.js";

const REAL_GARMENT_COMPARATORS = new Set([
  "peds_anny_real_garment_patient",
  "ed_anny_real_garment_patient",
  "peds_anny_real_garment_parent",
  "peds_anny_real_garment_nurse",
]);

export function isRealGarmentSleeveDeformCapture(
  comparator: string | null,
  captureMode: string = selectedCaptureMode(),
): boolean {
  const isRealGarmentCmp = comparator !== null && REAL_GARMENT_COMPARATORS.has(comparator);
  return isRealGarmentCmp
    && (captureMode.includes("garment-sleeve")
      || captureMode.includes("sleeve-deform")
      || captureMode.includes("body-motion-garment")
      || captureMode.includes("real-garment-body")
      || captureMode.includes("sleeve"));
}
