# Quest Headset Observations - 2026-05-04

## Operator Feedback

Patrick tested the `apps/ui-xr-iwsdk-spike` scene on Quest 3 and reported:

- The initial page did not break out of the browser panel until an explicit `Enter Full VR` path was added.
- The scene entered full VR, not passthrough or mixed-reality XR.
- No clinical text was visible in the immersive scene because DOM panels stayed outside the headset render layer.
- Hands were not visible in the prior headset pass; primitive hand rendering had not yet been installed.
- Locomotion was limited to physical room-scale walking in the prior headset pass.

## Actions Taken

- Added explicit `Enter Full VR` controls to both `apps/ui-xr` and `apps/ui-xr-iwsdk-spike`.
- Switched Three.js rendering to `renderer.setAnimationLoop` with `renderer.xr.enabled = true`.
- Added an in-scene canvas-textured clinical panel so core EHR/case text can be visible inside immersive VR.
- Added simple WebXR controller rays to both scenes.
- Requested `hand-tracking` as an optional WebXR feature and added primitive WebXR hand models that install after the immersive session is accepted.
- Added experimental keyboard/thumbstick dolly locomotion with bounded movement evidence for browser smoke and headset validation.
- Added machine-readable runtime posture that marks the current mode as `Phase 1 Full VR`, requested session mode `immersive-vr`, and `mixedRealityPassthroughImplemented: false`.
- Added and later approved [proposal-webxr-mixed-reality-mode.md](../../proposals/approved/proposal-webxr-mixed-reality-mode.md) so passthrough/MR is handled as an explicit parallel sidecar track instead of silently conflating it with full VR.
- Added a DOM trace-select latency proxy in both XR shells and the Quest CDP smoke harness so automated runs can prove trace latency evidence is wired without pretending to measure physical controller latency.

## Remaining Gaps

- Mixed-reality/passthrough mode is approved for a parallel sidecar track, but is not implemented or validated yet.
- Primitive hands need a fresh human headset pass; articulated/skinned hand meshes remain future work.
- Experimental thumbstick locomotion needs a fresh human headset pass for comfort, nausea risk, bounds, and input policy.
- Real headset controller-select latency is not yet measured in the manual performance report; the automated DOM-click proxy is supporting evidence only.
- The updated in-scene text/controller-ray build needs a fresh physical Quest retest after the operator clicks `Enter Full VR`.

## Current Posture

Treat the headset experience as a full-VR exam-room prototype, not a finished XR/MR experience. Do not claim production Quest readiness until the human headset report confirms in-scene text readability, real controller/hand affordances, locomotion policy, comfort, thermal behavior, and controller-select latency.
