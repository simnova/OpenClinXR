# Proposal: WebXR Mixed Reality Mode

Status: Proposed; requires Patrick approval before Codex adds or starts an `immersive-ar` passthrough session path.

## Decision Needed

Decide whether OpenClinXR should add a sidecar-only mixed-reality/passthrough spike for Quest 3, or keep the current Phase 1 headset path as full immersive VR while focusing next on in-VR text, hand affordances, and locomotion.

This decision matters because the current implementation intentionally enters `navigator.xr.requestSession("immersive-vr")`. That is WebXR, but it is full VR, not passthrough MR. Adding `immersive-ar` changes the privacy, safety, rendering, and validation posture because the headset may expose the real environment as the visual background.

## Recommendation

Keep full VR as the primary examinee modality for the medical station because the product goal includes realistic, controlled clinical environments with patient, nurse, spouse, equipment, noise, interruptions, and environmental stressors.

Approve a constrained sidecar MR spike only for evidence gathering and future-mode design. The spike should not replace the full-VR station. It should answer:

- Does Quest Browser on this specific Quest 3 expose `navigator.xr.isSessionSupported("immersive-ar")`?
- Can a transparent Three.js render path show OpenClinXR actors, panels, and equipment over passthrough without a black skybox/floor?
- Can clinical text remain readable in MR without leaking or recording the real room?
- Which use cases are actually better in MR: operator debugging, faculty observation, desk-based practice, accessibility, or hybrid physical equipment training?

## Proposed Scope

- Add an `apps/ui-xr-iwsdk-spike` MR mode behind an explicit approval gate and a separate button/route.
- Use `navigator.xr.isSessionSupported("immersive-ar")` before showing any MR entry as available.
- Request `immersive-ar` only from a physical user gesture.
- Use transparent rendering for MR; do not render the current full-VR dark background as passthrough.
- Keep the full-VR station as the default and current production-candidate path.
- Record evidence under `docs/openclinxr/` with separate VR and MR metrics.
- Do not add cloud services, paid APIs, recordings of the physical room, or production adoption.

## Pros

- Separates “full VR exam room” from “mixed reality passthrough” in the code and evidence model.
- Lets the team validate Quest 3 MR support locally before committing architecture.
- May improve comfort, debugging, and physical-space awareness for some training contexts.
- Creates a cleaner future path for desk-based EHR panels, hand/controller affordances, and faculty/operator overlays.

## Cons

- MR may not be available or stable in the Quest Browser build on this headset.
- Passthrough changes privacy and safety assumptions because the real room becomes part of the experience.
- Transparent MR rendering needs a different scene policy: no skybox, different floor/equipment behavior, different occlusion/readability checks.
- It could distract from the primary clinical exam simulation unless kept sidecar-gated.

## Source Notes

- MDN describes WebXR as covering both VR and AR/MR, with `immersive-vr` for full VR and `immersive-ar` for AR-style sessions: <https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Fundamentals>
- MDN recommends checking session support with `navigator.xr.isSessionSupported()` for `inline`, `immersive-vr`, or `immersive-ar`: <https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Lifecycle>
- MDN documents `hand-tracking` as an optional session feature, but a real hand renderer still needs to consume `XRInputSource.hand`: <https://developer.mozilla.org/en-US/docs/Web/API/XRInputSource/hand>
- Meta's IWSDK public README positions IWSDK as a Three.js-based immersive web framework with interaction, locomotion, spatial UI, and VR/AR headset support: <https://github.com/facebook/immersive-web-sdk>
- IWSDK AI docs state its MCP workflow can inspect sessions, transforms, input, hands, browser state, scene hierarchy, and ECS state, which is useful for a future sidecar MR validation flow: <https://iwsdk.dev/ai/>

## Acceptance If Approved

- A fresh test asserts the sidecar does not conflate `immersive-vr` and `immersive-ar`.
- CDP/manual evidence records Quest Browser support or lack of support for `immersive-ar`.
- Any MR entry path is off by default and clearly separated from the full-VR station.
- The operator manual report template gains separate VR and MR observations.
- No production readiness claim is made from MR until a worn-headset report confirms comfort, readability, interaction, and frame pacing.
