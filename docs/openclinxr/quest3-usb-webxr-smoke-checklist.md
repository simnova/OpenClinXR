# Quest 3 USB WebXR Smoke Checklist

Date: 2026-05-03
Status: local device smoke guidance

## Immersive Entry Outcome Classification

Quest CDP smoke reports now include `verdict.immersiveEntryOutcome`, and evidence checks include `immersiveEntryOutcome` with:

- `not_requested`
- `activation_missed`
- `app_request_failed`
- `session_started`

Interpretation note:

- `activation_missed` means CDP click automation did not reach the app-side WebXR entry handler. It still requires human headset/controller activation and does not satisfy manual foreground Quest readiness.

## Decision

Use the attached Quest 3 over USB-C as the first real WebXR device smoke gate. This is sufficient for early OpenClinXR headset validation, provided it is treated as a manual smoke test rather than full certification.

## Current Local Preflight

Observed on 2026-05-03:

- User enabled Developer Mode on the Quest 3.
- Android Platform Tools were installed locally with Homebrew.
- `adb` is available at `/opt/homebrew/bin/adb`.
- `adb devices -l` initially detected the headset as `unauthorized` with serial `2G0YC5ZGB5000J`.
- After the in-headset authorization prompt was accepted, `adb devices -l` reported the Quest 3 as `device`.
- `adb reverse tcp:5173 tcp:5173` succeeded, so the headset can use `localhost:5173` for a local Vite dev server once the XR app exists.
- The refreshed 2026-05-04 `pnpm local:runtime:probe` artifact records Quest wakefulness. USB remained ready, and after the headset was woken `questForegroundPreflight` reported `ready` with ADB `mWakefulness=Awake`.

Device fingerprint captured:

| Field | Value |
| --- | --- |
| Model | Quest 3 |
| Device codename | eureka |
| Android API base | 14 |
| Build incremental | 52083180032000520 |
| Browser package | `com.oculus.browser` |
| Browser version observed | `146.0.0.19.27.942135376` |

## Smoke Run 0001: Static Local Page

Run time: 2026-05-03

Result: pass for USB-C local dev routing and remote inspection.

Evidence:

- Headset reported `mWakefulness=Awake`.
- `adb devices -l` reported `2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka`.
- `adb reverse tcp:5173 tcp:5173` was active.
- A local Node HTTP server on `127.0.0.1:5173` received Quest Browser requests:
  - `GET /`
  - `GET /favicon.ico`
- `adb forward tcp:9222 localabstract:chrome_devtools_remote` exposed the Quest Browser DevTools endpoint.
- `http://127.0.0.1:9222/json/version` reported `OculusBrowser/146.0.0.19.27.942135376 Chrome/146.0.7680.177`.
- `http://127.0.0.1:9222/json` listed `OpenClinXR Quest Smoke` at `http://localhost:5173/`.

What this proves:

- USB-C ADB authorization works.
- Local dev server routing to Quest Browser works.
- Desktop-side remote inspection of Quest Browser works.

What this does not prove:

- OpenClinXR XR scene frame rate.
- WebXR immersive session entry.
- Controller, hand, or gaze interaction.
- Comfort, thermal, or battery performance.
- Clinical station usability.

Practical note: after restarting the ADB daemon, the Quest can return to `unauthorized`; accept the in-headset USB debugging prompt again if needed.

## Smoke Run 0002: XR Shell Local Browser Preflight

Run time: 2026-05-03

Result: pass for desktop/mobile browser preflight; blocked for headset rerun.

Evidence:

- `apps/ui-xr` Vite dev server served `http://localhost:5173/`.
- Desktop browser loaded `OpenClinXR Station Runtime`.
- Desktop browser console showed no warning/error logs beyond Vite debug messages.
- Desktop viewport canvas check reported:
  - Canvas CSS size: `1020x900`.
  - Runtime panel CSS width: `420`.
  - Canvas/panel overlap: `false`.
  - Canvas data URL length: `28606`.
- Desktop screenshot pixel sample reported 346 unique sampled colors and 5,211 non-background pixels in the stage region.
- Mobile emulation `390x844x2,mobile,touch` showed readable stacked station content and trace controls.
- Mobile screenshot pixel sample reported 830 unique sampled colors and 9,950 non-background pixels in the stage region.
- A trace button interaction changed the status from `Trace 0/10` to `Trace 1/10`.

Headset blocker:

- `adb devices -l` currently reports `2G0YC5ZGB5000J unauthorized usb:0-1 transport_id:1`.
- Rerun headset smoke after accepting the USB debugging prompt in the headset.

## Smoke Run 0003: XR Shell Quest Browser Rerun

Run time: 2026-05-03

Result: pass for Quest Browser shell delivery, nonblank canvas, and trace-control interaction; inconclusive for immersive support through CDP.

Evidence:

- `adb devices -l` reported `2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka transport_id:1`.
- `adb reverse tcp:5173 tcp:5173` succeeded.
- `adb forward tcp:9222 localabstract:chrome_devtools_remote` succeeded.
- Quest Browser launched `http://localhost:5173/` with package `com.oculus.browser`.
- DevTools target list showed `OpenClinXR Station Runtime` at `http://localhost:5173/`.
- Remote page probe reported:
  - `title`: `OpenClinXR Station Runtime`.
  - `hasContent`: `true` for `ED Chest Pain`.
  - `canvas`: `860x774`.
  - `overlay`: `false`.
  - `hasNavigatorXr`: `true`.
- Remote interaction probe:
  - After clicking `Ecg Request`, the trace showed `Trace 1/10`.
  - After clicking `Urgent Escalation`, the trace showed `Trace 2/10`.
  - Dialogue changed to `Spouse: Are you saying this could be his heart?`.

Probe limitation:

- `navigator.xr.isSessionSupported("immersive-vr")` did not resolve through CDP before the probe timeout. This result should be recorded as inconclusive because `navigator.xr` itself was present and the page remained responsive.

What this proves:

- The current OpenClinXR XR shell reaches Quest Browser over USB-C local forwarding.
- The 3D canvas is nonblank in the headset browser.
- HTML station controls remain clickable and update local station state.
- No Vite/framework overlay was detected during the probe.

What this does not prove:

- Entering an immersive VR session.
- Controller or hand input.
- Sustained frame pacing.
- Thermal comfort or battery behavior.
- Speech, local LLM, or local voice performance.

## Smoke Run 0004: Fresh Desktop And Mobile Browser Regression

Run time: 2026-05-03 17:58 EDT

Result: pass for local desktop and mobile-browser regression after monorepo package verification.

Evidence:

- `pnpm install --force --frozen-lockfile` completed with the committed lockfile and repaired a locally mutated pnpm store; `pnpm store status` then reported packages untouched.
- `pnpm verify` passed after the clean install refresh, including agent artifact checks, `tsgo` typechecks, Vitest suites, and `pnpm audit --audit-level=high`.
- `apps/ui-xr` Vite dev server served `http://localhost:5173/`.
- Desktop Chrome loaded `OpenClinXR Station Runtime` at `http://localhost:5173/`.
- Desktop probe reported:
  - `title`: `OpenClinXR Station Runtime`.
  - `hasEdChestPain`: `true`.
  - `hasNavigatorXr`: `true`.
  - Canvas CSS size: `1395x945`.
  - Canvas PNG data URL length: `143754`.
  - Vite error overlay: `false`.
- Desktop console showed only Vite debug connection messages before interaction and no warning/error messages during the mobile regression pass.
- Clicking `Ecg Request` changed the trace to `Trace 1/10` and updated dialogue to `Nurse Alvarez: I will get the ECG now and call it out as soon as it prints.`
- Mobile-sized viewport reported:
  - Viewport: `500x844`, DPR `2`.
  - Canvas CSS size: `500x473`.
  - `hasReadableEhr`: `true`.
  - Clicking `Urgent Escalation` changed the trace to `Trace 2/10`.
  - Vite error overlay: `false`.
- Screenshots captured:
  - `docs/openclinxr/screenshots/xr-browser-smoke-2026-05-03.png`
  - `docs/openclinxr/screenshots/xr-browser-smoke-mobile-2026-05-03.png`

Debt impact:

- Closes `evidence-leadership-0006-001`: clean pnpm install after monorepo creation.
- Closes `evidence-leadership-0007-001`: clean install, tests, and browser checks after application monorepo creation.
- Does not close Quest 3 immersive, local model, local voice, sustained performance, or validation-study evidence debt.

## Smoke Run 0005: Repeatable Quest CDP Probe

Run time: 2026-05-03 18:12 EDT

Result: pass for repeatable Quest Browser shell and trace interaction probe; blocked for CDP frame pacing sample.

Command:

```bash
pnpm xr:quest:smoke -- --url 'http://localhost:5173/?questSmoke=20260503-1' --output docs/openclinxr/quest-cdp-smoke-2026-05-03.json
```

Evidence:

- Machine-readable report: `docs/openclinxr/quest-cdp-smoke-2026-05-03.json`.
- `adb devices -l` reported `2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka transport_id:1`.
- `adb reverse tcp:5173 tcp:5173` was active.
- Quest Browser reported `OculusBrowser/146.0.0.19.27.942135376 Chrome/146.0.7680.177`.
- Remote CDP snapshot reported:
  - `title`: `OpenClinXR Station Runtime`.
  - `hasNavigatorXr`: `true`.
  - `xrStatus`: `WebXR ready`.
  - `canvas`: `860x902`.
  - Canvas PNG data URL length: `100634`.
  - Vite error overlay: `false`.
- Fresh interaction probe reloaded the page, started from `Trace 0/10`, clicked `ecg request` and `urgent escalation`, and ended at `Trace 2/10`.

Probe limitation:

- CDP `requestAnimationFrame` sampling observed `0` frames before the local timeout. Treat this as a CDP/foregrounding measurement blocker, not proof of poor headset frame pacing. Sustained performance still needs a manual in-headset comfort run or a more reliable browser performance trace path.

Debt impact:

- Strengthens Quest Browser shell evidence and makes future USB-C headset checks repeatable.
- Does not close `evidence-leadership-0007-002` because local model, local voice, immersive entry, and sustained frame pacing remain unbenchmarked.

## Setup

1. Connect Quest 3 directly to the Mac with a USB3-capable USB-C cable.
2. Put on the headset and accept "Allow USB debugging."
3. Verify from the Mac:

```bash
adb devices -l
```

Expected:

```text
List of devices attached
<serial> device ...
```

If the device is `unauthorized`, accept the prompt in the headset. If the prompt does not appear, disconnect and reconnect the cable while the headset is awake.

4. Check the foreground preflight before collecting performance evidence:

```bash
pnpm local:runtime:probe -- --output docs/openclinxr/local-runtime-probe-YYYY-MM-DD.json
```

Expected: `questForegroundPreflight.status` is `ready`. If the blocker is `quest_3_asleep_or_not_foreground_ready`, put on or wake the headset before attempting foreground frame pacing.

Optional direct ADB reverse path:

```bash
adb reverse tcp:5173 tcp:5173
adb reverse --list
```

Expected:

```text
UsbFfs tcp:5173 tcp:5173
```

## Local Dev Server Path

After the XR app exists:

1. Start the local Vite dev server:

```bash
pnpm --filter @openclinxr/ui-xr dev -- --host 0.0.0.0
```

2. Open desktop Chrome:

```text
chrome://inspect/#devices
```

3. Enable "Discover USB devices."
4. Configure port forwarding:

```text
5173 -> localhost:5173
```

5. Open Quest Browser and navigate to:

```text
http://localhost:5173
```

If Chrome port forwarding is unreliable, use the direct `adb reverse tcp:5173 tcp:5173` path above, then open the same URL in Quest Browser.

6. Use `Inspect` in desktop Chrome after the Quest Browser tab is active.

## Smoke Test Script

Automated shell and interaction probe:

```bash
pnpm xr:quest:smoke -- --url http://localhost:5173/ --output docs/openclinxr/quest-cdp-smoke-YYYY-MM-DD.json
```

This requires the local XR app server to already be running. It sets `adb reverse`, exposes Quest Browser CDP on port `9222`, launches Quest Browser, reloads the station page, checks the canvas/WebXR shell, clicks two trace controls, reads app-side frame telemetry from `window.__openClinXrFrameStats`, and records explicit blockers for hidden/inactive pages or incomplete frame sampling. Station foreground-ready checks also require three runtime evidence channels: `window.__openClinXrTextPanelEvidence` canvas metadata for the in-VR text panels, shaped `window.__openClinXrInputEvidence` locomotion/input-source data, and frame-quality fields that identify whether the sample came from the WebXR animation loop or the flat-preview fallback.

If Quest Browser is already open in the headset but `adb shell am start` leaves CDP attached to a stale tab, rerun with the explicit single-tab reuse mode:

```bash
pnpm xr:quest:smoke -- --url http://localhost:5173/?questSmoke=foreground-YYYYMMDD --reuse-open-page --output docs/openclinxr/quest-cdp-smoke-foreground-YYYY-MM-DD.json
```

`--reuse-open-page` only reuses one ordinary HTTP page when no requested smoke page is already exposed through CDP. It deliberately refuses to guess when multiple reusable pages are open, so close extra Quest Browser windows or launch normally in that case.

To attempt a remote Full VR entry probe, add `--enter-vr`:

```bash
pnpm xr:quest:smoke -- --url http://localhost:5173/?questSmoke=enter-vr-YYYYMMDD --reuse-open-page --enter-vr --frame-sample-count 60 --frame-timeout-ms 8000 --output docs/openclinxr/quest-cdp-smoke-enter-vr-YYYY-MM-DD.json
```

The `--enter-vr` report includes app-side `window.__openClinXrXrEntryEvidence` and separates remote activation misses from app-level WebXR failures. If `quest_immersive_entry_activation_not_received` appears, the CDP input did not reach the page's `Enter Full VR` handler and a human headset/controller click is still required before making immersive-session claims.

Validate the latest committed machine-readable report without re-running ADB or touching the headset:

```bash
pnpm xr:quest:smoke:validate -- --output .agent-factory/quest-cdp-smoke-check.json
```

The 2026-05-04 foreground CDP reports now show the awake Quest Browser page as visible and frame-sampling cleanly in flat preview, but remote Full VR entry remains an activation blocker when CDP input does not reach the page handler. Newer station reports must include `quest_text_panel_metadata_present`, `quest_input_evidence_shape_present`, and `quest_frame_quality_evidence_present` before they can be classified as foreground-ready automation evidence. The latest `--enter-vr` activation report records `quest_immersive_entry_activation_not_received` plus `quest_immersive_session_not_started`; this is an automation-input limitation until a human controller/headset click confirms the immersive session.

Latest automated probe detail:

- `docs/openclinxr/quest-cdp-smoke-xr-entry-activation-2026-05-04.json` loaded the station shell in Quest Browser `146.0.0.19.27.942135376`, advanced trace controls from `Trace 0/10` to `Trace 2/10`, observed the page as visible, and sampled 62 fresh frames.
- The flat-preview frame sample reported about 72 FPS with `p95FrameMs` around 14 ms, but this is not a worn-headset comfort pass and does not include controller latency.
- The app-side XR entry evidence stayed at `attempts: 0` after CDP mouse/touch input, so `docs/openclinxr/quest-cdp-smoke-xr-entry-activation-check-2026-05-04.json` remains `blocked` by `quest_immersive_entry_activation_not_received` and `quest_immersive_session_not_started`.
- Treat CDP Full VR entry as supporting automation evidence only; the manual in-headset report must capture a real controller/headset activation of `Enter Full VR`.

Manual foreground performance evidence:

```bash
pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json
```

Use `docs/openclinxr/quest-manual-performance-template.json` to capture the run, or save the copied in-app Quest Evidence payload containing `manualPerformanceDraft` plus `captureSummary` and pass that file to the same command. The checker validates `manualPerformanceDraft` with the raw report rules, requires copied payloads to include a fresh `captureSummary`, preserves `captureSummary` blockers such as stale frame stats, and never treats `captureSummary.manualValidationReady` as sufficient by itself. The copied draft now includes audit-only `reproducibility` metadata for URL, user agent, browser-version hints, app version/commit/build time, WebXR support checks, viewport, screen, and device-pixel-ratio; these browser-reported fields help reproduce a run but are not Horizon OS or firmware proof. CDP-assisted manual harvests also preserve `harvestSummary.signalSnapshot` with text-panel metadata presence, frame freshness, immersive frame/sample-window counts, headset trace provenance, locomotion source/delta, locomotion probe reasons, and technical gaps from the polling endpoint; this is diagnostic ledger data, not a replacement for human audit fields. The Frames row now splits total samples into `vr` and `preview` counts; a Full VR report must show at least 600 `performance.immersiveFramesObserved` frames, otherwise it is only proof of flat-preview rendering or an incomplete copy. Complete the operator, setup, immersive-session, explicit Full VR mode, foreground hand/controller input, locomotion, immersive-frame sample, real headset select latency, battery, and comfort confirmations before validating the report. Locomotion readiness requires `lastLocomotionAtMs`, a non-`none` `activeLocomotionSource`, and a copied `locomotionDelta` with measurable distance or turn from the same accepted rig movement event. In hand-tracking-only runs, deliberately pinch and hold until the dwell interval completes, then move either hand forward/back; the right hand can also turn when moved laterally, while a stable right-hand pinch remains the trace-select gesture. If locomotion still does not register, preserve `captureSummary.locomotionProbeSummary` from the copied payload; it is runtime-probe-only evidence that turns attempt diagnostics into reason codes such as `no_gamepad_sources`, `gamepad_axes_below_deadzone`, `hand_not_pinching`, `hand_arming_dwell`, `hand_missing_joints`, `hand_below_deadzone`, and `active_vector_without_rig_delta` without counting as locomotion readiness. The Trace row should update after a completed in-headset controller trigger or deliberate right-hand stable-pinch select, and the copied report must preserve `traceLatencyProxy.source: "xr_controller_select"` or `traceLatencyProxy.source: "xr_hand_select"` with the last trace tag, measured timestamp, and latency matching `performance.controllerSelectLatencyMs`. DOM trace-click evidence remains supporting evidence only and is marked as not a production headset-latency substitute. The checker remains the final authority and rejects generated check artifacts as default report inputs, malformed console-error arrays, missing or incorrect Full VR mode evidence, missing immersive frame counts after Full VR entry, fewer than 600 immersive frames, missing hand/controller input, missing locomotion, operator notes that contradict structured locomotion claims, sample windows larger than observed or immersive frames, implausible FPS values, nonpositive frame times, stale/unsampled copied frame stats, non-XR headset-select latency provenance, latency mismatches, and out-of-range battery percentages. Mixed Reality observations must use a separate future `mixed_reality_passthrough` evidence lane rather than being mixed into this Full VR report. Until a completed report exists, the benchmark gate records `quest_manual_performance:missing_quest_manual_performance_report`.

`pnpm agent:benchmarks` can now derive the Quest manual performance check directly from the newest completed `docs/openclinxr/quest-manual-performance-*.json` file, whether that file is the raw template shape or the copied in-app payload shape. A validated headset report feeds the leadership benchmark gates without needing a separate hand-copied `.agent-factory` check artifact first.

The 2026-05-04 production station CDP smokes in `docs/openclinxr/quest-cdp-smoke-vr-text-input-panels-2026-05-04.json` and `docs/openclinxr/quest-cdp-smoke-vr-resize-guard-2026-05-04.json` validate that Quest Browser could foreground `apps/ui-xr`, report `Full VR ready`, advance `ecg_request` and `urgent_escalation`, and record fresh frame/input evidence after the in-VR text/input panel revision. The later resize-guard smoke was captured after suppressing Three.js `setSize` calls while `renderer.xr.isPresenting`, preventing live headset warning spam during an active Full VR session. These automated smokes are useful but still do not replace the worn-headset manual report for controller latency, hand visibility, comfort, heat, or battery claims.

Manual in-headset run still needs to capture:

- Quest Browser version.
- Horizon OS version.
- WebXR support result.
- Whether immersive VR session starts.
- Initial scene nonblank.
- In-VR EHR, dialogue, and input-evidence canvas panels readable.
- Encounter timer readable.
- Mock actor dialogue readable.
- Simulated EHR/note panel readable.
- Controller ray/grip affordances visible, with optional hand-model visibility recorded when hand tracking is active.
- Thumbstick, keyboard, room-scale, or deliberate hand-gesture locomotion changes the rig position or turn angle without leaving the bounded bay; hand-only runs should record `activeLocomotionSource: "xr_hand_gesture"` and preserve `locomotionDelta` when that path is used. For hand tracking, pinch and hold past the dwell interval, then move either hand forward/back; use lateral right-hand motion for turn, and keep right-hand stable-pinch separate for the Trace row. If no movement occurs, keep the copied `captureSummary.locomotionProbeSummary` payload so engineering can see whether controller sources were absent, axes stayed below deadzone, pinch was not detected, joints were missing, dwell was still arming, gesture movement stayed below deadzone, or an active input vector failed to produce a rig delta.
- In-app Quest Evidence Frames row shows `vr` frame count reaching at least 600 after Full VR entry; copied report should preserve `performance.immersiveFramesObserved >= 600`.
- In-app Quest Evidence Trace row shows `xr_controller_select` or `xr_hand_select`, a known trace tag, measured timestamp, and positive latency after a completed controller trigger or deliberate right-hand stable-pinch select in Full VR.
- Console errors.
- Browser/app/display reproducibility metadata from the copied payload, plus optional manual `deviceContext` entries when Horizon OS version, Android build fingerprint, USB power state, or thermal detail is available.
- Frame comfort observations.
- Heat/battery observations after 10 minutes.

## IWSDK Sidecar Criteria

If `apps/ui-xr-iwsdk-spike` is created later, treat it as a separate sidecar run, not as proof that the production `apps/ui-xr` shell is ready.

Additional IWSDK sidecar evidence:

- `pnpm iwsdk:verify` passes before device testing starts.
- The sidecar records installed footprint, injected dev runtime size, JS bundle size, bundle delta versus `apps/ui-xr`, and console error count.
- IWSDK adapter evidence records `iwsdk adapter sync`, the local config target, and a reversible rollback path.
- IWSDK MCP inventory evidence records the expected 32 tools, exact observed tool names, and category coverage for session, transforms, input mode, select/trigger, gamepad, device state, browser, scene, and ECS before any agent-tooling readiness claim.
- IWSDK MCP agent-mode evidence records `iwsdk dev status`, `xr_get_session_status`, `xr_accept_session`, `browser_screenshot`, `scene_get_hierarchy`, `xr_select`, and `browser_get_console_logs` in that order.
- IWSDK browser-mode evidence is scored with `pnpm iwsdk:browser:evidence -- --input path/to/iwsdk-browser-evidence.json`, proving managed Playwright readiness and agent-mode normal-browser session independence before any sidecar agent-tooling readiness claim.
- MCP screenshot is nonblank and scene hierarchy includes named station objects.
- MCP `xr_select` triggers exactly one known station trace action in the emulated runtime.
- A foreground Quest Browser run confirms the same trace action with a physical controller or hand input.
- Foreground Quest Browser average FPS is at least 72, p95 frame time is at or below 25 ms, controller-select latency is at or below 150 ms, and the 10-minute comfort/thermal check has no blocker.

IWSDK sidecar evidence that remains insufficient by itself:

- MCP screenshots without physical Quest Browser foreground evidence.
- Desktop emulation without controller or hand parity.
- CDP frame sampling while `document.hidden` is true.
- Any run that requires `@iwsdk/reference`, `@meta-quest/hzdb`, or production adoption of `@iwsdk/vite-plugin-gltf-optimizer`.

## Pass Criteria

Minimum early pass:

- Quest Browser loads the local app through USB port forwarding.
- No fatal JavaScript errors.
- Canvas is nonblank.
- WebXR support is detected or a clear unsupported-state message appears.
- User can complete the station in desktop fallback or immersive mode.
- Text is readable in the headset without overlap.
- DevTools screencasting is disabled during performance observations.

## Fail Criteria

- `adb` cannot see the device after cable and authorization checks.
- Quest Browser cannot reach the forwarded local dev server.
- App renders a blank canvas.
- Entering XR crashes or hangs the tab.
- Core UI text overlaps or is unreadable.
- Console logs repeated render-loop or WebGL errors.
- Motion or frame pacing is uncomfortable during a short manual run.

## Notes

- USB-C debugging is not the same as Quest Link/PCVR. The target is standalone Quest Browser running the WebXR app.
- DevTools screencasting is useful for debugging but can reduce frame rate, so disable it while judging comfort.
- This smoke test is enough to unblock early device feedback. It does not replace longer performance, comfort, accessibility, or clinical simulation testing.

## Sources

- `src-chrome-android-remote-debugging-2026`
- `src-cognitive3d-webxr-quest-dev-setup-2026`
- `src-meta-iwsdk-github-2026`
- `src-iwsdk-ai-docs-2026`
- `src-openclinxr-iwsdk-spike-plan-2026-05-04`
