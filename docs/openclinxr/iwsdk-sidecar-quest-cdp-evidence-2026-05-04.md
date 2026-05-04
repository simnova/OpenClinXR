# IWSDK Sidecar Quest CDP Evidence - 2026-05-04

## Summary

The approved `apps/ui-xr-iwsdk-spike` Phase 1 sidecar was launched locally on port `5183`, exposed to Quest Browser with `adb reverse tcp:5183 tcp:5183`, and sampled through Chrome DevTools Protocol on the attached Quest 3.

This evidence improves confidence that the sidecar can render and interact on Quest Browser, but it does not replace the human foreground headset report required for comfort, in-headset readability, thermal, battery, immersive-session, and real controller-latency observations.

## Evidence Files

- Raw CDP smoke: `docs/openclinxr/iwsdk-sidecar-quest-cdp-smoke-2026-05-04.json`
- CDP evidence check: `docs/openclinxr/iwsdk-sidecar-quest-cdp-smoke-check-2026-05-04.json`
- Live mode posture read: `docs/openclinxr/iwsdk-sidecar-quest-live-mode-evidence-2026-05-04.json`
- Phase 1 metrics rollup: `docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json`

## Observed Result

- Quest device: `Quest_3` over USB-C with ADB authorization.
- URL: `http://localhost:5183/?questSmoke=iwsdk-sidecar-20260504-front`.
- Browser title: `OpenClinXR IWSDK Spike`.
- User agent: Quest Browser `146.0.0.19.27`.
- Page state: visible, not hidden, focused.
- WebXR status: `WebXR ready`.
- Immersive entry path: a Quest Browser `Enter VR` button now calls `navigator.xr.requestSession("immersive-vr")`; after entry, the status strip reports `In VR` and the control changes to `Exit VR`.
- Experience mode: current Phase 1 is full VR, not passthrough mixed reality. Runtime evidence records `mixedRealityPassthroughImplemented: false`; `proposal-webxr-mixed-reality-mode.md` gates any future `immersive-ar` path.
- Canvas: nonblank, `880 x 924`, PNG data URL length `26062`.
- Trace interaction: `Trace 0/10` to `Trace 2/10`.
- CDP frame sample: `123` samples, `71.7` approximate FPS, p95 frame time `14.3 ms`, max frame time `32.9 ms`.
- Evidence classification: `foreground_ready`.

## Remaining Production Blockers

`docs/openclinxr/iwsdk-sidecar-phase1-metrics-2026-05-04.json` remains blocked for production runtime adoption by:

- `app_js_bundle_kb_over_budget`
- `bundle_delta_vs_ui_xr_kb_over_budget`
- `avg_fps_below_floor`
- `missing_controller_select_latency_ms`

The sidecar should remain a spike candidate until bundle weight is reduced, foreground average FPS meets the Quest target, real controller-select latency is captured, and the human headset observation report passes.
