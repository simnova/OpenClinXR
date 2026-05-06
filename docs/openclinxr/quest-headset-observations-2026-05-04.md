# Quest Headset Observations - 2026-05-04

## Operator Feedback

Patrick tested the `apps/ui-xr-iwsdk-spike` scene on Quest 3 and reported:

- The initial page did not break out of the browser panel until an explicit `Enter Full VR` path was added.
- The scene entered full VR, not passthrough or mixed-reality XR.
- No clinical text was visible in the immersive scene because DOM panels stayed outside the headset render layer.
- Hands were not visible in the prior headset pass; primitive hand rendering had not yet been installed.
- Locomotion was limited to physical room-scale walking in the prior headset pass.

Patrick's latest manual Quest report adds:

- The immersive Full VR session was manually started from the headset.
- Text was readable in the immersive session.
- Two primitive box-style hands were visible through hand tracking, but they were non-realistic.
- `traceInteractionPassed` was `false`.
- `framesObserved` and `sampleWindowSize` were both `0`.
- No locomotion event was observed.
- Short-session comfort was good.

Patrick's 2026-05-06 worn-headset demo observation adds:

- The experience was smooth in headset.
- No locomotion was available beyond physical movement.
- Treat this as qualitative operator feedback only; no copied runtime frame-stat payload, headset video, or locomotion trace event accompanied this observation.

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
- Added an in-Full-VR `select` path that advances the next missing trace action from controller trigger input as `xr_controller_select`, plus a deliberate right-hand stable-pinch path that records the Trace row as `xr_hand_select` for hand-tracking-only runs.

## Remaining Gaps

- Mixed-reality/passthrough mode is approved for a parallel sidecar track, but is not implemented or validated yet.
- Primitive hands have now been observed as non-realistic; articulated/skinned hand meshes remain future work.
- Experimental thumbstick locomotion has not produced a manual headset locomotion event yet; defer the next human headset validation until instrumentation improvements are ready.
- The 2026-05-06 manual demo reinforces locomotion as an active usability blocker even when visual comfort is acceptable.
- Real headset select latency is not yet measured in the manual performance report; the automated DOM-click proxy is supporting evidence only, and the new `xr_controller_select` or `xr_hand_select` Trace row still needs a physical Quest confirmation.
- The updated in-scene text path was readable after manual Full VR entry; the remaining worn-headset rerun should target trace, frame, locomotion, latency, and hand-fidelity evidence.

## Current Posture

Treat the headset experience as a full-VR exam-room prototype, not a finished XR/MR experience. The latest manual report clears the basic "can enter Full VR and read text" concern for the current prototype, while preserving blockers on realistic hands, trace interaction, frame telemetry, locomotion evidence, thermal behavior, and headset select latency. Do not request another worn-headset run until instrumentation improvements are ready to make that pass more valuable.
