/**
 * Capture-mode predicates. Validators only: this module answers "is this capture mode
 * selected", never what to do about it. Moved out of apps/ui-xr/src/capture-comparator.ts,
 * where they sat beside the comparator's camera and scene-root setters, so the app kept a
 * validation rule inside a functionality module.
 */

/**
 * The capture flags come from the page URL, and this module is re-exported from the package
 * entrypoint (index.ts:63). Reading `window.location` at MODULE LOAD made
 * `@openclinxr/xr-capture-evidence` un-importable in a node test: the import threw before any
 * assertion ran. Measured 2026-09-09 — the package's only pre-existing test,
 * capture-evidence.test.ts, imports DEEP paths (./real-garment-capture.js,
 * ./visual-review-filter.js) and never the entrypoint, so the defect had never been exercised.
 * A planted RED that imports the entrypoint, as the repo's own
 * package-tests-use-the-public-entrypoint rule asks, exposed it immediately.
 *
 * Reading lazily keeps the browser behaviour identical (the URL does not change within a page
 * load) and makes the entrypoint importable off a page.
 */
function captureSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams("");
  return new URLSearchParams(window.location.search);
}

// Deterministic capture clock (?openclinxrDeterministicCapture=1): pins the frame-loop
// clock to t=0 so every procedural pose/breathing/blink term is run-identical.
// Capture-gated: the learner runtime never carries the param.
export function isDeterministicCaptureClock(): boolean {
  return captureSearchParams().get("openclinxrDeterministicCapture") === "1";
}

// ED-bay-visible: keeps room shell/floor/set-dressing while preserving comparator
// framing, garment evidence, and mouth-gaze evidence. Void stays default.
export function isEdBayVisibleCaptureMode(captureMode: string): boolean {
  return captureMode.includes("ed-bay-visible")
    || captureSearchParams().get("edBayVisibleCapture") === "1";
}
