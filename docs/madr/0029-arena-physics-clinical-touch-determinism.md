# MADR 0029: Arena Physics Clinical-Touch Cage Match Under Local Determinism

Date: 2026-08-02  
Status: Accepted for **arena-only** evaluation; **not promoted** to production XR

## Context

Step 2 CS–inspired encounters need bounded clinical-touch interactions (palpation, passive ROM, guarding, positioning) without game ragdoll locomotion. Trace/replay product constraints require fixed-step determinism (C1–C7). Prior external plans mixed Babylon, UE-only content, and non-deterministic device-frame coupling.

Epic `arena-physics-clinical-touch-v1` delivered:

- `@openclinxr/physics-touch-contract` with C1–C7 harness
- Candidate adapters: `havok-candidate`, `rapier-candidate`, `jolt-candidate` (deterministic stand-ins; real WASM optional later)
- Three-way cagematch + palpation/ROM/guarding/positioning InputLogs
- `physics_config.v1` generator from phenotype bodyMechanics-shaped input

## Decision

1. Keep physics clinical-touch evaluation **inside the capability arena** (`packages/openclinxr/arena/physics-touch-contract`, `apps/arena/physics-clinical-touch`).
2. Ship **local** `determinismScope` only until multi-architecture checksum evidence exists.
3. Prefer **committed InputLogs** as the replay path; IWSDK MCP is optional arena instrumentation, not production law.
4. Do **not** promote physics packages into `apps/ui-xr` or non-arena production packages in this decision.
5. Real engine WASM (Havok/Rapier/Jolt) may replace candidates later behind license + C6 gates; candidates remain valid evaluation baselines.
6. All physics artifacts carry `notEvidenceFor: clinical_validity, exam_equivalence, scoring, learner_readiness` (and related garment-visual caveats where stated).

## Consequences

Positive:

- Determinism contract and factory path exist without blocking the product queue on Quest hardware.
- Engine divergence and C6 are test-enforced in-package.
- Promotion path is explicit: successor MADR + architecture-rule + dual evidence before UI-XR consumption.

Negative:

- Candidates are not production physics engines; visual garment coherence is out-of-band until a later slice.
- Quest 3 evidence remains optional (`skipped_no_device` allowed).

## Related

- Spec residual ledger (claim-aligned 2026-08-02): `docs/openclinxr/arena-physics-clinical-touch-cagematch-2026-08-01.md` — **completed epic ledger**, not active marching order; Delivered vs deferred table is authoritative over older “UI-XR objective” prose still retained as residual north star.
- Open questions defaults: `operator-open-questions.md` (2026-08-02 arena-physics post-epic).
- MADR 0021 (local-first spikes), 0027 (Quest gate), 0028 (IWSDK sidecar).
