/**
 * In-scene panel + review-filter predicates — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). Module-level app state (comparator flags, speech
 * evidence) arrives as parameters; the package owns no mutable state.
 */

import { isHumanoidMouthGazePoseReviewCaptureMode, selectedCaptureMode, shouldShowInSceneEvidencePanels } from "./capture-mode.js";

export function shouldShowActorRealismRequirementPanel(
  captureMode: string,
  activeActorRuntimeRealismRequirement: unknown,
  opts: {
    cleanComparatorCapture: boolean;
    edBayVisibleCapture: boolean;
    evidencePanelsVisible: boolean;
    mouthGazePoseReview: boolean;
  },
): boolean {
  if (opts.cleanComparatorCapture && !opts.edBayVisibleCapture) {
    return false;
  }
  return opts.evidencePanelsVisible
    || opts.mouthGazePoseReview
    || (captureMode.includes("actor-realism") && Boolean(activeActorRuntimeRealismRequirement));
}

export function shouldShowActorRealismRequirementPanelForCapture(
  captureMode: string = selectedCaptureMode(),
  activeActorRuntimeRealismRequirement: unknown = null,
  opts: { cleanComparatorCapture: boolean; edBayVisibleCapture: boolean; sleeveDeformCapture: boolean },
): boolean {
  return shouldShowActorRealismRequirementPanel(captureMode, activeActorRuntimeRealismRequirement, {
    cleanComparatorCapture: opts.cleanComparatorCapture,
    edBayVisibleCapture: opts.edBayVisibleCapture,
    evidencePanelsVisible: shouldShowInSceneEvidencePanels(captureMode, true),
    mouthGazePoseReview: isHumanoidMouthGazePoseReviewCaptureMode(captureMode, opts.sleeveDeformCapture),
  });
}
