# Arena Cage Match: Deterministic Physics-Compliant Clinical Touch (UI-XR)

**Doc id**: `arena-physics-clinical-touch-cagematch-2026-08-01`
**Target path on merge**: `docs/openclinxr/arena-physics-clinical-touch-cagematch-2026-08-01.md`
**Status**: active epic source (BOD 2026-08-02). Epic id `arena-physics-clinical-touch-v1`. Not protected-policy; subordinate to AGENTS + PROJECT_STATUS.
**Supersedes**: `WebXR_Interactive_Humanoid_Physics_Plan.md` (external, unvetted, engine/licence/determinism errors — see §2).
**Authority order**: `AGENTS.md` > `PROJECT_STATUS.md` > `docs/openclinxr/worker-backlog-and-validation-matrix.md` > this doc. Legacy ledgers (`PROJECT_COORDINATION_INDEX`, `AUTONOMOUS_WORK_PLAN`) are audit/archive only. On conflict, canonical wins; record the conflict, do not silently reconcile.
**Gate posture**: all provider/runtime/learner/Quest/production/clinical/scoring gates remain `false` for the entire duration of this spec. Nothing here promotes to production apps.
**Thrash guard**: >60 minutes of **agentic (token-burning)** toil on the same slice task → stop/pivot/block. Long **scripted** non-token work (tests, builds, installs, captures) does **not** count. Max 2 execute retries per slice. See `docs/agent-ops/OPENCLAW-EPIC-CONTINUITY.md`.

---

## 0. Preconditions (execute before reading further)

```bash
nvm use                          # Node >=24.15.0 per .nvmrc
pnpm openclaw:preflight
pnpm docs:drift-check
pnpm openclaw:lease -- status
pnpm agent:alignment
```

Rehydrate snapshots-first (first ~60–80 lines only): `AGENTS.md`, `PROJECT_STATUS.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md`, epic ACTIVE brief under `.openclinxr/epics/`. Use `grep`/`read_file` with limits and `tail | grep` for history. No broad scans. Acquire lease before any edit.

Mandatory codebase reads before writing code (grep-scoped, not full-file):

| Target | Read for |
|---|---|
| `apps/ui-xr/src/main.ts` | humanoid GLB resolve, post-load `traverse`, `userData` evidence surfaces, `frustumCulled` handling, comparator ids (`ed_anny_real_garment_patient`, peds proxy), capture query params |
| `tools/openclinxr/factory/*` | generator contracts: `generated-human-rigging-artifacts`, `generated-ed-station-runtime-bundle`, `cagematch-report-pages`, `ui-xr-runtime-evidence-consumer` |
| `tools/openclinxr/evidence/*` | capture harness (`ui-xr-peds-adaptive-dialogue-capture.ts`), inspection JSON assertion shape |
| `packages/openclinxr/arena/*` | existing arena spike policy + evidence contracts; superseded-experiment conventions |
| `apps/arena/model-vetting-studio/public/cagematch*` | `model-vetting-report.v1`, `report.json`, `registry.json`, `promotionStatus`, `realismGrade`, `notEvidenceFor` field shapes — reuse verbatim, do not invent a parallel schema |
| `schemas/` | encounter/case-def + phenotype schema; locate `phenotype.garmentLayers` and its sibling extension points |
| `docs/madr/README.md` | arena→decision map; MADR numbering and template |
| `biome.json`, `knip.json`, `tsconfig.base.json`, `turbo.json`, `vitest.config.ts` | lint/dead-code/TS project + task wiring for any new workspace package |

**Naming caution**: "OpenClaw" in this repo is a repo-native execution pattern. It is *not* the `openclaw.ai` / `openclaw/openclaw` personal-agent runtime. Do not install, configure, or reference that project. Any search result from `docs.openclaw.ai` is a false positive.

---

## 1. Objective

Prove or disprove, with committed artifacts, that a **physics-compliant patient body** can be driven inside the UI-XR runtime **without breaking replay determinism or the evidence contract**.

Product-side interaction target (Step 2 CS-relevant, seated/supine patient):

- **Palpation compliance** — learner hand contacts abdomen/chest; tissue-analogue yields, returns on release.
- **Passive ROM** — learner grasps forearm/wrist; limb follows with joint-limited compliance and a return-to-pose motor.
- **Guarding / withdrawal** — contact force + region crosses case-def threshold → emotion-timeline event → scripted withdrawal + dialogue policy trigger.
- **Positioning assist** — arm/leg repositioned for auscultation or exam access; new pose persists.

Explicitly **out of scope** (delete from any inherited plan): full active-ragdoll locomotion, push-to-step recovery, balance/COM recovery controllers, motion-matching database construction, get-up clips, multiplayer/server reconciliation.

Rationale: a patient who staggers when pushed is a game behaviour. Every in-scope interaction above is a *seated/supine, low-velocity, bounded-displacement* problem, which removes the hardest stability and determinism failure modes and maps directly onto the existing emotion-timeline + dialogue-policy surfaces.

---

## 2. Corrections carried forward from the superseded plan

Do not re-derive these. They are settled.

| Superseded claim | Correction | Consequence |
|---|---|---|
| Babylon.js 7.x preferred | Babylon is at **9.x** (9.0 Mar 2026; 9.2.1 Apr 2026). Irrelevant regardless: `apps/ui-xr` is **Three.js** (`traverse`/`userData`/`frustumCulled` on GLB) | Three.js only. Babylon is a non-starter — it would fork the evidence surfaces. |
| Jolt WASM as primary | Jolt is a **candidate**, not the default. IWSDK ships **Havok** (`@babylonjs/havok`, MIT WASM build). Rapier ships a dedicated cross-platform-deterministic build. | Three-way cage match (§5). |
| "WebGPU preferred" | Quest Browser WebGPU was still **experimental** as of the Apr 2026 Horizon OS browser release | Target **WebGL2**. Do not gate any result on WebGPU. |
| UE Game Animation Sample = free commercial | UE EULA licenses **UE-Only Content** only for products that require Engine Code to run (or linear media rendered with it). A browser WebXR app is neither. | **Removed from scope.** Do not download, retarget, or reference. Blocks `pnpm security:licenses`. |
| Motion Matching DB from CMU + UE | Not needed for in-scope interactions and not license-clean | Reuse existing Anny humanoid + committed rigging artifacts. |
| Physics params hand-tuned in scene code | Repo rule: case definitions drive scenes; hand-built one-offs do not | Physics config is a **factory-generated artifact** (§6). |
| Silent on determinism | Determinism is the binding constraint of the whole product | §4 is the gate. Everything else is downstream. |

---

## 3. Toolchain: MCP servers, executables, assets

### 3.1 IWSDK runtime MCP (primary agentic instrument)

`facebook/immersive-web-sdk` (MIT). Three.js + ELICS ECS, Havok physics in a web worker, one/two-hand and distance grab systems, IWER browser XR emulation (no headset required).

Its MCP server is the reason this spec is executable unattended:

```bash
pnpm add -D @iwsdk/core @iwsdk/xr-input     # verify current tags before pinning
npx iwsdk dev up                            # starts workspace runtime
npx iwsdk adapter sync                      # writes .mcp.json for Claude-family hosts
npx iwsdk mcp stdio                         # 32-tool runtime MCP
```

Tool categories used by this spec: **Transforms** (drive headset/controller/hand poses programmatically), **Input** (scripted select/trigger), **ECS** (pause, single-step, query entities, **diff state snapshots**), **Browser** (screenshot, console), **Session** (accept/end XR session).

This gives scripted hand trajectories → fixed-step simulation → snapshot diff, headless, on the M1 Max. That is the determinism harness. Do not build a bespoke one.

Constraint: `.mcp.json` must be written into the arena workspace, not the repo root, unless `AGENTS.md` already defines a root MCP contract — check first, record in the per-slice entry.

### 3.2 Supporting MCP / executables

| Tool | Use | Install |
|---|---|---|
| Playwright MCP | headless Chromium capture for PNG evidence parity with existing capture tooling; console-error assertions | `pnpm dlx @playwright/mcp@latest` (verify current package name at execution) |
| GitHub MCP | issue/PR linkage for the 5 open issues + MADR cross-refs | per host adapter config |
| `@dimforge/rapier3d-deterministic` | candidate B | `pnpm add -D @dimforge/rapier3d-deterministic` (JS bindings ~0.19.x; verify latest) |
| `jolt-physics` | candidate C | `pnpm add -D jolt-physics` (~1.x; Jolt core 5.6.0 adds `Ragdoll::DriveToPoseUsingMotors` + `EMotorState::PositionAndVelocity` + glTF `KHR_physics_rigid_bodies` motors) |
| `@babylonjs/havok` | candidate A (already transitive via IWSDK) | present via IWSDK; pin explicitly for the arena package |

All four physics packages are dev-scoped inside `apps/arena/*` only. **Nothing enters `apps/ui-xr` or `packages/openclinxr/*` (non-arena) in this spec.** `mongodb-memory-server` precedent applies: arena deps must not leak into production runtime dependencies.

Run `pnpm security:audit-policy && pnpm security:licenses` immediately after each install and commit the delta. Havok's web build is distributed free under MIT per Babylon.js docs — confirm the actual LICENSE file in the installed package rather than trusting the doc.

---

## 4. Determinism contract (blocking — implement before any interaction code)

The product sells trace evidence, replay, and review packets. A physics layer that cannot reproduce is a physics layer that cannot be evidence. Land this contract as a typed module + tests before touching interaction behaviour.

**C1 — Fixed step.** Physics accumulator at fixed `dt` (60 Hz nominal, `dt = 1/60` exactly as a f64 literal). Render frame rate is decoupled and must never be an input to the step count. No `deltaTime` from `requestAnimationFrame` reaches the solver.

**C2 — Input as a recorded stream.** Hand/controller poses are quantized and appended to an ordered per-tick input log: `{ tick, handedness, jointPoses[], pinchStrength, contactRegionId }`. The simulation consumes the log, never the live device directly. Live XR writes to the log; replay reads from it. This is the only supported replay path.

**C3 — Snapshot + checksum per N ticks.** Serialize solver state every N ticks (start N=30), hash it, append `{ tick, sha256 }` to the trace. Rapier exposes `world.takeSnapshot()` → byte array, which is directly checksummable — this is why Rapier is the determinism front-runner. Havok and Jolt candidates must demonstrate an equivalent serializable state or be scored down on C3.

**C4 — No non-reproducible inputs to the solver.** No `Math.random`, no `performance.now`, no date, no device-frame-dependent values. Seeded PRNG only, seed committed in the runtime bundle.

**C5 — Declared determinism scope.** Every physics artifact carries `determinismScope: "local" | "cross-platform"` and a `notEvidenceFor` list. Cross-platform claims require identical checksums from ≥2 distinct architectures (M1 Max arm64 + one x64) — until that exists, the value is `"local"`, with no exceptions.

**C6 — Replay equivalence test.** `vitest` case: identical input log replayed twice, and replayed after a snapshot restore at tick k, yields identical checksums at every checkpoint. This test is the gate for the whole spec. If it does not pass for a candidate, that candidate is eliminated regardless of visual quality.

**C7 — Physics output is not scoring evidence.** Until a MADR says otherwise, every generated physics artifact carries `notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"]`.

---

## 5. Cage match

### 5.1 Candidates

| Id | Engine | Binding | Case for | Known risk |
|---|---|---|---|---|
| A | Havok WASM | IWSDK built-in, web worker | zero integration cost; already in the IWSDK path; MIT web build | worker boundary complicates deterministic stepping; state serialization for C3 unproven in this binding |
| B | Rapier | `@dimforge/rapier3d-deterministic` | explicit cross-platform-deterministic build; `takeSnapshot()` gives a checksummable byte array; Apache-2.0 | deterministic build forgoes SIMD/parallel — slower; motorized joint tuning less mature for articulated bodies |
| C | Jolt | `jolt-physics` (emscripten port) | strongest articulated-body feature set: ragdoll pose motors incl. position+velocity mode, constraint priorities, per-joint limits | JS surface is a thin IDL over C++; determinism claims are engine-level, must be re-proved through the WASM binding |

Do **not** include Ammo.js. Do not include Babylon-coupled options beyond the Havok WASM module itself.

### 5.2 Harness

Location: `apps/arena/physics-clinical-touch/`
Shared abstraction: `packages/openclinxr/arena/physics-touch-contract/` — one interface, three adapters. No candidate-specific types escape its adapter.

```
apps/arena/physics-clinical-touch/
  src/
    adapters/{havok,rapier,jolt}.ts
    harness/{fixed-step.ts,input-log.ts,snapshot-hash.ts,replay.ts}
    scenarios/{palpation,passive-rom,guarding,positioning}.ts
  public/cagematch/physics-clinical-touch/<yyyy-mm-dd>/
  test/*.test.ts
```

Scripted trajectories via IWSDK MCP Transforms/Input — identical input log replayed against all three adapters. Same GLB (`ed_chest_pain_patient_real_garment` or peds equivalent), same rigging artifact, same seed.

### 5.3 Metrics (all machine-emitted into `report.json`)

| Metric | Definition | Threshold |
|---|---|---|
| `replayEquivalence` | C6 pass/fail | **hard pass required** |
| `snapshotSupport` | C3 checksummable state available | hard pass required |
| `stepCostMs` | p50 / p95 solver ms per fixed step, 1 humanoid | p95 ≤ 3.0 ms (M1 Max), ≤ 5.0 ms budgeted for Quest 3 |
| `frameBudgetHeadroom` | remaining ms against 11 ms @ 90 Hz | ≥ 4 ms |
| `jointExplosionRate` | ticks with joint velocity > clamp, per 10k ticks | 0 |
| `contactStability` | positional drift of a held limb over 300 static ticks | < 2 mm |
| `poseReturnError` | joint-angle delta vs target pose 1 s after release | < 3° per joint |
| `garmentCoherence` | visual: no gown/skin interpenetration during ROM sweep | manual grade + PNG |
| `licenceClean` | `pnpm security:licenses` delta empty | hard pass required |

Any candidate failing a hard-pass metric is eliminated and recorded as superseded under `packages/openclinxr/arena/` conventions. Do not carry eliminated candidates forward "for comparison".

### 5.4 Kill criteria for the whole slice

Abort, record, and escalate to `operator-steering-needed-questions.md` if **any** of:
- No candidate passes C6.
- Physics-driven bone transforms cannot compose with the existing skinned-GLB + breathing + `garmentGeometry.sleeveDeform` pipeline without a rewrite of `main.ts` humanoid load.
- Meeting the frame budget requires disabling existing evidence surfaces.

---

## 6. Factory contract (no hand-authored physics)

Physics configuration is **derived**, not written. Extend the existing phenotype-driven generation path — the same route that produces garment regions from `phenotype.garmentLayers`.

Proposed case-def extension (align exact naming to `schemas/` before implementing):

```jsonc
"phenotype": {
  "garmentLayers": ["hospital_gown"],
  "bodyMechanics": {
    "habitus": "average",              // drives segment mass/inertia table lookup
    "tissueCompliance": {              // per-region, 0..1
      "abdomen": 0.7, "chest": 0.4, "forearm": 0.2
    },
    "jointRangeProfile": "unrestricted", // | "guarded_right_upper_quadrant" | "post_op_shoulder"
    "guardingTriggers": [
      { "region": "rlq", "forceThresholdN": 8, "emotionEventId": "guard_rlq_v1" }
    ]
  }
}
```

Generator responsibilities (new module under `tools/openclinxr/factory/`, mirroring `generated-human-rigging-artifacts`):

1. Emit `physics_config.v1` — bodies, masses, joint frames, limits, motor stiffness/damping per joint group, contact regions mapped to rig bone names.
2. Emit provenance: source case-def id, phenotype hash, generator version, engine id + version, `determinismScope`, `promotionStatus`, `realismGrade`, `notEvidenceFor`.
3. Register in `registry.json` alongside existing candidates.
4. Emit the deterministic seed and fixed `dt` into the runtime bundle so replay is fully specified by committed artifacts.

Hard rule: if a value is tuned by hand during the cage match, it must land back in the generator or in a committed tuning table the generator reads. No magic numbers in adapter code at slice close.

---

## 7. Slice plan

Each slice closes with `pnpm openclaw:post-slice && pnpm docs:drift-check`, a Per-Slice record (product path, blueprint tie, touched, evidence, next) in canonical state files only, and focused verification (`-t "name"`) — never full-suite.

| # | Slice | Exit artifact |
|---|---|---|
| 1 | Determinism harness: fixed step, input log, snapshot hash, replay equivalence test. Engine-agnostic, one stub adapter. | passing C6 test + `harness/` module |
| 2 | Adapter A (Havok/IWSDK) + scripted palpation scenario via MCP. | `report.json` with A's metrics + PNGs |
| 3 | Adapters B and C against the identical input log. | three-way `report.json` + `registry.json` entry |
| 4 | Winner: passive ROM + guarding scenarios; garment coherence check against `ed_anny_real_garment_patient`. | inspection JSON asserting contact/guard surfaces exercised |
| 5 | Factory generator for `physics_config.v1` from `phenotype.bodyMechanics`; regenerate scenarios from case-def only. | generated artifact + provenance, hand-tuning removed |
| 6 | MADR: recommendation, determinism scope, promotion path or explicit non-promotion. Gates stay false. | `docs/madr/NNNN-*.md` |
| 7 | Quest 3 disconnected re-run (operator-dependent; do not block 1–6). | headset evidence branch under `.openclinxr/evidence/` |

Evidence branch convention: `.openclinxr/evidence/physics-clinical-touch/<yyyy-mm-dd>-<slice-slug>/`.
Cagematch assets: `apps/arena/physics-clinical-touch/public/cagematch/physics-clinical-touch/<yyyy-mm-dd>/`.
Mirror the existing naming exactly — verify against the `anny-real-garment` precedent before creating directories.

---

## 8. Honest-posture requirements

Every report, page, and per-slice entry must state, without softening:

- What the committed artifacts actually show, distinct from what the generator *claims*. The `ed-real-garment` precedent — reports claiming a gown while the branched GLB still carried prior geometry — is the failure mode to avoid; state the delta explicitly if one exists.
- `determinismScope` and the exact platforms checksummed.
- `notEvidenceFor` on every artifact.
- No exam-equivalence, clinical-validity, or scoring language anywhere, including comments and commit messages.
- Any threshold that was relaxed to make a metric pass, with the original value.

---

## 9. Open questions → `operator-open-questions.md` (with recommended defaults)

1. Does `schemas/` already reserve a phenotype extension point for mechanics, or is `bodyMechanics` a new top-level key? *Default: new key, additive, optional.*
2. Is a second architecture available for the cross-platform determinism claim (C5)? *Default: no — ship `determinismScope: "local"`.*
3. Should the arena MCP config live at repo root `.mcp.json` or arena-scoped? *Default: arena-scoped; root untouched.*
4. Fixed step 60 Hz vs 72 Hz (Quest native refresh alignment)? *Default: 60 Hz — decouple physics from display refresh entirely.*
5. Does the existing capture tool contract permit a new `capture=` mode string, or does it require extending an enum? *Default: extend the enum, keep existing modes byte-identical.*

---

## 10. Definition of done

- C1–C7 implemented and enforced by tests.
- Three adapters evaluated against one input log; `report.json` + `registry.json` + PNGs + inspection JSON committed.
- `physics_config.v1` generated from case-def; zero hand-tuned constants in adapter code.
- `pnpm security:licenses` and `pnpm security:audit-policy` clean; no UE-sourced asset anywhere in the tree.
- MADR landed with an explicit promote / do-not-promote decision.
- `pnpm docs:drift-check`, `pnpm agent:alignment`, `pnpm hooks:strict` pass (strict TS baseline caveat per `operator-open-questions.md` applies).
- All gates still `false`.
