# Quest Foreground Capture Packet - 2026-05-04

This packet is the operator handoff for the remaining manual Quest 3 evidence gate. Automated CDP evidence is now useful, but it does not replace a human worn-headset report.

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

## Human Report Still Required

Create a dated report from `docs/openclinxr/quest-manual-performance-template.json` only after a human operator completes the worn-headset pass.

The human report must still confirm:

- Foreground page was visible in the headset, not only through CDP.
- DevTools screencast was disabled while observing performance.
- Extra Quest Browser windows were closed.
- Immersive session behavior was observed in-headset.
- EHR and station text were readable at the intended headset distance.
- Controller selection felt responsive and trace interaction was visible.
- At least 10 minutes of observation completed.
- At least 600 frames were observed, with a rolling sample window of at least 120 frames.
- Comfort, heat, and battery observations were recorded.

## Validation Commands

```bash
pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-2026-05-04.json
pnpm agent:benchmarks
```

Do not mark the Quest foreground leadership gate ready until the manual check passes.
