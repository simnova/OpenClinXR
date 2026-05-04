# Leadership Packet: iteration-0009

## Score Summary

```text
iterations/iteration-0009/06-leadership-scorecard.json
  plan_type: leadership-review
  weighted_score: 4.619
  composite_score: 4.616
  confidence: 0.79
  critical_risks: 5
  evidence_debt: 5
  decision_debt: 0
```


---

# Iteration 0009 Brief

Date: 2026-05-04
Loop focus: turn newly captured local model, local voice, asset-job, IWSDK, and Quest evidence into an amber implementation posture without overclaiming readiness

## Objective

Iteration 0009 absorbs the verified implementation slices and the May 4 evidence runs into the agent-factory operating loop. The goal is to move from broad feasibility planning into a sharper code implementation plan: deterministic local development remains the default, optional local AI and voice stay behind explicit facades, asset generation becomes an internal job lane, Quest/IWSDK readiness remains gated by headset evidence, and stale debt IDs are treated as a governance bug.

## Inputs

- `pnpm verify` passed after the asset-job and architecture-boundary commits.
- Internal asset-generation jobs now route through the API for `character-generation`, `medical-equipment-generation`, `voice-asset-generation`, `animation-generation`, and `asset-bake`.
- ArchUnitTS rules now keep internal capability endpoints and capability-gateway imports out of UI app source while allowing the API tunnel.
- Quest CDP smoke is foreground-visible and frame-sampling works, but immersive session entry and the manual worn-headset report remain blocked.
- Local Qwen/llama.cpp runtime smoke passed with structured-output caveats on the available Apple Silicon machine.
- Local VibeVoice file-generation smoke passed with latency, memory, and non-streaming caveats.
- GLB conversion and Blender placeholder bake passed, while production avatar, rigging, animation, LOD, texture, and headset-budget evidence remain unproven.
- IWSDK Phase 1 sidecar is installed and runnable, but production adoption, Phase 2 devtools, reference warmup, and Quest/MCP evidence remain blocked.

## Required Decisions

- Which prior evidence debt can be treated as resolved, and what replacement quality gates must remain open?
- How should the development team sequence live dialogue, voice, asset, and XR work without coupling optional local runtimes to production provider swaps?
- Which architecture decisions need continued enforcement through ArchUnitTS and package boundaries?
- How should the benchmark gate avoid reusing an evidence ID after the underlying debt changes meaning?
- Which claims remain prohibited in leadership, demo, or external materials?

## Output Standard

The output must be implementation-facing. Each recommendation should map to a package, app, endpoint, test, benchmark, or evidence file that the development team can act on next.



---

# Core Plan

## Evidence Now Proven

- The repo can pass the complete local verification gate after the latest slices: `pnpm verify`.
- The API now owns executable asset-pipeline submission through `/internal/capabilities/:capabilityId/jobs` and job reads through `/internal/capabilities/:capabilityId/jobs/:jobId`.
- The internal job lane accepts five deterministic zero-spend asset-pipeline capabilities: `character-generation`, `medical-equipment-generation`, `voice-asset-generation`, `animation-generation`, and `asset-bake`.
- UI apps are now structurally blocked from importing `@openclinxr/capability-gateway` or hardcoding `/internal/capabilities/` endpoint strings.
- The local model smoke produced a parsable clinical triage JSON object using Qwen/Qwen3-4B-GGUF through llama.cpp on Apple Silicon.
- The local voice smoke produced local audio with VibeVoice-Realtime-0.5B and recorded runtime, audio, latency, memory, and cache-footprint evidence, but the measured latency is not compatible with live XR dialog.
- The asset pipeline can run both permissive GLB conversion and a Blender-backed placeholder bake.
- The IWSDK sidecar is no longer only a proposal: Phase 1 has exact installed packages and a runnable sidecar lane.

## Remaining Blockers

- Quest immersive entry is not proven by automation. The latest gate still records `quest_immersive_entry_activation_not_received` and `quest_immersive_session_not_started`.
- A human worn-headset manual performance report is still missing, so frame pacing, comfort, controller latency, hand visibility, locomotion comfort, and readable in-VR text remain unclaimed.
- Local model evidence is a smoke, not a production dialogue contract. It still needs structured-output enforcement, hidden-truth containment, actor policy adherence, clinical safety review, and target M4 Pro or M4 Max benchmark evidence before live dialogue is enabled.
- Local voice evidence is file-based and too slow for live dialog. It still needs streaming capture, first audible playback latency, WebXR playback integration, misuse/disclosure controls, and headset performance evidence.
- Asset evidence is placeholder-level. It does not prove production character quality, rigging, skin/clothing generation, animation retargeting, KTX2 texture compression, LOD budgets, collider budgets, or multi-actor Quest frame pacing.
- IWSDK remains sidecar-only. Phase 2 devtools are approved but blocked by Vite peer-range posture, MCP evidence, managed-browser evidence, reference metadata drift, and bundle/performance budgets.
- The benchmark gate currently reuses `evidence-leadership-0008-004` for IWSDK blockers even though the iteration 0008 scorecard used that ID for Blender bake evidence. That ID drift must be fixed before leadership can treat the evidence ledger as clean.

## Implementation Direction

1. Keep `apps/api` as the only public tunnel for executable local/native capability work.
2. Keep local model, voice, and Python/native asset workers behind provider or capability facades so local development, local production, and hosted production can swap implementations without portal changes.
3. Use the deterministic asset-job facade as the contract for future Python/native asset workers before introducing Blender, rigging, voice-asset, or animation executables.
4. Treat `apps/ui-xr` as the primary full-VR station prototype and `apps/ui-xr-iwsdk-spike` as an isolated sidecar for IWSDK/MR learning.
5. Prioritize a Quest manual foreground report and WebXR entry evidence before adding more XR features.
6. Fix evidence-ledger ID drift before adding new leadership gates.
7. Build the next clinical code slices around traceable station runtime behavior, case-bank review, and admin governance rather than autonomous scoring.

## Commands That Carry The Evidence

- `pnpm verify`
- `pnpm agent:benchmarks`
- `pnpm --filter @openclinxr/api test`
- `pnpm --filter @openclinxr/capability-gateway test`
- `pnpm --filter @openclinxr/architecture-rules test`
- `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-2026-05-04.json`
- `pnpm iwsdk:verify`
- `pnpm local:provider:benchmark`
- `pnpm security:audit`
- `pnpm security:licenses`



---

# Adversarial Counterplan

The core plan is stronger because it has real local evidence, but that makes overclaiming more tempting. The adversarial team should attack the plan on six fronts.

## Attack 1: Local Model Smoke Becomes Dialogue Claim

The Qwen/llama.cpp smoke proves that a small local model can run and emit parsable JSON on the available machine. It does not prove clinical actor quality, hidden-truth discipline, standardized-patient consistency, validated assessment, or target M4 performance.

Countermeasure: require schema/grammar reliability, red-team actor-policy tests, trace-review tests, and explicit target-hardware benchmark records before enabling local dialogue.

## Attack 2: Voice File Generation Becomes Live Conversation Claim

The VibeVoice result is useful, but it measured local file generation with a real-time factor above live-dialog needs. It did not measure WebXR playback, streaming turn-taking, interruption, speaker identity, disclosure, retention, or misuse controls.

Countermeasure: keep voice generation out of live stations until a streaming adapter, safety policy, first audible playback metric, and headset playback evidence pass.

## Attack 3: Asset Jobs Become Asset Pipeline Readiness

The internal job facade is an excellent boundary, but the default adapter is deterministic and fake by design. Placeholder Blender output does not prove production humans, skin, clothing, rigging, animation, medical equipment, collision, or Quest budgets.

Countermeasure: route all native asset work through the internal job lane, but keep production asset readiness blocked until each artifact type has generation, validation, optimization, and headset-budget reports.

## Attack 4: IWSDK Sidecar Becomes Runtime Commitment

The IWSDK sidecar is useful for learning and may become important for agent-readable XR state. It is not ready for production adoption while Vite peer range, MCP tool inventory, reference metadata drift, bundle size, and Quest performance are unresolved.

Countermeasure: keep IWSDK isolated under `apps/ui-xr-iwsdk-spike` and require adapter-sync, tool-inventory, bundle, and Quest evidence before moving packages into the primary station runtime.

## Attack 5: Quest CDP Evidence Replaces Human Headset Evidence

Foreground CDP evidence improved, but the gate still lacks actual immersive session entry and worn-headset observation. CDP cannot validate comfort, readable text, hand affordances, locomotion comfort, or real controller latency alone.

Countermeasure: keep the Quest manual performance report open and prohibit any "Quest ready" statement until a human report passes.

## Attack 6: Endpoint Expansion Becomes UI Coupling

Internal capability endpoints are powerful, and UI teams may be tempted to call them directly for convenience.

Countermeasure: keep ArchUnitTS enforcement active: UI apps cannot import `@openclinxr/capability-gateway`, cannot hardcode `/internal/capabilities/`, and should use GraphQL/REST portal contracts owned by the API.

## Attack 7: Evidence IDs Change Meaning

The benchmark gate currently maps IWSDK sidecar blockers to `evidence-leadership-0008-004`, while the iteration 0008 leadership scorecard used that ID for Blender bake evidence. That makes the maturity story look more coherent than it is.

Countermeasure: introduce capability-specific evidence IDs or a migration map, then add tests that fail when benchmark-gate evidence IDs do not match scorecard debt summaries.



---

# Core Revision

The core team accepts the adversarial critique and revises the implementation posture.

## Revised Readiness Wording

OpenClinXR is ready for continued deterministic local implementation, internal asset-job contract development, and evidence-driven XR iteration. It is not ready for Quest performance claims, production local dialogue, live local voice, production asset generation, validated scoring, or IWSDK runtime adoption.

## Revised Engineering Priorities

- Treat local model and voice benchmark evidence as adapter-spike inputs, not station-runtime defaults.
- Route Python/native asset work through the internal capability-job lane before adding long-running workers or executables.
- Keep provider swaps separate from native asset-worker deployment decisions.
- Keep IWSDK and mixed-reality work in sidecar lanes until evidence clears production blockers.
- Strengthen scorecard and benchmark IDs so leadership gates do not drift away from the evidence debt they claim to measure.
- Treat debt-ledger reconciliation as implementation work, not documentation cleanup.
- Prefer next code slices that improve testability, evidence capture, and architecture enforcement over feature breadth.

## Revised Ownership

- XR Systems Architect owns Quest immersive entry, manual performance, locomotion, hand/controller, and readable in-scene text evidence.
- Local AI Inference Engineer owns structured-output enforcement, hidden-truth policy tests, and target-hardware local model benchmarks.
- Voice And Speech Engineer owns streaming voice, first audible playback latency, disclosure, retention, and WebXR playback evidence.
- Asset Pipeline Lead owns native worker contracts, Blender/rigging/animation/LOD/texture/collider evidence, and Quest budget validation.
- Platform Architect owns API facade boundaries and ArchUnitTS enforcement.
- Open Source Governance Lead owns license/audit exceptions, IWSDK package posture, and reference-download review.
- Chief Psychometrician and Clinical Safety Lead own trace-quality, rater-review, station blueprint, and actor-behavior validation before scoring claims.
- Rubric Steward owns benchmark-gate evidence ID reconciliation and scorecard lifecycle rules.



---

# Leadership Review

Senior leadership sees meaningful progress in Iteration 0009, but the posture is amber. The team has moved from "can this run locally" into "which exact lane owns this capability, and what evidence prevents it from being oversold." That is useful maturity, not readiness.

## Leadership Praise

- The API now has a concrete internal job lane for asset-generation work without exposing native workers directly.
- Architecture enforcement now backs the intended UI/API separation instead of relying on convention.
- Local model and voice evidence were captured without cloud spend and with caveats intact.
- The IWSDK sidecar is isolated, which lets the team learn from it without prematurely committing the primary runtime.
- The benchmark gate now makes Quest immersive-entry failure explicit rather than hiding it behind shell success.

## Leadership Critique

- Evidence IDs need sharper lifecycle hygiene. IWSDK evidence must not reuse an ID whose scorecard text originally described Blender asset bake evidence. This is a governance defect with engineering impact.
- The local model and voice results are encouraging but not enough for live clinical simulation. Structured output, actor behavior, streaming latency, and safety controls remain unresolved.
- Quest evidence still depends on a human worn-headset report. The team should stop adding XR surface area until that report validates the current interaction model.
- Asset jobs are a contract boundary, not proof that high-quality patients, family members, staff, equipment, and animations can be generated within headset budgets.

## Directive

Continue implementation through narrow, verified slices. The next slice should either close the Quest manual evidence gap or improve the evidence machinery that prevents scorecard, benchmark, and leadership-gate drift. Do not present Iteration 0009 as near-green until the ledger drift and headset evidence are resolved.



---

# Final Synthesis

Iteration 0009 is an amber maturity step from evidence capture to implementation governance.

## What Improved

- Internal asset jobs now have a deterministic API-backed contract for five asset-pipeline capabilities.
- ArchUnitTS now enforces the API/UI separation around internal capability work.
- Local model and voice runtime smokes exist and are documented with caveats.
- GLB and Blender placeholder asset smokes are available as first pipeline evidence.
- IWSDK is isolated in a runnable sidecar instead of being pulled into the primary station.
- Quest automation now distinguishes shell, frame, interaction, and immersive-entry outcomes more clearly.

## What Remains Blocked

- Human worn-headset Quest performance.
- Automated or manual proof of immersive session entry as experienced in-headset.
- Production local dialogue quality and target-hardware reliability.
- Streaming voice and WebXR playback readiness.
- Production-grade generated humans, equipment, rigging, animation, and headset budgets.
- IWSDK Phase 2 tooling and primary-runtime adoption.
- Clinical, legal, and psychometric validation for anything beyond formative deterministic prototypes.
- Stale-packet cleanup for older leadership packets as evidence evolves.

## Governance Decision

Benchmark gates should not change the meaning of an existing scorecard evidence ID. If later evidence introduces a new capability area, the gate keeps the old ID for the original debt and emits a new ID for the new capability.

## Go-Forward Rule

Continue narrow verified implementation slices. Every slice should either close an evidence gate, enforce an architecture decision, keep evidence-ledger mappings current, or add a facade/test that makes future local/native/provider swaps safer.



---

# Memory Update Log

## New Durable Lessons

- Platform Architect: executable native or Python-backed capability work should enter through the API tunnel and be protected by architecture rules.
- XR Systems Architect: foreground CDP frame evidence is useful, but immersive entry and worn-headset comfort still require human validation.
- Local AI Inference Engineer: a local model smoke can close an installation blocker while opening a higher-value structured-output and actor-policy quality gate.
- Voice And Speech Engineer: local file generation is not the same as live, interruptible, WebXR-played clinical dialogue.
- Asset Pipeline Lead: asset-job routing is a boundary; production asset readiness requires per-artifact generation and headset-budget evidence.
- Open Source Governance Lead: IWSDK can remain useful as an isolated learning lane while package, peer-range, metadata, and bundle blockers stay unresolved.
- Rubric Steward: evidence gate IDs need lifecycle discipline so benchmark reports do not silently repurpose old scorecard debt; ID drift is a leadership-risk issue, not a paperwork issue. Iteration 9 split the old Blender asset-bake gate from the new IWSDK sidecar gate.
- Senior Leadership Panel: the strongest current plan is not feature expansion; it is evidence closure plus boundary enforcement.

## Open Risks

- Local AI and voice results may be oversold because they are concrete and exciting.
- Quest shell evidence may still be mistaken for immersive user experience evidence.
- Asset pipeline progress may be confused with production-quality human and equipment generation.
- IWSDK sidecar learning may accidentally become primary runtime coupling before the evidence supports it.
- Scorecards, benchmark gates, and leadership packets may diverge as evidence evolves across iterations unless ID lifecycle rules are enforced.

