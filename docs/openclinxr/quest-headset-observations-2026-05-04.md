# Quest Headset Observations - 2026-05-04

## Operator Feedback

Patrick tested the `apps/ui-xr-iwsdk-spike` scene on Quest 3 and reported:

- The initial page did not break out of the browser panel until an explicit `Enter VR` path was added.
- The scene entered full VR, not passthrough or mixed-reality XR.
- No clinical text was visible in the immersive scene because DOM panels stayed outside the headset render layer.
- Hands were not visible; true articulated hand rendering is not implemented.
- Locomotion was limited to physical room-scale walking.

## Actions Taken

- Added explicit `Enter VR` controls to both `apps/ui-xr` and `apps/ui-xr-iwsdk-spike`.
- Switched Three.js rendering to `renderer.setAnimationLoop` with `renderer.xr.enabled = true`.
- Added an in-scene canvas-textured clinical panel so core EHR/case text can be visible inside immersive VR.
- Added simple WebXR controller rays to both scenes.
- Requested `hand-tracking` as an optional WebXR feature, while keeping true hand mesh rendering as a future task.
- Added machine-readable runtime posture that marks the current mode as `Phase 1 VR`, requested session mode `immersive-vr`, and `mixedRealityPassthroughImplemented: false`.
- Added [proposal-webxr-mixed-reality-mode.md](../../proposal-webxr-mixed-reality-mode.md) so passthrough/MR is handled as an explicit sidecar decision instead of silently conflating it with full VR.

## Remaining Gaps

- Mixed-reality/passthrough mode is not implemented or validated.
- Hand tracking is requested but no articulated hand mesh is rendered.
- Locomotion beyond physical room-scale movement is not implemented.
- Controller-select latency is not yet measured in the manual performance report.
- The updated in-scene text/controller-ray build needs a fresh physical Quest retest after the operator clicks `Enter VR`.

## Current Posture

Treat the headset experience as a full-VR exam-room prototype, not a finished XR/MR experience. Do not claim production Quest readiness until the human headset report confirms in-scene text readability, real controller/hand affordances, locomotion policy, comfort, thermal behavior, and controller-select latency.
