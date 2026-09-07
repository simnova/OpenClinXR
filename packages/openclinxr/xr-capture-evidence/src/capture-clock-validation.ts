/**
 * Capture-mode predicates. Validators only: this module answers "is this capture mode
 * selected", never what to do about it. Moved out of apps/ui-xr/src/capture-comparator.ts,
 * where they sat beside the comparator's camera and scene-root setters, so the app kept a
 * validation rule inside a functionality module.
 */

// Deterministic capture clock (?openclinxrDeterministicCapture=1): pins the frame-loop
// clock to t=0 so every procedural pose/breathing/blink term is run-identical.
// Capture-gated: the learner runtime never carries the param.
const deterministicCaptureClock =
  new URLSearchParams(window.location.search).get("openclinxrDeterministicCapture") === "1";

export function isDeterministicCaptureClock(): boolean {
  return deterministicCaptureClock;
}

// ED-bay-visible: keeps room shell/floor/set-dressing while preserving comparator
// framing, garment evidence, and mouth-gaze evidence. Void stays default.
export function isEdBayVisibleCaptureMode(captureMode: string): boolean {
  return captureMode.includes("ed-bay-visible")
    || new URLSearchParams(window.location.search).get("edBayVisibleCapture") === "1";
}
