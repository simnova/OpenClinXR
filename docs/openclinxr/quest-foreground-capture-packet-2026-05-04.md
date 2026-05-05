# Quest Foreground Capture Packet - 2026-05-04

This packet is the operator handoff for the remaining manual Quest 3 evidence gate. Automated CDP and IWER evidence is useful, but it does not replace a human worn-headset report.

## Automated Evidence Already Captured

- Raw smoke: `docs/openclinxr/quest-cdp-smoke-2026-05-04.json`
- CDP check: `docs/openclinxr/quest-cdp-smoke-check-2026-05-04.json`
- Runtime probe: `docs/openclinxr/local-runtime-probe-2026-05-04.json`
- Classification: `foreground_ready`
- Quest Browser user agent: Quest 3 / OculusBrowser 146
- WebXR status: `WebXR ready`
- Page state: visible, focused, not hidden
- Trace interaction: advanced from `Trace 0/10` to `Trace 2/10`
- CDP frame sample: 123 samples, 124 frames observed, 71.2 approximate FPS, p95 14.8 ms, max 37 ms, not timed out
- IWER sidecar auto-entry evidence: `docs/openclinxr/iwer-auto-entry-browser-smoke-2026-05-04.json`
- IWER visual QA screenshot: `docs/openclinxr/screenshots/iwer-auto-entry-2026-05-04.png`

## First Human Foreground Report

Patrick provided the first worn-headset report at `docs/openclinxr/quest-manual-performance-2026-05-04.json`. Keep it as a useful early observation, not as readiness evidence.

Confirmed:

- Foreground station shell loaded in Quest Browser.
- Full VR immersive session started.
- Text was readable.
- Hand tracking produced two visible primitive box-hand models.
- Short-session comfort was good.

Still blocked:

- Run duration was 2 minutes, below the 10-minute reliability window.
- DevTools screencast was still enabled, so performance timing is not clean.
- Trace interaction did not pass from the in-headset interaction path.
- No locomotion event was recorded even though thumbstick locomotion was declared.
- `window.__openClinXrFrameStats` reported 0 total frames and 0 immersive frames.
- Controller or hand-select latency was not measured.
- Heat observation was not cleared.
- The hand representation is intentionally primitive until a local reviewed hand-mesh asset path is approved.

The validator output is `docs/openclinxr/quest-manual-performance-check-2026-05-04.json`.

## Human Report Still Required

Create a dated report after a human operator completes the next worn-headset pass. Either:

- start from `docs/openclinxr/quest-manual-performance-template.json`, or
- save the full copied in-app Quest Evidence payload containing `manualPerformanceDraft` and `captureSummary`.

The copied payload is preferred for the next run because it preserves `frameStatsFresh`, `frameStatsAgeMs`, validation blockers, and the exact runtime draft seen in-headset.

The human report must still confirm:

- Foreground page was visible in the headset, not only through CDP.
- DevTools screencast was disabled while observing performance.
- Extra Quest Browser windows were closed.
- Immersive session behavior was observed in-headset.
- EHR, dialogue, and input-evidence canvas panels were readable at the intended headset distance.
- Controller or deliberate hand selection advanced the Trace row in Full VR.
- Full VR mode, controller grip/ray visibility, hand/input visibility, locomotion behavior, and the trace latency fields were copied from the in-app Quest Evidence payload.
- `traceLatencyProxy.source` is `xr_controller_select` when a headset controller or deliberate hand-select path is used; `dom_click_trace_button` is supporting desktop-style evidence only.
- Locomotion changed the rig position or produced an accepted locomotion event. For hand-only runs, `input.activeLocomotionSource` should be `xr_hand_gesture` or `mixed`, and `input.xrHandGestureState.armed` should be true at the accepted gesture moment.
- At least 10 minutes of observation completed.
- At least 600 frames were observed, with a rolling sample window of at least 120 frames.
- `performance.immersiveFramesObserved` increased above 0 after Full VR entry.
- The in-app Quest Evidence Frames row showed fresh frame stats at copy time; copied payloads should have `captureSummary.frameStatsFresh: true`.
- Comfort, heat, and battery observations were recorded.

Automated supporting evidence: `docs/openclinxr/quest-cdp-smoke-vr-text-input-panels-2026-05-04.json`, `docs/openclinxr/quest-cdp-smoke-vr-resize-guard-2026-05-04.json`, and their check files show the production station page visible in Quest Browser, `Full VR ready`, trace advancement, fresh frames, and no CDP blockers after the in-VR text/input panel revision. The resize-guard smoke was captured after the app stopped calling `renderer.setSize` while a Full VR session is presenting. This supports station-shell readiness only; it does not clear the human worn-headset performance gate.

## Next Worn-Headset Run Script

Before the run:

- Keep the headset awake and leave only one Quest Browser window open.
- Disable DevTools screencast before judging performance.
- Confirm the production station page is foregrounded at `http://localhost:5173/`.
- Enter `Phase 1 Full VR` from inside the headset using the visible WebXR entry control.

During the run:

- Stay in Full VR for at least 10 minutes.
- Read the EHR, dialogue, and input-evidence panels from normal headset distance.
- Trigger at least one station Trace action using headset input, then verify the Trace row changes.
- Move intentionally using the active locomotion path and verify Movement changes from `none`.
- Watch the Frames row until total frames, `vr` frames, and sample window are nonzero and the loop freshness label is `fresh`.
- Record comfort, heat, and battery after the run rather than at startup.

After the run:

- Copy the full in-app Quest Evidence JSON.
- Save it as `docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json`.
- Keep any written operator notes in `runContext.notes`.
- Run the validation commands below.

Do not use this Full VR packet for Mixed Reality claims. Mixed Reality/passthrough will remain a separate evidence lane.

## Validation Commands

```bash
pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json
pnpm agent:benchmarks
```

Do not mark the Quest foreground leadership gate ready until the manual check passes.
