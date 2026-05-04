# Proposal: Quest Foreground Performance Capture

Status: Proposed; awaiting operator coordination.

## Decision Needed

Approve and schedule a foreground in-headset Quest 3 performance capture that can satisfy frame pacing, controller latency, comfort, thermal, and in-headset readability evidence requirements.

## Recommendation

Approve this capture when the headset is available, but treat simple setup actions such as waking the Quest, closing extra browser windows, and confirming USB authorization as direct operator actions rather than separate approvals.

The non-simple part is the evidence capture itself: it requires a human wearing or operating the headset, confirming foreground state, disabling screencast interference, collecting enough frame samples, and recording comfort/readability observations.

## Proposed Scope

| Item | Proposed value | Posture |
| --- | --- | --- |
| Device | Quest 3 over USB-C with ADB reverse | Local hardware only |
| App target | Current `apps/ui-xr` or approved sidecar target under test | Specify before run |
| Evidence template | `docs/openclinxr/quest-manual-performance-template.json` | Copy into dated report |
| Validation command | `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json` | Local deterministic check |
| Benchmark rollup | `pnpm agent:benchmarks` | Regenerates leadership evidence |
| Cloud calls | None | Disallowed |

## Pros

- Closes the most important gap that CDP and desktop WebXR cannot prove: actual foreground headset performance.
- Separates shell delivery success from sustained frame pacing, comfort, and text readability.
- Gives the team hard thresholds for Quest readiness: FPS, p95 frame time, controller latency, text readability, thermal, and battery observations.
- Works with the existing local validation template and benchmark gate.

## Cons

- Requires human-in-the-loop headset operation and careful observation.
- CDP may continue to classify the page as hidden, so the manual report remains the trusted source.
- The result is device, browser, OS, room-condition, and app-build specific.
- A pass for one station shell does not prove all future generated clinical environments will fit Quest budgets.

## Approval Wording

Approve this proposal if Codex may coordinate a local Quest 3 foreground performance capture, guide the operator through the existing manual template, validate the completed report, and commit the resulting evidence. This approval does not authorize cloud services, paid APIs, production claims, or bypassing the validation thresholds.

## Acceptance Criteria

- `docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json` is completed from the template.
- The report confirms foreground page, screencast disabled, extra windows closed, immersive/session status, readable text, trace interaction, and string-only console errors.
- At least 600 frames are observed and at least a 120-frame sample window is recorded.
- Average FPS is at least 72, p95 frame time is at or below 25 ms, and controller-select latency is at or below 150 ms when measured.
- Comfort, heat, battery, and text readability observations are recorded.
- `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-YYYY-MM-DD.json` passes.
- `pnpm agent:benchmarks` reflects the new foreground evidence.

## Sources

- `docs/openclinxr/quest3-usb-webxr-smoke-checklist.md`
- `docs/openclinxr/quest-manual-performance-template.json`
- `tools/openclinxr/check-quest-manual-performance.ts`
