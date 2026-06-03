# MADR 0027: Use Quest 3 USB-C As The First WebXR Device Smoke Gate

Date: 2026-05-03
Status: Accepted

## Context

The user has a Quest 3 and enabled Developer Mode. The project needs real headset feedback before XR readiness claims become credible.

## Decision

Use the Quest 3 connected by USB-C, Android Debug Bridge, Chrome DevTools device inspection, and Quest Browser port forwarding as the first manual WebXR smoke gate.

## Consequences

Positive:

- Converts Quest/WebXR assumptions into local device evidence.
- Avoids cloud services and paid infrastructure.
- Supports console inspection and local dev server testing.

Negative:

- This is a manual gate, not a fully automated headset test.
- USB authorization, cable quality, and Quest Browser behavior can be fiddly.
- It does not replace longer comfort, thermal, battery, or performance validation.

## Implementation Notes

- Android Platform Tools were installed locally with Homebrew on 2026-05-03.
- Initial `adb devices -l` showed the Quest as `unauthorized`; the user must accept the debugging prompt inside the headset.
- Use `chrome://inspect/#devices` and port forwarding to open the local XR dev server in Quest Browser.
- Disable DevTools screencasting while judging frame comfort.

## Sources

- `src-chrome-android-remote-debugging-2026`
- `src-cognitive3d-webxr-quest-dev-setup-2026`

