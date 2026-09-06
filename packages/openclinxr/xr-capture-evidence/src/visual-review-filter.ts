/**
 * Visual-review room-prop filter — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The scene-only predicate result arrives as a
 * parameter; the package owns no capture state.
 */

import type { EncounterRuntimeRoomProp } from "@openclinxr/asset-registry/runtime-bundles";
import { isSceneOnlyVisualReviewCaptureMode, selectedCaptureMode } from "./capture-mode.js";

export const SCENE_ONLY_ESSENTIAL_ROOM_PROP_IDS: ReadonlySet<string> = new Set([
  "oxygen-panel",
  "suction-canister",
  "glove-box-stack",
  "supply-cabinet",
  "privacy-curtain",
  "ceiling-exam-light",
  "patient-handoff-whiteboard",
  "ekg-leads-on-bed",
  "monitor-lead-cable",
  "patient-blanket",
  "iv-tubing-line",
  "monitor-waveform-card",
  "monitor-vitals-badge",
  "ecg-paper-strip",
  "nurse-task-tray",
  "call-light-remote",
]);

export function shouldRenderRoomPropInVisualReview(
  prop: EncounterRuntimeRoomProp,
  sceneOnlyVisualReview = isSceneOnlyVisualReviewCaptureMode(selectedCaptureMode()),
): boolean {
  if (!sceneOnlyVisualReview) {
    return true;
  }
  if (prop.generatedBy === "scene_manifest" && prop.semanticRole !== "environmental_detail") {
    return true;
  }
  return SCENE_ONLY_ESSENTIAL_ROOM_PROP_IDS.has(prop.propId);
}
