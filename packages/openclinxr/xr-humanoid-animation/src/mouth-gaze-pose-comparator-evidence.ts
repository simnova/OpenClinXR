/**
 * Mouth/gaze/pose comparator evidence, split out of animation-loop.ts (500-line zone budget).
 * Behaviour unchanged — this is a module move, not a rewrite.
 */
import { applyRealGarmentEvidenceSurfaces, sleeveDeformCueForAssetPath } from "@openclinxr/xr-scene";
import { roundHumanoidExpressionWeights } from "./face-rig.js";
import type { updateHumanoidEmotionExpression } from "./face-rig.js";
import { writeMouthGazePoseComparatorEvidence } from "./speech-evidence.js";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidAnimationRuntimeContext,
} from "./types.js";

export function recordMouthGazePoseComparatorEvidence(
  ctx: HumanoidAnimationRuntimeContext,
  slot: GeneratedHumanoidAnimationSlot,
  speech: import("./types.js").HumanoidSpeechPlayback,
  viseme: string,
  openness: number,
  expressionState: ReturnType<typeof updateHumanoidEmotionExpression>,
  nowMs: number,
): void {
  if (!ctx.isMouthGazePoseReviewCaptureMode()) {
    return;
  }
  const comparator = ctx.selectedHumanoidSourceComparator();
  const isPedsRealGarmentOrSchoolForEvidence = comparator === "peds_anny_school_age_mpfb2_eye_patient" || comparator === "peds_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse" || comparator === "ed_anny_real_garment_patient";
  const evidencePrimaryActorId = ctx.runtimePatientActorId();
  if (!isPedsRealGarmentOrSchoolForEvidence || speech.actorId !== evidencePrimaryActorId) {
    return;
  }
  const morphCue = slot.root.userData["openClinXrMorphTargetRuntimeCue"] as {
    appliedTargetCount?: number;
  } | undefined;
  void morphCue;
  const speechEvidence = ctx.currentSpeechEvidence() as unknown as Record<string, unknown> | undefined;
  void speechEvidence;
  let garmentGeometry: {
    name: string;
    visible: boolean;
    source: string;
    hasVisibleVolume: boolean;
    hasSeamFoldHints: boolean;
    sleeveDeform?: string;
  } | null = null;
  if (comparator === "peds_anny_real_garment_patient" || comparator === "ed_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse") {
    const tagged = applyRealGarmentEvidenceSurfaces(slot.root, comparator);
    if (tagged) {
      const loadedAssetPath = ctx.assetPathForSlot(slot);
      const garmentSource =
        loadedAssetPath
        || (comparator === "ed_anny_real_garment_patient"
          ? "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
          : comparator === "peds_anny_real_garment_parent"
            ? "/generated-humanoids/peds_anxious_parent.glb"
            : comparator === "peds_anny_real_garment_nurse"
              ? "/generated-humanoids/peds_nurse_kevin.glb"
              : "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb");
      const sleeveDeformCue = sleeveDeformCueForAssetPath(loadedAssetPath, comparator);
      garmentGeometry = {
        name: tagged.name || "real_garment_mesh",
        visible: tagged.visible,
        source: garmentSource,
        hasVisibleVolume: true,
        hasSeamFoldHints: true,
        sleeveDeform: sleeveDeformCue,
      };
    }
  }
  writeMouthGazePoseComparatorEvidence(
    ctx,
    slot,
    speech,
    viseme,
    openness,
    expressionState,
    nowMs,
    garmentGeometry,
    roundHumanoidExpressionWeights,
    ctx.writeComparatorEvidenceRecord,
  );
}
