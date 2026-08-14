/**
 * Window evidence globals that ui-xr pages expose and evidence captures read. The app
 * declares these with full types in apps/ui-xr/src/main.ts; this project declares only
 * the fields the tools read, so captures compile without building the app. Loose index
 * access is deliberate: the payloads are runtime-injected evidence grab-bags.
 */
declare global {
  interface Window {
    __isoReady?: boolean;
    __isoError?: string | boolean;
    __isoAnimEvidence?: { ready?: boolean };
    __openClinXrPedsAdaptiveDialogueEvidence?: {
      latestPolicyTrigger?: string;
      latestSequenceSource?: string;
      humanoidSourceComparator?: string;
      schoolAgePatientAssetPath?: string;
      realGarmentPatientAssetPath?: string;
      adaptiveTraceTags?: string[];
      promotionFlow?: string;
    } & Record<string, any>;
    __openClinXrPedsActorPlayerRuntimePlaybackEvidence?: {
      latestTriggerSource?: string;
    } & Record<string, any>;
    __openClinXrSceneAssetEvidence?: {
      assets?: unknown[];
      loadedCount?: number;
      gazeProbePlayback?: string;
    } & Record<string, any>;
    __openClinXrMouthGazePoseComparatorEvidence?: {
      comparator?: string;
      captureMode?: string;
      morphTargetAppliedTargetCount?: number;
      emotionTransitionCuePresent?: boolean;
      visemeTimelineComparatorEvidencePresent?: boolean;
      gazeProbePlayback?: string;
      garmentGeometry?: { sleeveDeform?: unknown };
    } & Record<string, any>;
    __openClinXrBootEvidence?: {
      cameraFraming?: unknown;
      pageErrors?: unknown;
    } & Record<string, any>;
    __openClinXrHumanoidSpeechEvidence?: Record<string, any>;
    __openClinXrModelVettingDualCaptureEvidence?: Record<string, any>;
  }
}

export {};
