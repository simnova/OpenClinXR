---
authority: agent-methodology
---

# Drift and Toil Prevention

## Guardrails
- Before starting a slice, apply the guardrail slice gate in `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`.
- If a slice does not advance blueprint-to-runtime generation, conversation/runtime tooling, reusable generated assets, review/persistence/replay, or verification of touched factory behavior, do not do it.
- OpenClinXR is not a collection of handcrafted XR scenes. It is a blueprint-driven encounter factory.

## Anti-Toil Product Advancement Gate
- Do not let verification, benchmark refreshes, evidence ledgers, or repeated review loops become the work.
- The slice must directly advance the Step 2 CS-inspired multi-station XR clinical-skills exam skeleton, or unblock a named product slice that cannot safely proceed without the evidence.
- Evidence-only work is allowed when it verifies a just-touched package, captures a newly available hardware/runtime fact, or closes a specific leadership gate that is blocking an implementation decision.
- Evidence-only work is not allowed merely to make stale reports fresher, reduce red in aggregate dashboards, rerun known-failing gates, or restate already-known blockers.
- Model-work product guard: do not spend another model/model-pipeline slice mainly on tests, validators, benchmarks, screenshots, source-currentness checks, or review artifacts unless that slice also builds or directly unlocks actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality, runtime-visible model behavior, or provider/cache/tooling capability that can produce models on this machine inside approved boundaries.
- For Anny, humanoid, voice, animation, skin, or clothing work, every second model-adjacent slice must create or improve a tangible model-producing or model-consuming capability; pure test/evidence scaffolding can be used only as the smallest safety rail for that capability.
- Productivity Skeptic pulse: during long autonomous Anny/humanoid/model-vetting work, consult `agents/adversarial/productivity-skeptic/` on a randomized 3-10 minute cadence or after any sizeable model change. Its critique must ask what actually changed in generated models or running runtime, why the Model Vetting Studio lacks fresh video/screenshot evidence, whether GLBs are still fixture-grade rather than Anny-grounded, and whether a website update would convince skeptical viewers. Treat its output as a push toward the next tangible model/video slice, not as permission to add more planning ceremony.
- After one evidence-only slice, the next slice should normally be product construction.
- After two consecutive evidence/validation-only slices, force a Chief Coordinator plus Implementation Plan Gap Attacker review using `agents/**`, `docs/agent-factory/**`, and the latest iteration synthesis; then choose a build slice unless a true blocker prevents all approved build work.
- Run aggregate benchmark rollups at most once after a coherent batch of changes.
- Prefer “make a learner/faculty/admin flow more complete” over “make a report more current” when both are safe.

## Drift Prevention (hyper guard)
- Never 2+ evidence-only without drift review + coordinator consult + product pivot.
- `pnpm agent:alignment` catches stale breadcrumbs in docs.
- Use `agents/adversarial/openclaw-drift-police/` (read charter+memory) on any suspicion of sprawl or one-off.
- After edits to coordination files, always run `pnpm agent:alignment && pnpm docs:drift-check` (or the post-slice) before claiming ready for next.

## Chunk Visibility / Noticeability (cross-ref)
See `agents/rules/agentic-lexicon.md` (authoritative definition) and `agents/rules/chunk-visibility-noticeability.md` (authority: agent-methodology; non-negotiable for orchestration coordinator (chief-coordinator role)). Every chunk must produce noticeable change in tester app (Model Vetting cagematch) **or** sample scene (UI-XR); if not visible, expand scope until it is. Anti-toil + Q1/Q5 gate: invisible = toil or fixture; force expansion or pivot after 1 evidence-only. Orchestration coordinator enforces via Persona (charter + toml), spawn-prompt bake (grok-repo-agent-spawn.ts), and state records ("Per visibility/noticeability rule..."). This is part of the protected blueprint-factory posture.

## Instruction Source-Of-Truth Order
See `agents/rules/source-of-truth.md` (canonical) and `agents/rules/agentic-lexicon.md`. Primary order (when scattered docs disagree): AGENTS.md (contract) > PROJECT_STATUS.md + worker-backlog (canonical state/ownership) > operator-*.md > docs/agent-factory/** + agents/** (memory). Detailed rules in this directory provide focused expansions; they defer to the lexicon for terminology.
