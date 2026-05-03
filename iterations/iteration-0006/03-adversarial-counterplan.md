# Adversarial Counterplan

## Highest-Risk Holes Found

1. The implementation plan is broad enough that workers could scaffold many packages without producing a working station.
2. The proposed package manifests use broad dependency ranges in examples; this weakens reproducibility.
3. Local hardware findings were gathered on an M1 Max with 64 GB RAM, not the user's stated M4Pro/M4Max target, so local-model optimism must be bounded.
4. VibeVoice is not a default-safe production component because the upstream project itself highlights misuse and reliability concerns.
5. WebXR headset performance remains unvalidated; desktop screenshot checks do not prove Quest 3 comfort.
6. MongoDB repository tests could become theater if no local MongoDB instance or Testcontainers path is available.
7. Asset generation is still a separate pipeline; first code should not depend on MakeHuman, ANNY, StableGen, SMPLitex, Blender, or glTF Transform.
8. A mock actor can hide prompt and guardrail failures unless provider audit contracts are defined early.
9. Admin UI complexity can expand before the core station lifecycle works.
10. Review packet wording can accidentally imply summative scoring or exam equivalence.

## Required Countermeasures

- Reduce the first sprint to one executable thin thread and reject unrelated scaffolding.
- Add a worker backlog matrix that binds each package to tests, commands, and expected artifacts.
- Treat every optional runtime as a health-checked adapter with `not_configured` as a passing local state.
- Add explicit legal and AI safety notes to the voice gateway before evaluating VibeVoice.
- Add dependency-license intake before adding XR, 3D, model, voice, and test automation packages beyond the TypeScript core.
- Add text assertions that prohibit high-stakes, diagnostic, licensure, or ECFMG-equivalence claims.
- Add trace replay contract tests before faculty review UI work.
- Add nonblank canvas and responsive text checks before any detailed XR scene work.

## Adversarial Alternative

If the team wants even tighter scope, start with a CLI-only proof:

1. Load fixture.
2. Simulate learner events.
3. Generate trace.
4. Generate review packet.
5. Validate claims language.

Only after that passes should API, admin, and XR shells be added. This reduces user-visible momentum but gives the fastest proof that the core design is buildable.

## Decision The Red Team Forces

The core team must choose between:

- **Thin-thread UI first:** API, admin, and XR shells appear quickly, with mocks.
- **CLI-first proof:** domain, trace, and review are proven before UI.

Adversarial recommendation: use thin-thread UI only if the test harness is built in parallel and blocks completion claims.

