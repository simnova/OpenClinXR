# Leadership Packet: iteration-0008

## Score Summary

```text
iterations/iteration-0008/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.779
  composite_score: 4.778
  confidence: 0.94
  critical_risks: 3
  evidence_debt: 4
  decision_debt: 0
```


---

# Iteration 0008 Brief

Date: 2026-05-03
Loop focus: empirical evidence closure after local runtime, Quest, asset, and provider probes

## Objective

Use the new executable evidence from the codebase to tighten the plan. The objective is not to declare Quest, local AI, voice, or asset production readiness. The objective is to convert vague unknowns into named gates that the development team can run, repeat, and satisfy later.

## Inputs

- Quest CDP smoke with shell, WebXR, trace interaction, app-side frame telemetry, and hidden-page blocker.
- Local runtime probe for Quest USB, local model, local voice, and asset tools.
- GLB pipeline smoke using the pinned permissive `gltf-pipeline` CLI.
- Local provider benchmark contract with mock model and mock voice evidence.
- Manual Quest performance report template and validator.
- Updated dependency pinning, audit, and license gates.

## Required Decisions

- Which evidence blockers are now precise enough for engineering ownership?
- Which blockers still require user/manual workstation action rather than unattended automation?
- Does the implementation plan remain appropriately local-first and claim-limited?
- What should the next sprint do before attempting local model, voice, Blender, or immersive-performance claims?

## Output Standard

The output must distinguish "proved by executable evidence" from "still blocked", and it must leave the next development team with commands and report files rather than prose-only recommendations.



---

# Core Plan

## Evidence Now Proven

- `pnpm verify` is the full local gate for agent artifacts, TypeScript, tests, audit, and license policy.
- Quest 3 USB-C development loop is real: ADB sees the headset, port reverse works, Quest Browser loads the local XR shell, WebXR is visible, the canvas is nonblank, and trace controls advance.
- App-side frame telemetry exists through `window.__openClinXrFrameStats`.
- The Quest automated frame blocker is now precise: CDP reports the page as hidden/inactive, so the render loop records only the initial frame during the automated sample.
- Local hardware probing is repeatable and separates USB readiness from local model, local voice, and asset-pipeline readiness.
- The GLB conversion path is executable through pinned `gltf-pipeline@4.3.1` without introducing the `sharp`/LGPL dependency path that blocked `@gltf-transform/cli`.
- Mock model and mock voice benchmarks are recorded with zero-cost provenance.
- Manual Quest performance evidence has a template and validator.

## Remaining Blockers

- Foreground in-headset Quest performance is not proven. A manual report must confirm a foreground page, screencasting disabled, a 10-minute run, readable text, trace interaction, no console errors, average FPS at or above 72, p95 frame time at or below 25 ms, minimum FPS at or above 60, comfortable motion, and no heat concern.
- Local model execution is not configured. No Ollama, llama.cpp, or MLX LM runtime is detected, and local model environment variables are unset.
- Local voice execution is not configured. No VibeVoice runtime is detected, and local voice environment variables are unset.
- Blender is not installed, so the asset generation/bake path is not ready even though GLB conversion is.
- Clinical and psychometric production readiness still require expert review and validation studies outside the prototype.

## Next Sprint Recommendations

1. Keep the deterministic ED station and mock providers as the default demonstration path.
2. Capture the foreground Quest manual performance report before making headset comfort or frame-pacing claims.
3. Install Blender only when the asset-bake spike is intentionally scheduled; then add a small generated/optimized GLB bake report.
4. Install and benchmark one local model runtime on the target Apple Silicon machine only after model license and disk/runtime requirements are recorded.
5. Install and benchmark VibeVoice or an alternate local voice runtime only after voice safety and misuse review is recorded.
6. Keep `@gltf-transform/cli` out of the pinned dependency set until its transitive license posture is acceptable or an explicit exception is approved.

## Commands That Carry The Evidence

- `pnpm verify`
- `pnpm agent:benchmarks`
- `pnpm xr:quest:smoke`
- `pnpm xr:quest:manual:check`
- `pnpm local:runtime:probe`
- `pnpm local:provider:benchmark`
- `pnpm asset:gltf:smoke`
- `pnpm security:audit`
- `pnpm security:licenses`



---

# Adversarial Counterplan

The core plan is materially stronger, but it still risks being oversold. The adversarial team should keep pressure on four fronts.

## Attack 1: Quest Evidence Theater

The automated Quest smoke proves shell delivery and interaction, not immersive comfort. The hidden-page result means CDP is currently unsuitable as the sole frame-pacing authority. Any deck, demo, or leadership packet that says "Quest ready" without the manual report is overstating evidence.

Countermeasure: keep `quest_page_hidden_or_inactive`, `quest_cdp_frame_sample_incomplete`, and `quest_manual_performance:missing_quest_manual_performance_report` in the benchmark gate until the foreground report passes.

## Attack 2: Local AI Halo Effect

Mock model and voice benchmarks are useful for contracts, but they do not imply Qwen, DeepSeek, MLX, llama.cpp, Ollama, or VibeVoice will meet latency, quality, safety, or thermal needs.

Countermeasure: keep local runtime execution disabled by default and require explicit runtime/model IDs, model license records, and benchmark reports before enabling any local AI path.

## Attack 3: Asset Pipeline False Readiness

The GLB smoke proves only a tiny conversion path. It does not prove Blender generation, rigging, textures, animation, KTX2 compression, LODs, or Quest rendering budgets.

Countermeasure: keep `asset_pipeline:missing_blender` open and require a Blender-backed asset bake report before calling the asset lane ready.

## Attack 4: Dependency Optimism

The team almost added a MIT CLI whose transitive dependency path introduced an LGPL blocker. That is exactly the sort of supply-chain surprise that can slip into fast-moving XR/AI work.

Countermeasure: keep exact dependency pins, pnpm audit, license gate, security notes, and no-exception documentation in the main verification path.



---

# Core Revision

The core team accepts the adversarial critique and revises the plan language as follows:

- Replace "Quest performance smoke" with "Quest shell and interaction smoke plus blocked automated frame sample" unless the manual foreground report passes.
- Replace "local AI benchmark" with "mock provider benchmark contract plus not-configured local runtime blockers" until actual local runtimes are installed.
- Replace "asset pipeline ready" with "permissive GLB conversion smoke passed; Blender-backed bake not configured."
- Keep dependency choices reversible and license-gated; do not add convenience tooling that drags in copyleft blockers.

## Revised Readiness Wording

OpenClinXR is ready for continued deterministic local development. It is not ready for immersive performance claims, local AI claims, local voice claims, or production asset-pipeline claims.

## Revised Ownership

- XR Systems Architect owns the manual Quest performance report.
- Local AI Inference Engineer owns runtime/model install and benchmark reports.
- Voice And Speech Engineer owns local voice runtime safety and benchmark reports.
- Asset Pipeline Lead owns Blender install, bake script, and GLB budget evidence.
- Open Source Governance Lead owns dependency license and build-script approval posture.



---

# Leadership Review

Senior leadership approves the evidence-closure direction. The work has shifted from speculative planning into measurable local development gates, and that is the right maturity movement.

## Leadership Praise

- The team did not claim Quest readiness after seeing a hidden-page CDP blocker.
- The team rejected a convenient glTF CLI when its transitive license path violated the copyleft policy.
- The team added mock model and voice benchmark contracts without attempting cloud calls, model downloads, or unreviewed local runtime execution.
- The team converted manual Quest performance from an informal ask into a template and validator.

## Leadership Critique

- The benchmark gate is now more honest, but also noisier. The next work should group duplicate local model and local voice blockers into a clearer leadership summary.
- Manual performance capture still requires a human in the headset. The team should not spend more automation time trying to bypass a foreground condition unless Quest Browser provides a reliable automation path.
- Blender and local model/voice installs are real workstation changes; schedule them deliberately rather than burying them in unattended work.

## Directive

Continue implementation only along deterministic, locally verified paths. Treat optional local AI, voice, Blender, and immersive performance as separately scheduled spikes with explicit install and rollback notes.



---

# Final Synthesis

Iteration 0008 moved the plan from "we should test this" to "here is the command and report that proves or blocks it." That is real maturity.

## What Improved

- Quest automation now reports shell, WebXR, trace interaction, frame telemetry, and hidden-page blocker explicitly.
- Manual Quest performance has a report template and validator.
- Local runtime readiness is repeatable and local-only.
- Mock model and mock voice benchmarks now produce machine-readable evidence.
- GLB conversion is proven through a permissive pinned CLI.
- Dependency audit, license, and pinning gates are part of the normal verification path.

## What Remains Blocked

- Foreground Quest frame pacing and comfort.
- Local model runtime execution.
- Local voice runtime execution.
- Blender-backed asset generation and bake.
- Clinical and psychometric production validation.

## Go-Forward Rule

Continue building deterministic local code. Do not enable optional AI, voice, immersive performance, or production asset claims until their evidence gates pass.



---

# Memory Update Log

## New Durable Lessons

- XR Systems Architect: CDP shell delivery is not the same as foreground frame-pacing evidence; hidden-page state must be recorded.
- Test Automation Lead: evidence gates should produce JSON reports that can be summarized by the agent benchmark gate.
- Open Source Governance Lead: a permissive top-level package can still be rejected because of a copyleft transitive dependency path.
- Local AI Inference Engineer: mock benchmark contracts are useful, but must not be allowed to imply real local model readiness.
- Voice And Speech Engineer: local voice remains a safety-gated optional path, not a default runtime.
- Asset Pipeline Lead: GLB conversion is only one slice of asset readiness; Blender-backed bake evidence is still required.
- Senior Leadership Panel: maturity improves when blockers become precise and executable, even if the quality bar remains blocked by open evidence debt.

## Open Risks

- Quest frame-pacing claims may be overstated before manual foreground evidence exists.
- Local AI and voice installs could create large workstation side effects if not scheduled deliberately.
- Asset-pipeline optimism could return if GLB conversion is treated as equivalent to character/environment production.

