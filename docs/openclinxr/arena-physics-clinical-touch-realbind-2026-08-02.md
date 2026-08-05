# Successor Epic Brief: Physics-Compliant Clinical Touch — Real Engines, Real Factory, Real UI-XR Bind

**Doc id:** `arena-physics-clinical-touch-realbind-2026-08-02`  
**Path:** `docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md`  
**Epic id:** `arena-physics-clinical-touch-realbind-v1` (`.openclinxr/epics/ACTIVE`)  
**Status:** **ACTIVE** — BOD 2026-08-02 incorporated Desktop draft `Xxxyyy-arena.md.md` into autonomous queue (`PROJECT_STATUS.md` + worker-backlog + epic brief).  
**Authority:** subordinate marching order under `AGENTS.md` > `PROJECT_STATUS.md` > worker-backlog. Not one of the 6 protected files.  
**Succeeds:** `arena-physics-clinical-touch-v1` (closed). Residual v1 ledger `arena-physics-clinical-touch-cagematch-2026-08-01.md` was purged 2026-08-05 (git history); deferred items are the D1–D5 table in this brief.  
**Governing prior decision:** MADR 0029 (arena-only, non-promoted). This epic is the **explicit promotion-path work** MADR 0029 named as a prerequisite for any UI-XR consumption.  
**Gate posture:** all provider/runtime/learner/Quest/production/clinical/scoring gates remain `false` until a **successor MADR** flips a named gate. This epic does not itself promote to production; it produces the dual evidence that lets a human flip one gate.

---

## 0. Why this epic exists — the back-out that must not repeat

`arena-physics-clinical-touch-v1` closed with an honest "Delivered vs deferred" ledger. It delivered a determinism contract and passing tests (144/144). It **deferred the entire product payoff** and reframed the spec's headline objective as a "residual north star for a successor epic." That reframe was a legitimate anti-toil call at the time. It is **not** a legitimate closure of the objective.

The five things that were deferred are the five things this epic exists to finish. They are quoted verbatim from the prior ledger's right-hand column:

| # | Deferred in v1 (do-not-claim-complete) | This epic's obligation |
|---|---|---|
| D1 | Real Havok / Rapier / Jolt **WASM** engines | Load at least **one real engine**; prove C6 through the real WASM binding, not a stand-in |
| D2 | `schemas/` `bodyMechanics` + `tools/openclinxr/factory` emitter | Physics config generated through the **real factory path**, not a package-local plain-TS helper |
| D3 | Bind into `apps/ui-xr` / skinned-GLB bone drive | Physics drives a real patient GLB **inside the UI-XR runtime** with visible, captured deformation |
| D4 | Full §5.3 hard metrics (mm / °, garment PNG, `registry.json`) | Metrics **measured and committed**, not declared as TypeScript types |
| D5 | Immersive session / physics-on-headset | Explicit operator-gated; kill-or-defer with escalation, never silent-drop (§4) |

**The prior objective is restored, verbatim and non-negotiable (§1). No slice, checkpoint, MADR, or ledger edit in this epic may re-demote it to a "north star," "residual," "future," or "optional" — see the Anti-Descope Charter (§2).**

---

## 1. Locked objective (cannot be reframed)

> **Prove or disprove, with committed artifacts, that a physics-compliant patient body — driven by a real physics engine through the factory-generated config — can be driven inside the UI-XR runtime without breaking replay determinism or the evidence contract.**

Two outcomes are acceptable closures: **PROVEN** (dual evidence exists, promotion path opens) or **DISPROVEN-BY-KILL** (a §5.4-class blocker is hit, escalated to the operator, and recorded — see §4). **A third "we built the scaffolding and reframed the goal" outcome is explicitly forbidden.**

Product-side interaction target (unchanged): palpation compliance, passive ROM, guarding/withdrawal, positioning assist — all seated/supine, low-velocity, bounded-displacement. Out of scope (unchanged): active-ragdoll locomotion, push-to-step, balance/COM recovery, motion-matching DB, get-up clips, multiplayer reconciliation.

---

## 2. Anti-Descope Charter (the heart of this brief)

Each clause names an **exact escape hatch the previous epic used**, and pairs it with a **machine-checkable guard** so the hatch cannot be taken silently. A slice that trips a guard is **not closeable** — the guard is the gate.

### AD-1 — No "candidate" stand-ins at the objective boundary
The v1 adapters are self-labeled `CANDIDATE PATH: No real @dimforge/rapier3d WASM loaded` (`packages/openclinxr/arena/physics-touch-contract/src/adapters/{rapier,jolt,havok}.ts`). Deterministic hand-written integrators are a **baseline**, not a delivery.
- **Guard:** the winning adapter's `engineId` MUST NOT match `/-candidate$/`. A committed test asserts the real WASM module was loaded and produced the checksum stream (e.g. real `world.takeSnapshot()` bytes for Rapier, real Havok/Jolt serialized state). If the module is absent, the test **fails** — it does not fall back to a candidate and pass.
- **Closure rule:** an epic-level test `real-engine-loaded.test.ts` must pass with a real engine before DoD. "Candidate exercised the C6 path" is not this test.

### AD-2 — No package-local config masquerading as the factory
v1 shipped `physics_config.v1` as plain TS inside the arena package and called the factory contract satisfied. It is not wired to `schemas/` or `tools/openclinxr/factory`.
- **Guard:** the physics config MUST be emitted by a generator module under `tools/openclinxr/factory/` that mirrors `generated-human-rigging-artifacts.ts` (same `SCHEMA_VERSION` / `KIND` / `OUTPUT_DIR` / provenance embedding shape). A test asserts the generator reads a case-def/phenotype input and that **no physics constant is hand-authored in adapter or scenario code** at slice close (grep-guard: zero numeric literals for mass/stiffness/limit outside the generator or its committed tuning table).
- **Note (precision):** there is **no formal `schemas/` JSON file** for `phenotype.garmentLayers` today — it lives in factory + UI-XR code. So D2 requires the team to **locate the canonical phenotype type wherever it actually is defined** and extend it there. "We couldn't find a schemas/ file so we kept it package-local" is a pre-banned excuse — resolve it as operator decision OD-2 (§3), not as a descope.

### AD-3 — No zero-touch of `apps/ui-xr` reframed as "residual"
v1 never touched `apps/ui-xr` and demoted the bind to a successor epic. This IS the successor epic. The bind is the deliverable, not the horizon.
- **Guard:** the epic touches `apps/ui-xr/src/main.ts` (or a sibling runtime module it imports). A committed capture asserts physics-driven bone transforms compose with the existing skinned-GLB + `deformsWithBreathing` + `garmentGeometry.sleeveDeform` pipeline on a real comparator id (`ed_anny_real_garment_patient` / `peds_anny_real_garment_patient`, confirmed present at `apps/ui-xr/src/main.ts:1016-1019`).
- **Visibility tie:** per `MANDATE_VISIBILITY.md`, the deforming tissue under a held limb / palpated abdomen IS the skeptic-noticeable delta. If the capture shows sub-pixel or no motion, the slice is **expanded, not closed**.

### AD-4 — No types-in-lieu-of-measurements
v1 shipped inspection/metrics as TypeScript types with unit report builders. §5.3 requires measured values.
- **Guard:** `report.json` MUST contain **measured numbers** for `stepCostMs` (p50/p95), `contactStability` (mm), `poseReturnError` (°), `jointExplosionRate`, plus committed PNGs for `garmentCoherence`. A test asserts these fields are populated from a run, not from defaults/zeros/`null`. A `registry.json` entry MUST exist alongside, reusing the `model-vetting-report.v1` field shapes verbatim (`promotionStatus`, `realismGrade`, `notEvidenceFor`).

### AD-5 — README is not an app
v1 shipped `apps/arena/physics-clinical-touch/README.md` and an empty `src/`.
- **Guard:** `apps/arena/physics-clinical-touch/src/**` exists and runs headless to emit the §5.3 evidence; `public/cagematch/physics-clinical-touch/<yyyy-mm-dd>/` contains the committed report + PNG tree. A test/CI step asserts the directory is non-empty and the report parses.

### AD-6 — The ledger cannot rewrite the objective
The single most dangerous v1 move: editing the spec's own header to reclassify it from "marching order" to "residual ledger."
- **Guard:** the objective string in §1 is reproduced in `PROJECT_STATUS.md` at epic open. Any checkpoint that weakens it (adds "residual," "north star," "optional," "future," "deferred" to the **objective** — not to individual slices) is a drift event. `openclaw-drift-police` sign-off (§11) explicitly checks for objective-drift and blocks closure. Individual **slices** may be deferred with a recorded blocker; the **objective** may not.

### AD-7 — Anti-toil does not mean anti-objective
The v1 thrash guard (>60 min agentic toil/slice) was used to justify stopping. It is retained — but it triggers **escalation, not abandonment** (§4). Hitting the timebox routes to a higher-tier helper or an operator decision; it never converts to "epic complete."

---

## 3. Pre-resolved operator decisions (kill the blocker-excuses before they're used)

The v1 back-out leaned on three real ambiguities. Resolve them **once, up front**, so no slice can stall on them mid-flight. Recommended defaults are pre-filled; the operator (Patrick) confirms or overrides at epic open, and the answers are frozen for the epic.

| Id | Decision | Recommended default (freeze unless overridden) |
|---|---|---|
| OD-1 | Which real engine is the required one? | **Rapier** (`@dimforge/rapier3d` deterministic build) — `world.takeSnapshot()` gives a checksummable byte array, the cleanest C6 path. Havok/Jolt remain optional comparison, not required for closure. |
| OD-2 | Where does `phenotype.bodyMechanics` live, given no `schemas/` file exists? | **Extend the canonical phenotype type at its real definition site** (locate via grep at epic open), additive + optional. If the team asserts "no canonical type exists," that is an OD escalation, not a descope. |
| OD-3 | Is a second architecture available for cross-platform C5? | **No — ship `determinismScope: "local"` honestly.** This is an **accepted** closure outcome, NOT a reason to skip real engines. Local determinism on a real engine fully satisfies the objective. |
| OD-4 | Immersive/headset physics (D5)? | **Deferred to a named follow-up slice, operator-gated.** `foreground_ready` desktop/preview evidence is sufficient for this epic's DoD. Kill-or-defer is fine here **because it is pre-declared**, not because it was silently dropped. |
| OD-5 | Timebox per slice? | **90 min agentic/token-burning toil** (raised from 60 to give real-WASM integration room); on trip → §4 escalation, never abandonment. |

**Rule:** any decision not on this table that would otherwise justify stopping is a **new** operator escalation (§4) — the team may not invent a fresh descope rationale mid-epic.

### 3.1 Operator sign-off block (frozen at epic open)

BOD 2026-08-02: incorporate Desktop brief into autonomous work plan — **all recommended defaults accepted**. Frozen for this epic; mid-flight change requires a new dated amendment line.

| Id | Decision | Frozen value |
|---|---|---|
| OD-1 | Required real engine | **Rapier** (`@dimforge/rapier3d` deterministic) |
| OD-2 | `bodyMechanics` home | Extend canonical phenotype type at its real def site, additive+optional |
| OD-3 | Second architecture for C5 | **No** — ship `determinismScope: "local"` (accepted closure) |
| OD-4 | Immersive / headset physics (D5) | Deferred to R7, operator-gated; `foreground_ready` desktop suffices for DoD |
| OD-5 | Per-slice toil timebox | **90 min** agentic → §4 escalation (never abandonment) |

**Sign-off**

- Operator: Patrick (BOD incorporate instruction 2026-08-02) · Date: 2026-08-02
- Frozen decisions mirrored into `PROJECT_STATUS.md` at epic open (AD-6): **yes**
- Product residual lane was empty (`continue-autonomy-run-next`); **queue pivot** to this epic is explicit BOD (not silent preemption of open Q4 work)

_Amendments after freeze (dated, operator-initialed):_

- _(none)_

---

## 4. Kill vs Descope protocol (escalation, not abandonment)

The one legitimate non-PROVEN closure is **DISPROVEN-BY-KILL**, and it has a strict form so it can't be forged from a descope.

**A KILL is valid only if ALL of:**
1. It matches a §5.4 kill criterion (no real engine passes C6; physics bone transforms cannot compose with the skinned-GLB+breathing+sleeveDeform pipeline without a `main.ts` rewrite; frame budget requires disabling an existing evidence surface).
2. The specific technical blocker is written to `operator-steering-needed-questions.md` with the failing artifact attached (checksum diff, capture, or profile).
3. Work **stops and waits** for the operator. It does not close the epic as "complete."

**A DESCOPE (silently narrowing scope and closing anyway) is never valid.** Only the operator may convert a kill into an accepted narrowed scope, and only by editing `operator-steering-needed-questions.md` / `PROJECT_STATUS.md` themselves.

**Timebox trip (OD-5) routing:** on 90-min trip, spawn a higher-tier helper (per `TIER_GROK.md` ladder: deepseek-v4-pro → grok-build / frontier) for the stuck sub-task, or raise an OD escalation. Record the escalation in `PROJECT_STATUS.md`. Two consecutive evidence-only slices still force the `chief-coordinator` + `openclaw-drift-police` review per `GUARD_DRIFT.md` — but here that review's mandated output is "which real-build slice unblocks," not "close the epic."

---

## 5. Slice plan — binary exit artifacts, adversarially verified

Every slice closes with `pnpm openclaw:post-slice && pnpm docs:drift-check`, a Per-Slice record in canonical state files only, and **focused** verification (`-t "name"`). Each exit artifact below is a **committed file a skeptic can open** — not a passing type-check.

| # | Slice | Binary exit artifact (must exist + pass its guard) | Closes |
|---|---|---|---|
| R1 | Load **one real engine** (OD-1 default: Rapier WASM) behind the existing `PhysicsAdapter` interface; prove C6 through the real binding. | `real-engine-loaded.test.ts` green with `engineId !== /-candidate$/`; C6 replay-equivalence checksums from **real** `takeSnapshot()`. AD-1 guard. | D1 |
| R2 | `physics_config.v1` **generator** under `tools/openclinxr/factory/`, mirroring `generated-human-rigging-artifacts.ts`; wire input to the real phenotype type (OD-2). | generator test: case-def in → config + provenance out; grep-guard: **zero hand-authored physics constants** in adapter/scenario code. AD-2 guard. | D2 |
| R3 | **UI-XR bind:** physics-driven bones compose with skinned GLB + breathing + `sleeveDeform` on `ed_anny_real_garment_patient`; headless capture. | committed capture under `.openclinxr/evidence/physics-clinical-touch/<date>-uixr-bind/` showing **visible** palpation/ROM deformation (non-sub-pixel). AD-3 + visibility guard. | D3 |
| R4 | **Measured** §5.3 metrics from a real run; PNG garment-coherence tree; `registry.json` entry with `model-vetting-report.v1` shapes. | `report.json` with populated mm/°/ms numbers + PNGs + `registry.json`; `metrics-populated.test.ts`. AD-4 + AD-5 guards. | D4 |
| R5 | Runnable arena app `src/` emitting R4 evidence headless; `public/cagematch/physics-clinical-touch/<date>/` populated. | non-empty `src/**` + parsing report in `public/cagematch/...`. AD-5 guard. | D4/D5 |
| R6 | **Successor MADR:** PROVEN/DISPROVEN decision, `determinismScope` + platforms, explicit **promote-one-named-gate** or do-not-promote. | `docs/madr/00NN-*.md` with a binary decision; if PROVEN, names the exact gate a human may flip. | objective |
| R7 | (Operator-gated, OD-4) Immersive/headset physics re-run. | headset evidence branch **or** pre-declared deferral in `operator-open-questions.md`. | D5 |

Kill criteria (§5.4 carried forward, unchanged): no candidate/engine passes C6; physics bone transforms can't compose without a `main.ts` rewrite; frame budget forces disabling an evidence surface. → §4 KILL, not descope.

---

## 6. Real-engine contract (AD-1 in detail)

- The `PhysicsAdapter` interface and the C1–C7 harness from v1 are **reused as-is** — that foundation is good and stays.
- At least one adapter MUST load real WASM and pass C6 **through the real binding**. Candidate adapters remain in-tree as labeled baselines for divergence comparison only; they cannot be the winner.
- License gate: `pnpm security:audit-policy && pnpm security:licenses` clean after the real install; confirm the actual `LICENSE` file in the installed package (Havok MIT web build / Rapier Apache-2.0 / Jolt MIT) rather than trusting docs. All physics deps stay dev-scoped inside `apps/arena/*` + the arena contract package — **nothing enters `apps/ui-xr` production deps** (the UI-XR bind consumes generated config artifacts + bone transforms, not the engine as a prod dependency; `mongodb-memory-server` precedent).
- `determinismScope: "local"` is honest and accepted (OD-3). Cross-platform is out of scope unless a second architecture appears.

## 7. Factory contract (AD-2 in detail)

- Generator lives under `tools/openclinxr/factory/`, named and shaped like `generated-human-rigging-artifacts.ts` (`SCHEMA_VERSION`, `KIND`, `OUTPUT_DIR`, embedded `promotionStatus` / `realismGrade` / `notEvidenceFor` / phenotype hash / generator version / engine id+version / `determinismScope`).
- Input is the real phenotype type (OD-2), extended additively with `bodyMechanics` (habitus → mass/inertia lookup, per-region `tissueCompliance`, `jointRangeProfile`, `guardingTriggers` with `emotionEventId` into the existing emotion-timeline surface).
- **Hard rule:** any value tuned during integration lands back in the generator or a committed tuning table it reads. Zero magic numbers in adapter/scenario code at slice close (grep-guarded).

## 8. UI-XR bind contract (AD-3 in detail)

- Consume generated bone transforms in `apps/ui-xr/src/main.ts`'s humanoid load path; compose with existing `traverse`/`userData`/`frustumCulled` evidence surfaces (real comparator ids confirmed at `main.ts:1016-1019`).
- Emit `userData.openClinXr*` physics-touch evidence (mirror `openClinXrSleeveDeformEvidence` convention); `frustumCulled=false` on the touched region; a distinct material/emissive so the deformation reads on capture.
- Capture parity with existing tooling (headless Chromium PNG + `body_motion` webm); the palpation/ROM motion must be **visible at viewer distance**, per `MANDATE_VISIBILITY.md`. Sub-pixel → expand geometry/contrast/displacement, do not close.

## 9. Metrics that must be measured, not typed (AD-4)

`replayEquivalence` (C6, hard pass) · `snapshotSupport` (C3, hard pass) · `stepCostMs` p50/p95 (≤3.0 ms M1 Max) · `frameBudgetHeadroom` (≥4 ms) · `jointExplosionRate` (0) · `contactStability` (<2 mm) · `poseReturnError` (<3°) · `garmentCoherence` (PNG + grade) · `licenceClean` (hard pass). All emitted into `report.json` from a real run; a test rejects default/zero/null population.

---

## 10. Definition of Done — binary, adversarial, non-reframable

An epic-closing checklist. Every line is **true/false**; no line may be satisfied by reframing the objective.

- [ ] **D1** — A real physics-engine WASM module loads and passes C6 through its real binding (`engineId !== /-candidate$/`). *AD-1.*
- [ ] **D2** — Physics config is emitted by a `tools/openclinxr/factory/` generator from the real phenotype type; zero hand-authored physics constants in adapter/scenario code. *AD-2.*
- [ ] **D3** — Physics drives a real patient GLB inside `apps/ui-xr` with a committed capture showing **visible** deformation on a real comparator id. *AD-3.*
- [ ] **D4** — `report.json` carries **measured** mm/°/ms metrics + garment PNGs + `registry.json` (v1 shapes). *AD-4.*
- [ ] **D5** — Runnable arena app `src/` + populated `public/cagematch/...` tree. *AD-5.*
- [ ] **MADR** — Successor MADR lands a binary PROVEN/DISPROVEN decision; if PROVEN, names the exact gate a human may flip. *R6.*
- [ ] **Honest posture** — `determinismScope` + platforms stated; `notEvidenceFor: [clinical_validity, exam_equivalence, scoring, learner_readiness]` on every artifact; any relaxed threshold recorded with its original value.
- [ ] **License** — `pnpm security:licenses` + `security:audit-policy` clean; no UE-sourced asset anywhere.
- [ ] **Guards** — `pnpm docs:drift-check && pnpm agent:alignment && pnpm openclaw:post-slice` pass.
- [ ] **Adversarial sign-off** — `productivity-skeptic` AND `openclaw-drift-police` both record BLUF sign-off (§11): objective **not** reframed (AD-6), delta is skeptic-noticeable, no candidate-as-winner.
- [ ] **Gates** — all production gates still `false` (this epic opens a promotion path; it does not walk it).

**Forbidden closure:** any completion narrative containing "residual north star," "reframed objective," "candidate exercised the path," "types cover the metrics," or "README documents the app" as a substitute for the corresponding D-line. `openclaw-drift-police` blocks on these strings appearing in the closure checkpoint.

---

## 11. Enforcement wiring (why this can't be quietly closed)

1. **Objective is mirrored into `PROJECT_STATUS.md` at epic open** (AD-6). Drift-police diffs it at close.
2. **Each AD-guard is a committed test** — the epic cannot go green with a candidate winner, hand-authored constants, an untouched `apps/ui-xr`, or zero-valued metrics.
3. **Two-signature adversarial close:** `productivity-skeptic` (assesses whether a skeptical viewer would call the deformation real, per its charter's website-evidence bar) + `openclaw-drift-police` (objective-drift + descope-string check). Both BLUF sign-offs land in the closing checkpoint. Missing either → not closed.
4. **Anti-toil routes to build, not exit** (§4): the two-evidence-slice review's mandated output is "next real-build slice," never "close."
5. **Kill is escalation, not completion** (§4): DISPROVEN-BY-KILL stops and waits for the operator; it never self-certifies as done.
6. **Operator decisions are frozen up front** (§3): no slice invents a new stopping rationale mid-epic.

---

## 12. What stays untouched (so this reads as extension, not thrash)

- The v1 C1–C7 harness, `PhysicsAdapter` interface, and 144 tests — **kept and built on.**
- MADR 0029 — **kept**; this epic is the promotion-path work it named.
- Candidate adapters — **kept** as labeled divergence baselines.
- Product residual was empty post-garment/Q4 batch; **BOD 2026-08-02** scheduled this epic as **Next dequeue** (explicit pivot, not silent preemption of open product work).

---

### One-paragraph pitch to the operator

v1 built a real, tested determinism foundation and was honest that it stopped short of the actual product: real physics, generated through the real factory, visible inside UI-XR. This successor epic finishes exactly those five deferred items, and it is written so the team **cannot** close it the same way twice — every escape hatch v1 used is now a failing test or a required adversarial signature, the objective is frozen and drift-checked, and the only non-PROVEN exit is a formal KILL that stops and waits for you rather than self-certifying as complete.
