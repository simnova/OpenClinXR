/**
 * Capture-mode query plumbing — extracted from apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE).
 *
 * Pure query-string reads; no module state. Wiring reads selectedCaptureMode()
 * once and passes the mode into the predicate variants.
 */

export function readSelectedCaptureMode(search: string): string {
  const params = new URLSearchParams(search);
  return params.get("capture")?.trim()
    ?? params.get("openclinxrCaptureMode")?.trim()
    ?? "";
}

export function selectedCaptureMode(): string {
  return readSelectedCaptureMode(window.location.search);
}

export function isActorCloseRealismCaptureMode(captureMode: string = selectedCaptureMode()): boolean {
  return captureMode.includes("actor-close");
}

export function isHumanoidFaceDetailCaptureMode(captureMode: string = selectedCaptureMode()): boolean {
  return captureMode.includes("face-rig") || captureMode.includes("face-detail") || captureMode.includes("lip-eye");
}

export function isGeneratedSceneOverviewCaptureMode(captureMode: string = selectedCaptureMode()): boolean {
  return captureMode.includes("dynamic-only")
    || captureMode.includes("generated-scene")
    || captureMode.includes("scene-overview");
}

export function isActorPoseReviewCaptureMode(captureMode: string = selectedCaptureMode()): boolean {
  return captureMode.includes("actor-pose") || captureMode.includes("pose-review") || captureMode.includes("mouth-gaze-pose");
}

export function isHumanoidMouthGazePoseReviewCaptureMode(
  captureMode: string = selectedCaptureMode(),
  sleeveDeformCapture = false,
): boolean {
  return captureMode.includes("mouth-gaze-pose")
    || captureMode.includes("actor-pose")
    || captureMode.includes("pose-review")
    || sleeveDeformCapture;
}

/**
 * Physics-driven palpation bone transforms on real garment comparator — OPT-IN CAPTURE ONLY.
 *
 * PRE-PRODUCTION FENCE (physics-realbind-pre-prod-fence-v1):
 *   Returns true only when capture mode explicitly includes "physics-clinical-touch" or "physics-touch".
 *   Default session path returns false → physics transforms NOT applied.
 */
export function isPhysicsClinicalTouchCapture(
  captureMode: string = selectedCaptureMode(),
  comparator: string | null = null,
): boolean {
  if (!captureMode.includes("physics-clinical-touch") && !captureMode.includes("physics-touch")) return false;
  const cmp = comparator
    ?? new URLSearchParams(window.location.search).get("humanoidSourceComparator")?.trim()
    ?? null;
  return cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient";
}

export function shouldShowRuntimeAffordanceMarkers(
  captureMode: string = selectedCaptureMode(),
  generatedSceneMode: boolean,
): boolean {
  return !generatedSceneMode
    || captureMode.includes("affordance")
    || captureMode.includes("evidence")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

export function shouldShowPrimitiveAssetFallbacks(
  captureMode: string = selectedCaptureMode(),
  generatedSceneMode: boolean,
): boolean {
  return !generatedSceneMode
    || captureMode.includes("fallback")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

export function shouldShowInSceneEvidencePanels(
  captureMode: string = selectedCaptureMode(),
  generatedSceneMode: boolean,
): boolean {
  return !generatedSceneMode
    || captureMode.includes("panel")
    || captureMode.includes("evidence")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

export function shouldShowInSceneIdentityLabels(
  captureMode: string = selectedCaptureMode(),
  generatedSceneMode: boolean,
): boolean {
  return !generatedSceneMode
    || captureMode.includes("label")
    || captureMode.includes("identity")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

export function isSceneOnlyVisualReviewCaptureMode(
  captureMode: string = selectedCaptureMode(),
  cleanComparatorCapture = false,
): boolean {
  // ed-bay-visible keeps the room shell: never route it through the scene-only review filter.
  if (captureMode.includes("ed-bay-visible")) return false;
  return captureMode.includes("scene-only")
    || captureMode.includes("dynamic-only")
    || captureMode.includes("visual-cleanup")
    || cleanComparatorCapture;
}
