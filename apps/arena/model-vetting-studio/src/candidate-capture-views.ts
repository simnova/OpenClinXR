export type FixedCameraView = "front" | "side" | "three_quarter";
export type TemporalCaptureView = "turntable" | "viseme_timeline" | "emotion_transition" | "body_motion_probe";
export type CandidateCaptureView = FixedCameraView | TemporalCaptureView;

export function isFixedCameraView(value: string | null): value is FixedCameraView {
  return value === "front" || value === "side" || value === "three_quarter";
}

export function isCandidateCaptureView(value: string | null): value is CandidateCaptureView {
  return isFixedCameraView(value) || isTemporalCaptureView(value);
}

export function isTemporalCaptureView(value: string | null): value is TemporalCaptureView {
  return value === "turntable" || value === "viseme_timeline" || value === "emotion_transition" || value === "body_motion_probe";
}
