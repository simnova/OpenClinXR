# Operator Suggestion Backlog

This file captures useful operator steering that should shape future work but does not automatically become an immediate task or blocker. True blockers stay in `operator-steering-needed-questions.md`; evidence-backed questions stay in `operator-open-questions.md`.

## Intake Rules

- Record suggestions here when they are non-blocking, speculative, or better reviewed at the next logical planning point.
- Promote an item to an implementation slice only when it has a clear owner, acceptance criteria, verification path, and no unresolved approval boundary.
- Promote an item to `operator-steering-needed-questions.md` only when Patrick must approve paid/cloud/API use, destructive actions, machine-level trust/security changes, credentials, or physical hardware actions.
- Do not treat this backlog as permission to add packages, run paid services, download large models/assets, or claim production readiness.

## Status Values

- `captured`: recorded for later triage.
- `accepted-for-review`: likely useful; review during the next related slice.
- `converted-to-proposal`: requires explicit proposal approval before implementation.
- `promoted-to-slice`: selected for implementation with tests/evidence.
- `closed`: addressed, rejected, or superseded.

## Suggestions

### SUG-2026-05-04-001: Browser Screenshot/Video Adversarial Visual QA

- Status: `accepted-for-review`
- Captured at: 2026-05-04 19:53 EDT
- Operator steering: Use browser screenshots and videos, then apply multimodal review from an adversarial perspective to determine whether the XR/VR scene accurately depicts the intended scenario, especially as realistic actors and equipment are added.
- Primary owners: `test-automation-lead`, `ux-friction-critic`, `clinical-safety-critic`, `xr-systems-architect`, `asset-pipeline-lead`
- Review when: building XR scene evidence, IWER/IWSDK automation, Quest smoke tests, Storybook visual checks, or asset-pipeline QA.
- Acceptance shape:
  - Capture screenshots and, when tooling supports it, short videos from desktop browser, emulated XR, and Quest paths.
  - Store evidence metadata with viewport/device, route, scenario ID, camera pose, XR mode, capture command, and artifact path.
  - Require adversarial notes on clinical scene fidelity, actor/equipment realism, UI readability, interaction affordances, locomotion/comfort cues, occlusion, scale, and missing critical equipment.
  - Keep human worn-headset observations separate from automated browser or emulation evidence.
- Current posture: backlog only. No new browser automation, capture storage, or video tooling is authorized by this entry alone.

### SUG-2026-05-04-002: Steering Suggestions Are Backlog By Default

- Status: `accepted-for-review`
- Captured at: 2026-05-04 19:53 EDT
- Operator steering: Suggestions may be peppered in while Codex is working; they do not all need immediate implementation and can be reviewed as progress continues.
- Primary owners: `chief-coordinator`, `rubric-steward`, `implementation-planning-lead`
- Review when: selecting the next verified slice or deciding whether a suggestion needs a proposal.
- Acceptance shape:
  - Classify incoming suggestions as immediate blocker, approved implementation input, evidence question, proposal candidate, or backlog idea.
  - Preserve unattended execution unless the suggestion creates a true blocker or changes an approval boundary.

### SUG-2026-05-04-003: IWER Sidecar Evidence Automation

- Status: `converted-to-proposal`
- Captured at: 2026-05-04 19:53 EDT
- Operator steering: IWER looks worth a gated sidecar spike as a complement to CDP and human Quest confirmation for immersive session and controller/input evidence.
- Proposal: `proposals/proposal-iwer-sidecar-emulation-spike.md`
- Primary owners: `xr-systems-architect`, `test-automation-lead`, `platform-devops-lead`, `ux-friction-critic`
- Review when: extending `apps/ui-xr-iwsdk-spike`, adding IWER evidence contracts, or addressing the WebXR activation automation gap.
- Acceptance shape:
  - Prefer no new package installation if IWER is already present through the approved IWSDK Phase 2 devtools sidecar.
  - Keep IWER evidence labeled as emulation evidence, not physical Quest proof.
  - Record package versions, licenses, commands, artifact size, session-entry reliability, controller/hand input support, and rollback path before claiming usefulness.

### SUG-2026-05-04-004: PNPM Audit Security Monitoring

- Status: `accepted-for-review`
- Captured at: 2026-05-04 19:53 EDT
- Operator steering: Leverage PNPM audit to keep abreast of security issues in packages.
- Primary owners: `open-source-governance-lead`, `security-privacy-lead`, `supply-chain-dependency-attacker`, `workspace-steward`
- Review when: dependency upgrades, package installs, CI verification, release hardening, or pnpm audit exception handling are touched.
- Acceptance shape:
  - Keep `pnpm security:audit`, `pnpm security:audit:prod`, and `pnpm security:audit:dev` runnable and documented.
  - Preserve `pnpm audit --audit-level=high` in the default verification path unless a future proposal changes the gate.
  - Record any audit exceptions, overrides, or accepted risks in a markdown evidence file with package name, advisory, severity, affected version, fixed version, rationale, owner, and review date.
  - Pair audit results with license-policy checks so security and licensing posture are both visible before committing dependency changes.
- Current posture: partially implemented through existing root scripts; backlog item remains open for periodic monitoring, exception documentation, and CI/reporting polish.

### SUG-2026-05-04-005: Evaluate UIKitML For In-XR Text Content

- Status: `captured`
- Captured at: 2026-05-04 20:04 EDT
- Operator steering: Consider UIKitML for text content in the application, as a stronger candidate than the earlier HTML-in-canvas direction.
- Primary owners: `xr-systems-architect`, `ux-product-lead`, `test-automation-lead`, `open-source-governance-lead`
- Review when: building simulated EHR, case-note, patient-note, admin-in-XR, or complex text panels in `apps/ui-xr` or `apps/ui-xr-iwsdk-spike`.
- Acceptance shape:
  - Compare UIKitML against HTML-in-canvas for text readability, styling control, input affordances, accessibility, Quest performance, bundle size, and integration with IWSDK sidecar tooling.
  - Keep UIKitML sidecar-gated until package metadata, license posture, Vite peer compatibility, bundle impact, and Quest/IWER evidence are recorded.
  - Preserve Full VR and Mixed Reality evidence separation; text technology choice must not imply headset readability readiness until manual Quest observations pass.
- Current posture: backlog only. No `@iwsdk/vite-plugin-uikitml` or related package install is authorized by this entry alone.
